import asyncio
import datetime as dt
import hashlib
import json
import logging
import logging.config
import os
import re
import signal
import tempfile
import time
from collections import deque
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from pathlib import Path
from secrets import token_hex
from threading import Lock
from typing import Annotated, Any, Literal, Self, cast

from fastapi import (
    Depends,
    FastAPI,
    File,
    HTTPException,
    Request,
    UploadFile,
    WebSocket,
    WebSocketDisconnect,
    status,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from prometheus_client import (
    CONTENT_TYPE_LATEST,
    CollectorRegistry,
    Counter,
    Gauge,
    Histogram,
    generate_latest,
)
from sqlalchemy import desc, text
from sqlalchemy.sql.elements import ColumnElement
from sqlmodel import Session, select

from db import engine, get_session, init_db
from license_manager import ActivationError, LicenseManager, LicenseStatus
from models import DisplayRow, FileRow, ParsedRow, SessionRow, SessionState
from parser_adapter import parse_file
from paths import ensure_app_dirs, logs_dir
from schemas import (
    BannerOut,
    DisplayOut,
    DisplaySet,
    FileOut,
    LicenseActivateRequest,
    LicenseLocationOut,
    LicenseStatusOut,
    ParsedBundleOut,
    ParsedOut,
    PublishRequest,
    SessionCreate,
    SessionOut,
    SessionUpdate,
    TokenRenewRequest,
    TokenRotateRequest,
    TokenRotateResponse,
)
from security import enforce_http_middleware, ensure_websocket_authorized
from session_fs import (
    ensure_session_scaffold,
    load_upload_bytes,
    remove_files_directory,
    remove_session_directory,
    remove_session_lock,
    reset_tmp_directory,
    session_tmp_path,
    store_upload_bytes,
    touch_session_lock,
)
from token_manager import generate_token as generate_auth_token
from token_manager import rotate_token as rotate_auth_token

EXIT_WHEN_IDLE = os.getenv("EXIT_WHEN_IDLE", "false").lower() in {"1", "true", "yes", "on"}
try:
    EXIT_IDLE_DEBOUNCE_SEC = float(os.getenv("EXIT_IDLE_DEBOUNCE_SEC", "20"))
except ValueError:
    EXIT_IDLE_DEBOUNCE_SEC = 20.0

guest_clients: set[WebSocket] = set()
operator_clients: set[WebSocket] = set()
operator_window_count = 0
_operator_window_lock = Lock()

DbSessionDep = Annotated[Session, Depends(get_session)]
UploadFileDep = Annotated[UploadFile, File(...)]

_shutdown_task: asyncio.Task | None = None
_event_loop: asyncio.AbstractEventLoop | None = None
_background_tasks: set[asyncio.Task] = set()

logger = logging.getLogger("longevityq.backend")

SexLiteral = Literal["male", "female"]
StateLiteral = Literal[
    "CREATED", "INGESTING", "VALIDATING", "PARSING", "READY", "PUBLISHED", "CLOSED"
]

DEFAULT_MAX_UPLOAD_BYTES = 2 * 1024 * 1024  # 2 MiB default ceiling


_METRICS_REGISTRY = CollectorRegistry(auto_describe=True)

UPLOAD_COUNTER = Counter(
    "longq_upload_reports_total",
    "Number of reports uploaded",
    ["kind"],
    registry=_METRICS_REGISTRY,
)
UPLOAD_BYTES = Histogram(
    "longq_upload_size_bytes",
    "Size of uploaded report files in bytes",
    ["kind"],
    buckets=(
        64 * 1024,
        256 * 1024,
        512 * 1024,
        1024 * 1024,
        2 * 1024 * 1024,
        4 * 1024 * 1024,
        8 * 1024 * 1024,
        16 * 1024 * 1024,
    ),
    registry=_METRICS_REGISTRY,
)
PARSE_COUNTER = Counter(
    "longq_parse_events_total",
    "Number of parse attempts",
    ["kind", "result"],
    registry=_METRICS_REGISTRY,
)
PARSE_DURATION = Histogram(
    "longq_parse_duration_seconds",
    "Time spent parsing uploaded reports",
    ["kind"],
    buckets=(0.5, 1.0, 2.0, 5.0, 10.0, 20.0, 30.0, 60.0),
    registry=_METRICS_REGISTRY,
)
ACTIVE_JOBS_GAUGE = Gauge(
    "longq_active_jobs",
    "Number of active backend jobs",
    registry=_METRICS_REGISTRY,
)

DIAGNOSTICS_MAX_ENTRIES = max(1, int(os.getenv("DIAGNOSTICS_MAX_ENTRIES", "100")))
DIAGNOSTICS_BUFFER: deque[dict[str, object]] = deque(maxlen=DIAGNOSTICS_MAX_ENTRIES)
_LOGGING_CONFIGURED = False


class UploadTooLargeError(Exception):
    """Raised when an uploaded file exceeds the configured byte limit."""


class DiagnosticsHandler(logging.Handler):
    def emit(self: Self, record: logging.LogRecord) -> None:
        if record.levelno < logging.ERROR:
            return
        try:
            message = record.getMessage()
        except Exception:  # pragma: no cover - defensive
            message = str(record.msg)
        entry = {
            "timestamp": dt.datetime.fromtimestamp(record.created, tz=dt.UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": message,
            "code": _diagnostic_code(record, message),
            "pathname": record.pathname,
            "lineno": record.lineno,
        }
        if record.exc_info:
            try:
                entry["detail"] = logging.Formatter().formatException(record.exc_info)
            except Exception:
                entry["detail"] = None
        elif record.stack_info:
            entry["detail"] = record.stack_info
        DIAGNOSTICS_BUFFER.append(entry)


class JsonFormatter(logging.Formatter):
    def format(self: Self, record: logging.LogRecord) -> str:
        try:
            message = record.getMessage()
        except Exception:  # pragma: no cover - defensive
            message = str(record.msg)
        payload: dict[str, object] = {
            "timestamp": dt.datetime.fromtimestamp(record.created, tz=dt.UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": message,
        }
        if record.exc_info:
            payload["exc_info"] = self.formatException(record.exc_info)
        if record.stack_info:
            payload["stack_info"] = record.stack_info
        if record.pathname:
            payload["pathname"] = record.pathname
            payload["lineno"] = record.lineno
        return json.dumps(payload, ensure_ascii=False)


def _state_literal(value: SessionState | str) -> StateLiteral:
    return cast(StateLiteral, value.value if isinstance(value, SessionState) else value)


def _sex_literal_optional(value: str | None) -> SexLiteral | None:
    if value is None:
        return None
    if value in {"male", "female"}:
        return cast(SexLiteral, value)
    return cast(SexLiteral, "male")


def _sex_literal_required(value: str | None) -> SexLiteral:
    normalized = _sex_literal_optional(value)
    return normalized if normalized is not None else cast(SexLiteral, "male")


def _diagnostic_code(record: logging.LogRecord, message: str) -> str:
    raw = f"{record.name}:{record.lineno}:{message}".encode("utf-8", errors="ignore")
    return hashlib.sha1(raw).hexdigest()[:8].upper()


def _configure_logging() -> None:
    global _LOGGING_CONFIGURED
    if _LOGGING_CONFIGURED:
        return

    log_dir = logs_dir()
    log_dir.mkdir(parents=True, exist_ok=True)
    log_file = log_dir / os.getenv("BACKEND_LOG_FILE", "backend.jsonl")
    max_bytes = int(os.getenv("BACKEND_LOG_MAX_BYTES", str(5 * 1024 * 1024)))
    backup_count = int(os.getenv("BACKEND_LOG_BACKUP_COUNT", "5"))
    level = os.getenv("BACKEND_LOG_LEVEL", "INFO").upper()
    console_enabled = os.getenv("BACKEND_LOG_TO_STDOUT", "1").lower() in {"1", "true", "yes", "on"}

    handlers = {
        "file": {
            "class": "logging.handlers.RotatingFileHandler",
            "filename": str(log_file),
            "maxBytes": max_bytes,
            "backupCount": backup_count,
            "encoding": "utf-8",
            "formatter": "json",
        },
        "diagnostics": {
            "()": DiagnosticsHandler,
            "level": "ERROR",
        },
    }

    root_handlers = ["file", "diagnostics"]
    if console_enabled:
        handlers["console"] = {
            "class": "logging.StreamHandler",
            "formatter": "json",
        }
        root_handlers.append("console")

    logging.config.dictConfig(
        {
            "version": 1,
            "disable_existing_loggers": False,
            "formatters": {"json": {"()": JsonFormatter}},
            "handlers": handlers,
            "root": {"level": level, "handlers": root_handlers},
        }
    )
    _LOGGING_CONFIGURED = True


BASE_DIR = Path(__file__).resolve().parent.parent
ensure_app_dirs()
_configure_logging()

logger = logging.getLogger("longevityq.backend")


def _parse_max_upload_bytes(raw: str | None) -> int:
    if raw is None or raw.strip() == "":
        return DEFAULT_MAX_UPLOAD_BYTES
    try:
        value = int(raw)
    except ValueError as exc:
        raise RuntimeError("MAX_UPLOAD_BYTES must be an integer number of bytes.") from exc
    if value <= 0:
        raise RuntimeError("MAX_UPLOAD_BYTES must be greater than zero.")
    return value


MAX_UPLOAD_BYTES = _parse_max_upload_bytes(os.getenv("MAX_UPLOAD_BYTES"))


def _format_bytes(num_bytes: int) -> str:
    units = ["B", "KB", "MB", "GB", "TB"]
    value = float(num_bytes)
    idx = 0
    while value >= 1024 and idx < len(units) - 1:
        value /= 1024
        idx += 1
    precision = 1 if idx > 0 else 0
    return f"{value:.{precision}f} {units[idx]}"


def _detect_uploaded_size(upload: UploadFile, fallback: int) -> int:
    raw = upload.file
    if not hasattr(raw, "tell") or not hasattr(raw, "seek"):
        return fallback
    try:
        position = raw.tell()
    except Exception:
        return fallback
    try:
        raw.seek(0, os.SEEK_END)
        total = raw.tell()
    except Exception:
        total = fallback
    finally:
        try:
            raw.seek(position, os.SEEK_SET)
        except Exception:
            pass
    return total if total > 0 else fallback


def _parse_allowed_origins(raw: str | None) -> list[str]:
    if not raw:
        return ["http://127.0.0.1:5173", "http://localhost:5173"]
    origins = [item.strip() for item in raw.split(",") if item.strip()]
    if not origins:
        message = (
            "ALLOWED_ORIGINS is set but empty; specify at least one origin or unset the "
            "variable for the default."
        )
        raise RuntimeError(message)
    if "*" in origins:
        raise RuntimeError(
            "ALLOWED_ORIGINS may not contain wildcard '*'. Specify explicit origins."
        )
    return origins


ALLOWED_ORIGINS = _parse_allowed_origins(os.getenv("ALLOWED_ORIGINS"))
ALLOW_CREDENTIALS = os.getenv("CORS_ALLOW_CREDENTIALS", "false").lower() in {
    "1",
    "true",
    "yes",
    "on",
}

REPORT_TYPES = {
    "food": {"label": "Food", "aliases": ["food"]},
    "heavy-metals": {
        "label": "Heavy Metals",
        "aliases": ["heavy metals", "heavy-metals", "heavy_metals"],
    },
    "hormones": {"label": "Hormones", "aliases": ["hormones"]},
    "nutrition": {"label": "Nutrition", "aliases": ["nutrition"]},
    "toxins": {"label": "Toxins", "aliases": ["toxins"]},
    "peek": {
        "label": "PEEK Report",
        "aliases": ["peek", "peek report", "energy", "energy map"],
    },
}

_active_jobs = 0
_active_jobs_lock = Lock()


async def on_startup() -> None:
    global _event_loop
    _event_loop = asyncio.get_running_loop()
    init_db()
    _ensure_session_table_columns()
    _ensure_display_table_columns()
    with Session(engine) as db:
        d = db.exec(select(DisplayRow).where(DisplayRow.code == "main")).first()
        if not d:
            db.add(DisplayRow(code="main"))
            db.commit()
    manager = _license_manager()
    snapshot = manager.verify_now()
    logger.info("License status at startup: %s", snapshot.state)
    return None


async def on_shutdown() -> None:
    _cancel_shutdown_timer("Application shutdown requested.")
    global _event_loop
    _event_loop = None


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    await on_startup()
    try:
        yield
    finally:
        await on_shutdown()


app = FastAPI(title="Quantum Qi™ Backend", lifespan=lifespan)
app.state.license_manager = None


def _license_manager() -> LicenseManager:
    manager = cast(LicenseManager | None, getattr(app.state, "license_manager", None))
    if manager is None:
        manager = LicenseManager()
        app.state.license_manager = manager
    return manager


app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=ALLOW_CREDENTIALS,
)

_PUBLIC_HTTP_PATHS = {"/healthz"}
_LICENSE_HTTP_PATHS = {
    "/license/status",
    "/license/activate",
    "/license/refresh",
    "/license/location",
}


@app.middleware("http")
async def _auth_middleware(
    request: Request,
    call_next: Callable[[Request], Awaitable[Response]],
) -> Response:
    if request.url.path in _PUBLIC_HTTP_PATHS or request.url.path in _LICENSE_HTTP_PATHS:
        return await call_next(request)
    unauthorized = enforce_http_middleware(request)
    if unauthorized is not None:
        return cast(Response, unauthorized)
    return await call_next(request)


@app.middleware("http")
async def _license_middleware(
    request: Request,
    call_next: Callable[[Request], Awaitable[Response]],
) -> Response:
    path = request.url.path
    if path in _PUBLIC_HTTP_PATHS or path in _LICENSE_HTTP_PATHS:
        return await call_next(request)
    manager = cast(LicenseManager | None, getattr(app.state, "license_manager", None))
    if manager is None or manager.is_valid():
        return await call_next(request)
    snapshot = manager.status()
    payload = {
        "error": "license_required",
        "state": snapshot.state,
        "message": snapshot.message,
        "error_code": snapshot.error_code,
    }
    return Response(
        status_code=status.HTTP_403_FORBIDDEN,
        content=json.dumps(payload),
        media_type="application/json",
    )


@app.get("/healthz")
async def healthz() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/metrics")
def metrics() -> Response:
    payload = cast(bytes, generate_latest(_METRICS_REGISTRY))
    return Response(payload, media_type=CONTENT_TYPE_LATEST)


def _recent_diagnostics(limit: int) -> list[dict]:
    if limit <= 0:
        return []
    snapshot = list(DIAGNOSTICS_BUFFER)
    if not snapshot:
        return []
    limited = snapshot[-limit:]
    limited.reverse()
    return limited


@app.get("/diagnostics")
def diagnostics(limit: int = 20) -> dict[str, list[dict]]:
    limit = max(1, min(limit, DIAGNOSTICS_MAX_ENTRIES))
    return {"entries": _recent_diagnostics(limit)}


def _status_response(status_obj: LicenseStatus) -> LicenseStatusOut:
    return LicenseStatusOut(**status_obj.to_dict())


def _activation_error_to_http(exc: ActivationError) -> HTTPException:
    detail = {"code": exc.code, "message": str(exc)}
    return HTTPException(status_code=exc.status_code, detail=detail)


@app.get("/license/status", response_model=LicenseStatusOut)
def license_status() -> LicenseStatusOut:
    manager = _license_manager()
    return _status_response(manager.status())


@app.post("/license/activate", response_model=LicenseStatusOut)
def license_activate(payload: LicenseActivateRequest) -> LicenseStatusOut:
    manager = _license_manager()
    try:
        updated = manager.activate(str(payload.email))
    except ActivationError as exc:
        raise _activation_error_to_http(exc) from exc
    return _status_response(updated)


@app.post("/license/refresh", response_model=LicenseStatusOut)
def license_refresh(payload: LicenseActivateRequest) -> LicenseStatusOut:
    return license_activate(payload)


@app.get("/license/location", response_model=LicenseLocationOut)
def license_location() -> LicenseLocationOut:
    manager = _license_manager()
    path, exists = manager.license_location()
    return LicenseLocationOut(path=str(path), directory=str(path.parent), exists=exists)


def _ensure_display_table_columns() -> None:
    with engine.connect() as conn:
        info = conn.execute(text("PRAGMA table_info(displayrow)")).fetchall()
        existing = {row[1] for row in info}
        statements = []
        if "staged_session_id" not in existing:
            statements.append("ALTER TABLE displayrow ADD COLUMN staged_session_id INTEGER")
        if "staged_first_name" not in existing:
            statements.append("ALTER TABLE displayrow ADD COLUMN staged_first_name TEXT")
        if "staged_full_name" not in existing:
            statements.append("ALTER TABLE displayrow ADD COLUMN staged_full_name TEXT")
        if "staged_sex" not in existing:
            statements.append("ALTER TABLE displayrow ADD COLUMN staged_sex TEXT")
        for stmt in statements:
            conn.execute(text(stmt))
        if statements:
            conn.commit()


def _ensure_session_table_columns() -> None:
    with engine.connect() as conn:
        info = conn.execute(text("PRAGMA table_info(sessionrow)")).fetchall()
        existing = {row[1] for row in info}
        if "visible_reports" not in existing:
            conn.execute(text("ALTER TABLE sessionrow ADD COLUMN visible_reports TEXT"))
            conn.commit()
        if "sex" not in existing:
            conn.execute(text("ALTER TABLE sessionrow ADD COLUMN sex TEXT DEFAULT 'male'"))
            conn.commit()


# ----------------- Idle shutdown utilities -----------------


def _canonicalize_name_part(value: str) -> str:
    if not value:
        return ""
    cleaned = value.replace(".", " ").replace("_", " ").strip()
    cleaned = re.sub(r"\s+", " ", cleaned)
    if not cleaned:
        return ""

    def _cap(segment: str) -> str:
        components = [comp for comp in re.split(r"-+", segment) if comp]
        if not components:
            return ""
        return "-".join(comp.capitalize() for comp in components)

    return " ".join(filter(None, (_cap(seg) for seg in cleaned.split(" "))))


def _canonicalize_client_name(name: str) -> str:
    parts = [p for p in re.split(r"\s+", name or "") if p]
    canonical_parts = [_canonicalize_name_part(part) for part in parts]
    return " ".join(filter(None, canonical_parts))


def _compose_client_name(first: str, last: str) -> str:
    return " ".join(part for part in [first, last] if part)


def _normalize_text(text: str) -> str:
    return re.sub(r"\s+", " ", text.strip().lower())


def _validate_uploaded_filename(session: SessionRow, kind: str, filename: str) -> None:
    info = REPORT_TYPES.get(kind)
    if not info:
        raise HTTPException(400, f"Unsupported report kind: {kind}")

    suffix = Path(filename).suffix.lower()
    if kind == "peek":
        if suffix != ".docx":
            raise HTTPException(400, "PEEK reports must be Word documents (.docx).")
    else:
        if suffix != ".pdf":
            raise HTTPException(400, "Only PDF files are accepted.")

    normalized_name = _normalize_text(filename.replace("-", " ").replace("_", " "))
    normalized_client = _normalize_text(_canonicalize_client_name(session.client_name))
    if normalized_client not in normalized_name:
        raise HTTPException(
            400,
            f'File name must include the client name "{session.client_name}".',
        )

    aliases = [alias.lower() for alias in info["aliases"]]
    if not any(alias in normalized_name for alias in aliases):
        raise HTTPException(
            400,
            f'File name must include the report type "{info["aliases"][0]}".',
        )


def _log(message: str) -> None:
    logger.info(message)


def _read_upload_payload(upload: UploadFile, *, max_bytes: int) -> bytes:
    """Read an upload stream while enforcing a byte ceiling."""
    raw = upload.file
    total = 0
    chunks: list[bytes] = []
    while True:
        chunk = raw.read(65536)
        if not chunk:
            break
        if isinstance(chunk, str):
            chunk = chunk.encode()
        total += len(chunk)
        if total > max_bytes:
            reported_total = _detect_uploaded_size(upload, fallback=total)
            human_total = _format_bytes(reported_total)
            human_limit = _format_bytes(max_bytes)
            raise UploadTooLargeError(f"Upload size {human_total} exceeds the {human_limit} limit.")
        chunks.append(chunk)
    return b"".join(chunks)


def _run_in_loop(callback: Callable[..., None], *args: object) -> None:
    global _event_loop
    try:
        asyncio.get_running_loop().call_soon(callback, *args)
    except RuntimeError:
        loop = _event_loop
        if loop is not None:
            loop.call_soon_threadsafe(callback, *args)


def _active_jobs_count() -> int:
    with _active_jobs_lock:
        return _active_jobs


def _cancel_shutdown_timer(reason: str) -> None:
    def _cancel() -> None:
        global _shutdown_task
        task = _shutdown_task
        if task and not task.done():
            _log(reason)
            task.cancel()
        _shutdown_task = None

    _run_in_loop(_cancel)


def _get_operator_window_count() -> int:
    with _operator_window_lock:
        return operator_window_count


def _schedule_idle_check(reason: str) -> None:
    global _shutdown_task

    if not EXIT_WHEN_IDLE:
        return

    if operator_clients or guest_clients or _get_operator_window_count() > 0:
        return

    jobs = _active_jobs_count()
    if jobs > 0:
        _log(f"Idle shutdown postponed ({reason}); {jobs} active job(s) remain.")
        return

    task = _shutdown_task
    if task and not task.done():
        _log("Idle shutdown timer already running; no action taken.")
        return

    _log(
        f"All clients disconnected; scheduling idle shutdown in "
        f"{EXIT_IDLE_DEBOUNCE_SEC:.1f}s ({reason})."
    )
    _shutdown_task = asyncio.create_task(_shutdown_after_delay(reason))


def _request_idle_check(reason: str) -> None:
    _run_in_loop(_schedule_idle_check, reason)


def _trigger_shutdown() -> None:
    _log("Idle shutdown triggered.")
    server = getattr(app.state, "uvicorn_server", None)
    if server is not None:
        _log("Signalling uvicorn server to exit via should_exit flag.")
        server.should_exit = True
    supervisor_pid = os.getenv("EXIT_IDLE_SUPERVISOR_PID")
    if supervisor_pid:
        try:
            os.kill(int(supervisor_pid), signal.SIGINT)
            _log(f"Sent SIGINT to supervisor process {supervisor_pid}.")
        except Exception as exc:
            _log(f"Failed to signal supervisor process {supervisor_pid}: {exc}")
    elif server is None:
        _log("No uvicorn server reference; sending SIGINT to process.")
        os.kill(os.getpid(), signal.SIGINT)


async def _shutdown_after_delay(reason: str) -> None:
    global _shutdown_task
    try:
        await asyncio.sleep(EXIT_IDLE_DEBOUNCE_SEC)
        if operator_clients or guest_clients or _get_operator_window_count() > 0:
            _log("Idle shutdown aborted; clients or operator windows reconnected during debounce.")
            return
        jobs = _active_jobs_count()
        if jobs > 0:
            _log(f"Idle shutdown aborted; {jobs} active job(s) still running.")
            return
        _trigger_shutdown()
    except asyncio.CancelledError:
        _log("Idle shutdown timer cancelled before completion.")
        raise
    finally:
        _shutdown_task = None


def _track_background_task(task: asyncio.Task) -> None:
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)


def _note_job_started(tag: str) -> None:
    global _active_jobs
    with _active_jobs_lock:
        _active_jobs += 1
        count = _active_jobs
    ACTIVE_JOBS_GAUGE.set(count)
    _cancel_shutdown_timer(f"Idle shutdown timer cancelled ({tag} started); {count} active job(s).")
    _log(f"Job started ({tag}); active jobs: {count}.")


def _note_job_finished(tag: str) -> None:
    global _active_jobs
    with _active_jobs_lock:
        _active_jobs = max(0, _active_jobs - 1)
        count = _active_jobs
    ACTIVE_JOBS_GAUGE.set(count)
    _log(f"Job finished ({tag}); active jobs: {count}.")
    _request_idle_check(f"job finished ({tag})")


# ----------------- WebSocket endpoints -----------------


def _on_client_connected(kind: str) -> None:
    _cancel_shutdown_timer(f"Idle shutdown timer cancelled ({kind} connected).")


def _on_client_disconnected(kind: str) -> None:
    _request_idle_check(f"{kind} disconnected")


async def _ensure_license_ws(ws: WebSocket) -> bool:
    manager = cast(LicenseManager | None, getattr(app.state, "license_manager", None))
    if manager is None:
        manager = _license_manager()
    if manager.is_valid():
        return True
    snapshot = manager.status()
    reason = snapshot.message or "License required."
    try:
        scope = getattr(ws, "scope", {}) or {}
        path = scope.get("path", "/ws")
    except Exception:  # pragma: no cover - defensive
        path = "/ws"
    logger.info("Rejecting websocket %s: %s", path, reason)
    try:
        await ws.close(code=4403, reason=reason[:120])
    except Exception:  # pragma: no cover - best effort close
        pass
    return False


@app.websocket("/ws/guest")
async def ws_guest(ws: WebSocket) -> None:
    if not await _ensure_license_ws(ws):
        return
    if not await ensure_websocket_authorized(ws):
        return
    await ws.accept()
    guest_clients.add(ws)
    _on_client_connected("guest")
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    except Exception:
        try:
            await ws.close()
        except Exception:
            pass
    finally:
        guest_clients.discard(ws)
        _on_client_disconnected("guest")


@app.websocket("/ws/operator")
async def ws_operator(ws: WebSocket) -> None:
    if not await _ensure_license_ws(ws):
        return
    if not await ensure_websocket_authorized(ws):
        return
    await ws.accept()
    operator_clients.add(ws)
    _on_client_connected("operator")
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    except Exception:
        try:
            await ws.close()
        except Exception:
            pass
    finally:
        operator_clients.discard(ws)
        _on_client_disconnected("operator")


async def broadcast(event: dict[str, object]) -> None:
    """Send JSON event to all connected guest screens."""
    dead = []
    for ws in list(guest_clients):
        try:
            await ws.send_json(event)
        except Exception:
            dead.append(ws)
    for d in dead:
        try:
            await d.close()
        except Exception:
            pass
        guest_clients.discard(d)


# ----------------- Operator window lifecycle -----------------
@app.post("/operator/window-open")
async def operator_window_open() -> dict[str, int | bool]:
    global operator_window_count
    with _operator_window_lock:
        operator_window_count += 1
        current = operator_window_count
    _log(f"Operator window opened; active windows: {current}.")
    _cancel_shutdown_timer("operator window opened")
    return {"ok": True, "active": current}


@app.post("/operator/window-closed")
async def operator_window_closed() -> dict[str, int | bool]:
    global operator_window_count
    with _operator_window_lock:
        operator_window_count = max(0, operator_window_count - 1)
        current = operator_window_count
    _log(f"Operator window closed; active windows: {current}.")
    if current == 0:
        _request_idle_check("operator window closed")
    return {"ok": True, "active": current}


def short_code() -> str:
    return token_hex(3).upper()  # 6 hex chars


# ----------------- Sessions -----------------
@app.post("/sessions", response_model=SessionOut)
def create_session(payload: SessionCreate, db: DbSessionDep) -> SessionOut:
    first = _canonicalize_name_part(payload.first_name)
    last = _canonicalize_name_part(payload.last_name)
    if not first:
        raise HTTPException(400, "First name is required.")
    client_name = _compose_client_name(first, last)
    sex = payload.sex if payload.sex in {"male", "female"} else "male"
    s = SessionRow(
        client_name=client_name,
        first_name=first,
        last_name=last,
        code=short_code(),
        sex=sex,
    )
    db.add(s)
    db.commit()
    db.refresh(s)
    if s.id is None:
        raise HTTPException(500, "Session id not initialized")
    try:
        ensure_session_scaffold(s.id)
    except Exception as exc:
        logger.exception("Failed to initialize storage for session %s: %s", s.id, exc)
        raise HTTPException(500, "Failed to initialize session storage.") from exc

    return SessionOut(
        id=s.id,
        code=s.code,
        client_name=s.client_name,
        first_name=s.first_name,
        last_name=s.last_name,
        folder_name=s.folder_name,
        state=_state_literal(s.state),
        published=s.published,
        sex=_sex_literal_required(s.sex),
    )


@app.get("/sessions", response_model=list[SessionOut])
def list_sessions(db: DbSessionDep) -> list[SessionOut]:
    rows = db.exec(select(SessionRow).order_by(desc(cast(ColumnElement[Any], SessionRow.id)))).all()
    output: list[SessionOut] = []
    for r in rows:
        if r.id is None:
            continue
        output.append(
            SessionOut(
                id=r.id,
                code=r.code,
                client_name=r.client_name,
                first_name=r.first_name,
                last_name=r.last_name,
                folder_name=r.folder_name,
                state=_state_literal(r.state),
                published=r.published,
                sex=_sex_literal_required(r.sex),
            )
        )
    return output


@app.get("/sessions/{session_id}", response_model=SessionOut)
def get_session_status(
    session_id: int,
    db: DbSessionDep,
) -> SessionOut:
    s = db.get(SessionRow, session_id)
    if not s:
        raise HTTPException(404, "Session not found")

    if s.id is None:
        raise HTTPException(500, "Session id not initialized")

    return SessionOut(
        id=s.id,
        code=s.code,
        client_name=s.client_name,
        first_name=s.first_name,
        last_name=s.last_name,
        folder_name=s.folder_name,
        state=_state_literal(s.state),
        published=s.published,
        sex=_sex_literal_required(s.sex),
    )


@app.patch("/sessions/{session_id}", response_model=SessionOut)
def update_session(
    session_id: int,
    payload: SessionUpdate,
    db: DbSessionDep,
) -> SessionOut:
    s = db.get(SessionRow, session_id)
    if not s:
        raise HTTPException(404, "Session not found")

    updated = False

    new_first = s.first_name or ""
    new_last = s.last_name or ""

    if payload.first_name is not None:
        new_first = _canonicalize_name_part(payload.first_name)
        if not new_first:
            raise HTTPException(400, "First name cannot be empty.")
        updated = True

    if payload.last_name is not None:
        new_last = _canonicalize_name_part(payload.last_name)
        updated = True

    if payload.client_name is not None:
        new_full = _canonicalize_client_name(payload.client_name)
        if not new_full:
            raise HTTPException(400, "Client name cannot be empty.")
        pieces = new_full.split(" ", 1)
        new_first = pieces[0]
        new_last = pieces[1] if len(pieces) > 1 else ""
        updated = True

    if payload.sex is not None:
        if payload.sex not in {"male", "female"}:
            raise HTTPException(400, "Sex must be 'male' or 'female'.")
        if s.sex != payload.sex:
            s.sex = payload.sex
            updated = True

    if updated:
        s.first_name = new_first
        s.last_name = new_last or None
        s.client_name = _compose_client_name(new_first, new_last)
        db.add(s)
        db.commit()
        db.refresh(s)

    if s.id is None:
        raise HTTPException(500, "Session id not initialized")

    return SessionOut(
        id=s.id,
        code=s.code,
        client_name=s.client_name,
        first_name=s.first_name,
        last_name=s.last_name,
        folder_name=s.folder_name,
        state=_state_literal(s.state),
        published=s.published,
        sex=_sex_literal_required(s.sex),
    )


# Greet immediately
@app.get("/sessions/{session_id}/banner", response_model=BannerOut)
def banner(session_id: int, db: DbSessionDep) -> BannerOut:
    s = db.get(SessionRow, session_id)
    if not s:
        raise HTTPException(404, "Session not found")
    first = s.first_name or (s.client_name.split(" ", 1)[0] if s.client_name else "Friend")
    return BannerOut(message=f"Hi, {first}, your wellness journey is about to begin.")


# ----------------- Upload / Parse / Publish -----------------
@app.post("/sessions/{session_id}/upload/{kind}", response_model=FileOut)
def upload_report(
    session_id: int,
    kind: str,
    file: UploadFileDep,
    db: DbSessionDep,
) -> FileOut:
    s = db.get(SessionRow, session_id)
    if not s:
        raise HTTPException(404, "Session not found")

    kind = kind.lower()
    info = REPORT_TYPES.get(kind)
    if not info:
        raise HTTPException(400, f"Unsupported report kind: {kind}")

    _note_job_started("upload")
    try:
        touch_session_lock(session_id)
        raw_filename = file.filename or ""
        filename = Path(raw_filename).name
        if not filename:
            raise HTTPException(400, "Uploaded file name is missing.")
        _validate_uploaded_filename(s, kind, filename)

        try:
            payload = _read_upload_payload(file, max_bytes=MAX_UPLOAD_BYTES)
        except UploadTooLargeError as exc:
            raise HTTPException(
                status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=str(exc),
            ) from exc
        if not payload:
            raise HTTPException(400, "Uploaded file is empty.")

        s.state = SessionState.INGESTING
        db.add(s)

        filehash = hashlib.sha256(payload).hexdigest()
        size = len(payload)

        fr = db.exec(
            select(FileRow).where((FileRow.session_id == session_id) & (FileRow.kind == kind))
        ).first()
        if fr:
            fr.filename = filename
            fr.filehash = filehash
            fr.size = size
            fr.status = "uploaded"
            fr.error = None
            fr.parser_version = None
        else:
            fr = FileRow(
                session_id=session_id,
                kind=kind,
                filename=filename,
                filehash=filehash,
                size=size,
                status="uploaded",
            )
        db.add(fr)
        db.commit()
        db.refresh(fr)
        if fr.id is None:
            raise HTTPException(500, "File id not initialized")
        try:
            store_upload_bytes(session_id, fr.id, filename, payload)
        except Exception as exc:
            logger.exception(
                "Failed to persist upload for session %s file %s: %s",
                session_id,
                fr.id,
                exc,
            )
            raise HTTPException(500, "Failed to persist uploaded file.") from exc
        try:
            UPLOAD_COUNTER.labels(kind=kind).inc()
            UPLOAD_BYTES.labels(kind=kind).observe(size)
        except Exception:
            logger.debug("Failed to record upload metrics for kind=%s", kind, exc_info=True)
        return FileOut(
            id=fr.id,
            kind=fr.kind,
            filename=fr.filename,
            status=fr.status,
            error=fr.error,
        )
    finally:
        _note_job_finished("upload")


@app.post("/files/{file_id}/parse", response_model=ParsedOut)
def parse_uploaded(file_id: int, db: DbSessionDep) -> ParsedOut:
    fr = db.get(FileRow, file_id)
    if not fr:
        raise HTTPException(404, "File not found")
    s = db.get(SessionRow, fr.session_id)
    if not s:
        raise HTTPException(404, "Session not found")
    if fr.kind not in {"food", "nutrition", "hormones", "heavy-metals", "toxins", "peek"}:
        raise HTTPException(400, f"Parsing not supported for report type '{fr.kind}'.")

    _note_job_started("parse")
    try:
        s.state = SessionState.PARSING
        fr.status = "validating"
        db.add(s)
        db.add(fr)
        db.commit()

        touch_session_lock(fr.session_id)
        if fr.id is None:
            raise HTTPException(500, "File id not initialized")
        payload = load_upload_bytes(fr.session_id, fr.id, fr.filename)
        if not payload:
            PARSE_COUNTER.labels(kind=fr.kind, result="failure").inc()
            logger.error("Report data missing for file %s (kind=%s)", fr.id, fr.kind)
            fr.status = "error"
            fr.error = "Report data not available. Please upload again."
            db.add(fr)
            s.state = SessionState.VALIDATING
            db.add(s)
            db.commit()
            raise HTTPException(400, "Report data not available. Please upload the file again.")

        suffix = ".pdf"
        if fr.filename:
            try:
                suffix = Path(fr.filename).suffix or ".pdf"
            except Exception:
                suffix = ".pdf"

        tmp_path: Path | None = None
        parse_started = time.perf_counter()
        try:
            tmp_dir = session_tmp_path(fr.session_id)
            with tempfile.NamedTemporaryFile(delete=False, suffix=suffix, dir=tmp_dir) as tmp:
                tmp.write(payload)
                tmp.flush()
                tmp_path = Path(tmp.name)

            version, data = parse_file(fr.kind, tmp_path)
            fr.status = "parsed"
            fr.parser_version = version
            db.add(fr)
            existing = db.exec(
                select(ParsedRow).where(
                    (ParsedRow.session_id == fr.session_id) & (ParsedRow.kind == fr.kind)
                )
            ).first()
            if existing:
                existing.data = data
                db.add(existing)
            else:
                db.add(ParsedRow(session_id=fr.session_id, kind=fr.kind, data=data))
            s.state = SessionState.READY
            db.add(s)
            db.commit()
            duration = time.perf_counter() - parse_started
            PARSE_COUNTER.labels(kind=fr.kind, result="success").inc()
            PARSE_DURATION.labels(kind=fr.kind).observe(duration)
            return ParsedOut(session_id=fr.session_id, kind=fr.kind, data=data)
        except Exception as exc:
            PARSE_COUNTER.labels(kind=fr.kind, result="failure").inc()
            fr.status = "error"
            fr.error = str(exc)
            db.add(fr)
            s.state = SessionState.VALIDATING
            db.add(s)
            db.commit()
            logger.exception("Parse failed for file %s (kind=%s)", fr.id, fr.kind)
            raise HTTPException(500, f"Parse failed: {exc}") from exc
        finally:
            if tmp_path:
                try:
                    tmp_path.unlink(missing_ok=True)
                except Exception:
                    pass
    finally:
        _note_job_finished("parse")


@app.post("/sessions/{session_id}/publish")
async def publish(
    session_id: int,
    req: PublishRequest,
    db: DbSessionDep,
) -> dict[str, bool]:
    s = db.get(SessionRow, session_id)
    if not s:
        raise HTTPException(404, "Session not found")
    s.published = bool(req.publish)
    if s.published:
        s.state = SessionState.PUBLISHED
    if req.selected_reports is not None:
        normalized = {str(k): bool(v) for k, v in req.selected_reports.items()}
        s.visible_reports = normalized
    elif not s.published:
        s.visible_reports = None
    db.add(s)
    db.commit()
    if s.published:
        try:
            remove_files_directory(session_id)
            reset_tmp_directory(session_id)
            remove_session_lock(session_id)
        except Exception as exc:
            logger.warning("Failed to finalize session %s storage cleanup: %s", session_id, exc)
    await broadcast(
        {
            "type": "published",
            "sessionId": session_id,
            "ts": time.time(),
        }
    )
    return {"ok": True, "published": s.published}


# Strict publish gate
@app.get("/sessions/{session_id}/parsed/{kind}", response_model=ParsedOut)
def get_parsed(
    session_id: int,
    kind: str,
    db: DbSessionDep,
) -> ParsedOut:
    s = db.get(SessionRow, session_id)
    if not s:
        raise HTTPException(404, "Session not found")
    if not s.published:
        raise HTTPException(403, "Results not published yet")
    pr = db.exec(
        select(ParsedRow).where((ParsedRow.session_id == session_id) & (ParsedRow.kind == kind))
    ).first()
    if not pr:
        return ParsedOut(session_id=session_id, kind=kind, data=None)
    return ParsedOut(session_id=pr.session_id, kind=pr.kind, data=pr.data)


@app.get("/sessions/{session_id}/parsed", response_model=ParsedBundleOut)
def get_parsed_bundle(
    session_id: int,
    db: DbSessionDep,
) -> ParsedBundleOut:
    s = db.get(SessionRow, session_id)
    if not s:
        raise HTTPException(404, "Session not found")
    if not s.published:
        raise HTTPException(403, "Results not published yet")
    rows = db.exec(select(ParsedRow).where(ParsedRow.session_id == session_id)).all()
    visibility = s.visible_reports or {}
    reports = {row.kind: row.data for row in rows if visibility.get(row.kind, True)}
    return ParsedBundleOut(session_id=session_id, reports=reports)


# ----------------- Guest display binding -----------------
@app.get("/display/current", response_model=DisplayOut)
def display_current(db: DbSessionDep) -> DisplayOut:
    d = db.exec(select(DisplayRow).where(DisplayRow.code == "main")).first()
    if not d or not d.current_session_id:
        staged_name = d.staged_full_name if d else None
        staged_first = d.staged_first_name if d else None
        staged_sex = _sex_literal_optional(d.staged_sex if d else None)
        return DisplayOut(
            session_id=None,
            staged_session_id=d.staged_session_id if d else None,
            staged_full_name=staged_name,
            staged_first_name=staged_first,
            staged_sex=staged_sex,
        )
    s = db.get(SessionRow, d.current_session_id)
    if not s:
        return DisplayOut(
            session_id=None,
            staged_session_id=d.staged_session_id,
            staged_full_name=d.staged_full_name,
            staged_first_name=d.staged_first_name,
            staged_sex=_sex_literal_optional(d.staged_sex),
        )
    return DisplayOut(
        session_id=s.id,
        client_name=s.client_name,
        first_name=s.first_name,
        last_name=s.last_name,
        published=s.published,
        staged_session_id=d.staged_session_id,
        staged_full_name=d.staged_full_name,
        staged_first_name=d.staged_first_name,
        sex=_sex_literal_required(s.sex),
        staged_sex=_sex_literal_optional(d.staged_sex),
    )


@app.post("/display/current")
async def display_set(
    req: DisplaySet,
    db: DbSessionDep,
) -> dict[str, bool]:
    d = db.exec(select(DisplayRow).where(DisplayRow.code == "main")).first()
    if not d:
        d = DisplayRow(code="main")
    fields = req.__fields_set__
    if "staged_session_id" in fields:
        d.staged_session_id = req.staged_session_id
        d.staged_first_name = req.staged_first_name
        d.staged_full_name = req.staged_full_name
        if req.staged_sex in {"male", "female"}:
            d.staged_sex = req.staged_sex
        elif req.staged_sex is None:
            d.staged_sex = None
    if "session_id" in fields:
        d.current_session_id = req.session_id
    db.add(d)
    db.commit()
    db.refresh(d)
    await broadcast(
        {
            "type": "displaySet",
            "sessionId": d.current_session_id,
            "stagedSessionId": d.staged_session_id,
            "ts": time.time(),
        }
    )
    return {"ok": True}


@app.post("/sessions/{session_id}/close")
def close_session(
    session_id: int,
    db: DbSessionDep,
) -> dict[str, bool]:
    s = db.get(SessionRow, session_id)
    if not s:
        raise HTTPException(404, "Session not found")
    try:
        remove_session_directory(session_id)
    except Exception as exc:
        logger.warning("Failed to clean session %s during close: %s", session_id, exc)
    s.state = SessionState.CLOSED
    s.published = False
    s.visible_reports = None
    db.add(s)
    db.commit()
    return {"ok": True}


# ----------------- Token management -----------------
@app.post("/auth/token/rotate", response_model=TokenRotateResponse)
def rotate_token_endpoint(payload: TokenRotateRequest) -> TokenRotateResponse:
    grace = max(0.0, float(payload.grace_seconds or 0.0))
    token = payload.token or generate_auth_token()
    rotate_auth_token(token, grace_seconds=grace, persist=payload.persist)
    return TokenRotateResponse(token=token, grace_seconds=grace, persisted=payload.persist)


@app.post("/auth/token/renew", response_model=TokenRotateResponse)
def renew_token_endpoint(payload: TokenRenewRequest) -> TokenRotateResponse:
    grace_default = 60.0
    grace = max(0.0, float(payload.grace_seconds or grace_default))
    token = generate_auth_token()
    rotate_auth_token(token, grace_seconds=grace, persist=payload.persist)
    return TokenRotateResponse(token=token, grace_seconds=grace, persisted=payload.persist)
