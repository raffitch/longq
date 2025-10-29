import hashlib, time, asyncio, os, signal, logging, re, tempfile
from pathlib import Path
from secrets import token_hex
from typing import List, Set, Optional, Dict
from threading import Lock
from fastapi import FastAPI, Depends, HTTPException, WebSocket, WebSocketDisconnect, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from sqlmodel import select, Session
from sqlalchemy import text
from db import init_db, get_session, engine
from models import SessionRow, FileRow, ParsedRow, DisplayRow
from schemas import (
    SessionCreate,
    SessionUpdate,
    SessionOut,
    PublishRequest,
    BannerOut,
    FileOut,
    ParsedOut,
    ParsedBundleOut,
    DisplayOut,
    DisplaySet,
)
from parser_adapter import parse_file


EXIT_WHEN_IDLE = os.getenv("EXIT_WHEN_IDLE", "false").lower() in {"1", "true", "yes", "on"}
try:
    EXIT_IDLE_DEBOUNCE_SEC = float(os.getenv("EXIT_IDLE_DEBOUNCE_SEC", "20"))
except ValueError:
    EXIT_IDLE_DEBOUNCE_SEC = 20.0

guest_clients: Set[WebSocket] = set()
operator_clients: Set[WebSocket] = set()

_shutdown_task: Optional[asyncio.Task] = None
_event_loop: Optional[asyncio.AbstractEventLoop] = None

logger = logging.getLogger("longevityq.backend")

BASE_DIR = Path(__file__).resolve().parent.parent

REPORT_TYPES = {
    "food": {"label": "Food", "aliases": ["food"]},
    "heavy-metals": {"label": "Heavy Metals", "aliases": ["heavy metals", "heavy-metals", "heavy_metals"]},
    "hormones": {"label": "Hormones", "aliases": ["hormones"]},
    "nutrition": {"label": "Nutrition", "aliases": ["nutrition"]},
    "toxins": {"label": "Toxins", "aliases": ["toxins"]},
}

_active_jobs = 0
_active_jobs_lock = Lock()

_upload_payloads: Dict[int, bytes] = {}
_upload_payloads_lock = Lock()


def _store_payload(file_id: int, payload: bytes) -> None:
    with _upload_payloads_lock:
        _upload_payloads[file_id] = payload


def _get_payload(file_id: int) -> Optional[bytes]:
    with _upload_payloads_lock:
        return _upload_payloads.get(file_id)


def _discard_payload(file_id: int) -> None:
    with _upload_payloads_lock:
        _upload_payloads.pop(file_id, None)

app = FastAPI(title="Quantum Qi Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_credentials=True,
    allow_methods=["*"], allow_headers=["*"],
)


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

    if not filename.lower().endswith(".pdf"):
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


def _run_in_loop(callback, *args) -> None:
    global _event_loop
    try:
        loop = asyncio.get_running_loop()
        loop.call_soon(callback, *args)
    except RuntimeError:
        loop = _event_loop
        if loop:
            loop.call_soon_threadsafe(callback, *args)


def _active_jobs_count() -> int:
    with _active_jobs_lock:
        return _active_jobs


def _cancel_shutdown_timer(reason: str) -> None:
    def _cancel():
        global _shutdown_task
        task = _shutdown_task
        if task and not task.done():
            _log(reason)
            task.cancel()
        _shutdown_task = None

    _run_in_loop(_cancel)


def _schedule_idle_check(reason: str) -> None:
    global _shutdown_task

    if not EXIT_WHEN_IDLE:
        return

    if operator_clients or guest_clients:
        return

    jobs = _active_jobs_count()
    if jobs > 0:
        _log(f"Idle shutdown postponed ({reason}); {jobs} active job(s) remain.")
        return

    task = _shutdown_task
    if task and not task.done():
        _log("Idle shutdown timer already running; no action taken.")
        return

    _log(f"All clients disconnected; scheduling idle shutdown in {EXIT_IDLE_DEBOUNCE_SEC:.1f}s ({reason}).")
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
        if operator_clients or guest_clients:
            _log("Idle shutdown aborted; clients reconnected during debounce.")
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


def _note_job_started(tag: str) -> None:
    global _active_jobs
    with _active_jobs_lock:
        _active_jobs += 1
        count = _active_jobs
    _cancel_shutdown_timer(f"Idle shutdown timer cancelled ({tag} started); {count} active job(s).")
    _log(f"Job started ({tag}); active jobs: {count}.")


def _note_job_finished(tag: str) -> None:
    global _active_jobs
    with _active_jobs_lock:
        _active_jobs = max(0, _active_jobs - 1)
        count = _active_jobs
    _log(f"Job finished ({tag}); active jobs: {count}.")
    _request_idle_check(f"job finished ({tag})")


# ----------------- WebSocket endpoints -----------------

def _on_client_connected(kind: str) -> None:
    _cancel_shutdown_timer(f"Idle shutdown timer cancelled ({kind} connected).")


def _on_client_disconnected(kind: str) -> None:
    _request_idle_check(f"{kind} disconnected")


@app.websocket("/ws/guest")
async def ws_guest(ws: WebSocket):
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
async def ws_operator(ws: WebSocket):
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

async def broadcast(event: dict):
    """Send JSON event to all connected guest screens."""
    dead = []
    for ws in list(guest_clients):
        try:
            await ws.send_json(event)
        except Exception:
            dead.append(ws)
    for d in dead:
        try:
            d.close()
        except Exception:
            pass
        guest_clients.discard(d)

# ----------------- Startup -----------------
@app.on_event("startup")
async def on_startup():
    global _event_loop
    _event_loop = asyncio.get_running_loop()
    init_db()
    _ensure_session_table_columns()
    _ensure_display_table_columns()
    # Ensure one display row exists
    with Session(engine) as db:
        d = db.exec(select(DisplayRow).where(DisplayRow.code == "main")).first()
        if not d:
            db.add(DisplayRow(code="main"))
            db.commit()

@app.on_event("shutdown")
async def on_shutdown():
    _cancel_shutdown_timer("Application shutdown requested.")
    global _event_loop
    _event_loop = None

def short_code() -> str:
    return token_hex(3).upper()  # 6 hex chars

# ----------------- Sessions -----------------
@app.post("/sessions", response_model=SessionOut)
def create_session(payload: SessionCreate, db=Depends(get_session)):
    first = _canonicalize_name_part(payload.first_name)
    last = _canonicalize_name_part(payload.last_name)
    if not first:
        raise HTTPException(400, "First name is required.")
    client_name = _compose_client_name(first, last)
    s = SessionRow(client_name=client_name, first_name=first, last_name=last, code=short_code())
    db.add(s); db.commit(); db.refresh(s)
    return SessionOut(
        id=s.id,
        code=s.code,
        client_name=s.client_name,
        first_name=s.first_name,
        last_name=s.last_name,
        folder_name=s.folder_name,
        state=s.state,
        published=s.published,
    )

@app.get("/sessions", response_model=List[SessionOut])
def list_sessions(db=Depends(get_session)):
    rows = db.exec(select(SessionRow).order_by(SessionRow.id.desc())).all()
    return [
        SessionOut(
            id=r.id,
            code=r.code,
            client_name=r.client_name,
            first_name=r.first_name,
            last_name=r.last_name,
            folder_name=r.folder_name,
            state=r.state,
            published=r.published,
        )
        for r in rows
    ]

@app.get("/sessions/{session_id}", response_model=SessionOut)
def get_session_status(session_id: int, db=Depends(get_session)):
    s = db.get(SessionRow, session_id)
    if not s: raise HTTPException(404, "Session not found")
    return SessionOut(
        id=s.id,
        code=s.code,
        client_name=s.client_name,
        first_name=s.first_name,
        last_name=s.last_name,
        folder_name=s.folder_name,
        state=s.state,
        published=s.published,
    )

@app.patch("/sessions/{session_id}", response_model=SessionOut)
def update_session(session_id: int, payload: SessionUpdate, db=Depends(get_session)):
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

    if updated:
        s.first_name = new_first
        s.last_name = new_last or None
        s.client_name = _compose_client_name(new_first, new_last)
        db.add(s)
        db.commit()
        db.refresh(s)

    return SessionOut(
        id=s.id,
        code=s.code,
        client_name=s.client_name,
        first_name=s.first_name,
        last_name=s.last_name,
        folder_name=s.folder_name,
        state=s.state,
        published=s.published,
    )

# Greet immediately
@app.get("/sessions/{session_id}/banner", response_model=BannerOut)
def banner(session_id: int, db=Depends(get_session)):
    s = db.get(SessionRow, session_id)
    if not s: raise HTTPException(404, "Session not found")
    first = s.first_name or (s.client_name.split(" ", 1)[0] if s.client_name else "Friend")
    return BannerOut(message=f"Hi, {first}, your wellness journey is about to begin.")

# ----------------- Upload / Parse / Publish -----------------
@app.post("/sessions/{session_id}/upload/{kind}", response_model=FileOut)
def upload_report(session_id: int, kind: str, file: UploadFile = File(...), db=Depends(get_session)):
    s = db.get(SessionRow, session_id)
    if not s: raise HTTPException(404, "Session not found")

    kind = kind.lower()
    info = REPORT_TYPES.get(kind)
    if not info:
        raise HTTPException(400, f"Unsupported report kind: {kind}")

    _note_job_started("upload")
    try:
        filename = Path(file.filename).name
        if not filename:
            raise HTTPException(400, "Uploaded file name is missing.")
        _validate_uploaded_filename(s, kind, filename)

        payload = file.file.read()
        if not payload:
            raise HTTPException(400, "Uploaded file is empty.")

        s.state = "INGESTING"
        db.add(s)

        filehash = hashlib.sha256(payload).hexdigest()
        size = len(payload)

        fr = db.exec(select(FileRow).where(
            (FileRow.session_id == session_id) & (FileRow.kind == kind)
        )).first()
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
        db.add(fr); db.commit(); db.refresh(fr)
        if fr.id is not None:
            _store_payload(fr.id, payload)
        return FileOut(id=fr.id, kind=fr.kind, filename=fr.filename, status=fr.status, error=fr.error)
    finally:
        _note_job_finished("upload")

@app.post("/files/{file_id}/parse", response_model=ParsedOut)
def parse_uploaded(file_id: int, db=Depends(get_session)):
    fr = db.get(FileRow, file_id)
    if not fr: raise HTTPException(404, "File not found")
    s = db.get(SessionRow, fr.session_id)
    if not s: raise HTTPException(404, "Session not found")
    if fr.kind not in {"food", "nutrition", "hormones", "heavy-metals", "toxins"}:
        raise HTTPException(400, f"Parsing not supported for report type '{fr.kind}'.")

    _note_job_started("parse")
    try:
        s.state = "PARSING"; fr.status = "validating"; db.add(s); db.add(fr); db.commit()

        payload = _get_payload(fr.id)
        if not payload:
            fr.status = "error"; fr.error = "Report data not available. Please upload again."; db.add(fr)
            s.state = "VALIDATING"; db.add(s); db.commit()
            raise HTTPException(400, "Report data not available. Please upload the PDF again.")

        suffix = ".pdf"
        if fr.filename:
            try:
                suffix = Path(fr.filename).suffix or ".pdf"
            except Exception:
                suffix = ".pdf"

        tmp_path: Optional[Path] = None
        try:
            with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
                tmp.write(payload)
                tmp.flush()
                tmp_path = Path(tmp.name)

            version, data = parse_file(fr.kind, tmp_path)
            fr.status = "parsed"; fr.parser_version = version
            db.add(fr)
            existing = db.exec(select(ParsedRow).where(
                (ParsedRow.session_id == fr.session_id) & (ParsedRow.kind == fr.kind)
            )).first()
            if existing:
                existing.data = data
                db.add(existing)
            else:
                db.add(ParsedRow(session_id=fr.session_id, kind=fr.kind, data=data))
            s.state = "READY"; db.add(s)
            db.commit()
            _discard_payload(fr.id)
            return ParsedOut(session_id=fr.session_id, kind=fr.kind, data=data)
        except Exception as e:
            fr.status = "error"; fr.error = str(e); db.add(fr)
            s.state = "VALIDATING"; db.add(s)
            db.commit()
            raise HTTPException(500, f"Parse failed: {e}")
        finally:
            if tmp_path:
                try:
                    tmp_path.unlink(missing_ok=True)
                except Exception:
                    pass
    finally:
        _note_job_finished("parse")

@app.post("/sessions/{session_id}/publish")
async def publish(session_id: int, req: PublishRequest, db=Depends(get_session)):
    s = db.get(SessionRow, session_id)
    if not s: raise HTTPException(404, "Session not found")
    s.published = bool(req.publish)
    if s.published: s.state = "PUBLISHED"
    if req.selected_reports is not None:
        normalized = {str(k): bool(v) for k, v in req.selected_reports.items()}
        s.visible_reports = normalized
    elif not s.published:
        s.visible_reports = None
    db.add(s); db.commit()
    # push an event so guest screens update immediately
    asyncio.create_task(broadcast({"type": "published", "sessionId": session_id, "ts": time.time()}))
    return {"ok": True, "published": s.published}

# Strict publish gate
@app.get("/sessions/{session_id}/parsed/{kind}", response_model=ParsedOut)
def get_parsed(session_id: int, kind: str, db=Depends(get_session)):
    s = db.get(SessionRow, session_id)
    if not s: raise HTTPException(404, "Session not found")
    if not s.published:
        raise HTTPException(403, "Results not published yet")
    pr = db.exec(select(ParsedRow).where(
        (ParsedRow.session_id == session_id) & (ParsedRow.kind == kind)
    )).first()
    if not pr:
        return ParsedOut(session_id=session_id, kind=kind, data=None)
    return ParsedOut(session_id=pr.session_id, kind=pr.kind, data=pr.data)

@app.get("/sessions/{session_id}/parsed", response_model=ParsedBundleOut)
def get_parsed_bundle(session_id: int, db=Depends(get_session)):
    s = db.get(SessionRow, session_id)
    if not s:
        raise HTTPException(404, "Session not found")
    if not s.published:
        raise HTTPException(403, "Results not published yet")
    rows = db.exec(select(ParsedRow).where(ParsedRow.session_id == session_id)).all()
    visibility = s.visible_reports or {}
    reports = {
        row.kind: row.data
        for row in rows
        if visibility.get(row.kind, True)
    }
    return ParsedBundleOut(session_id=session_id, reports=reports)

# ----------------- Guest display binding -----------------
@app.get("/display/current", response_model=DisplayOut)
def display_current(db=Depends(get_session)):
    d = db.exec(select(DisplayRow).where(DisplayRow.code == "main")).first()
    if not d or not d.current_session_id:
        staged_name = d.staged_full_name if d else None
        staged_first = d.staged_first_name if d else None
        return DisplayOut(session_id=None, staged_session_id=d.staged_session_id if d else None, staged_full_name=staged_name, staged_first_name=staged_first)
    s = db.get(SessionRow, d.current_session_id)
    if not s:
        return DisplayOut(session_id=None, staged_session_id=d.staged_session_id, staged_full_name=d.staged_full_name, staged_first_name=d.staged_first_name)
    return DisplayOut(
        session_id=s.id,
        client_name=s.client_name,
        first_name=s.first_name,
        last_name=s.last_name,
        published=s.published,
        staged_session_id=d.staged_session_id,
        staged_full_name=d.staged_full_name,
        staged_first_name=d.staged_first_name,
    )

@app.post("/display/current")
async def display_set(req: DisplaySet, db=Depends(get_session)):
    d = db.exec(select(DisplayRow).where(DisplayRow.code == "main")).first()
    if not d:
        d = DisplayRow(code="main")
    fields = req.__fields_set__
    if "staged_session_id" in fields:
        d.staged_session_id = req.staged_session_id
        d.staged_first_name = req.staged_first_name
        d.staged_full_name = req.staged_full_name
    if "session_id" in fields:
        d.current_session_id = req.session_id
    db.add(d); db.commit(); db.refresh(d)
    # push an event so guest screens update instantly
    asyncio.create_task(
        broadcast(
            {
                "type": "displaySet",
                "sessionId": d.current_session_id,
                "stagedSessionId": d.staged_session_id,
                "ts": time.time(),
            }
        )
    )
    return {"ok": True}
