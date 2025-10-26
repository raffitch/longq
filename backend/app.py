import hashlib, time, asyncio, os, signal, logging
from secrets import token_hex
from typing import List, Set, Optional
from threading import Lock
from fastapi import FastAPI, UploadFile, File, Depends, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from sqlmodel import select, Session
from db import init_db, get_session, engine
from models import SessionRow, FileRow, ParsedRow, DisplayRow
from schemas import SessionCreate, SessionOut, PublishRequest, BannerOut, FileOut, ParsedOut, DisplayOut, DisplaySet
from storage import save_upload, open_temp_copy, clear_uploads, discard_upload
from parser_adapter import parse_file


EXIT_WHEN_IDLE = os.getenv("EXIT_WHEN_IDLE", "false").lower() in {"1", "true", "yes", "on"}
try:
    EXIT_IDLE_DEBOUNCE_SEC = float(os.getenv("EXIT_IDLE_DEBOUNCE_SEC", "20"))
except ValueError:
    EXIT_IDLE_DEBOUNCE_SEC = 20.0

patient_clients: Set[WebSocket] = set()
operator_clients: Set[WebSocket] = set()

_shutdown_task: Optional[asyncio.Task] = None
_event_loop: Optional[asyncio.AbstractEventLoop] = None

logger = logging.getLogger("longevityq.backend")

_active_jobs = 0
_active_jobs_lock = Lock()

app = FastAPI(title="LongevityQ Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_credentials=True,
    allow_methods=["*"], allow_headers=["*"],
)

# ----------------- Idle shutdown utilities -----------------

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

    if operator_clients or patient_clients:
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
        if operator_clients or patient_clients:
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


@app.websocket("/ws/patient")
async def ws_patient(ws: WebSocket):
    await ws.accept()
    patient_clients.add(ws)
    _on_client_connected("patient")
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
        patient_clients.discard(ws)
        _on_client_disconnected("patient")


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
    """Send JSON event to all connected patient screens."""
    dead = []
    for ws in list(patient_clients):
        try:
            await ws.send_json(event)
        except Exception:
            dead.append(ws)
    for d in dead:
        try:
            d.close()
        except Exception:
            pass
        patient_clients.discard(d)

# ----------------- Startup -----------------
@app.on_event("startup")
async def on_startup():
    global _event_loop
    _event_loop = asyncio.get_running_loop()
    clear_uploads()
    init_db()
    # Ensure one display row exists
    with Session(engine) as db:
        d = db.exec(select(DisplayRow).where(DisplayRow.code == "main")).first()
        if not d:
            db.add(DisplayRow(code="main"))
            db.commit()

@app.on_event("shutdown")
async def on_shutdown():
    _cancel_shutdown_timer("Application shutdown requested.")
    clear_uploads()
    global _event_loop
    _event_loop = None

def short_code() -> str:
    return token_hex(3).upper()  # 6 hex chars

# ----------------- Sessions -----------------
@app.post("/sessions", response_model=SessionOut)
def create_session(payload: SessionCreate, db=Depends(get_session)):
    s = SessionRow(client_name=payload.client_name, code=short_code())
    db.add(s); db.commit(); db.refresh(s)
    return SessionOut(id=s.id, code=s.code, client_name=s.client_name, state=s.state, published=s.published)

@app.get("/sessions", response_model=List[SessionOut])
def list_sessions(db=Depends(get_session)):
    rows = db.exec(select(SessionRow).order_by(SessionRow.id.desc())).all()
    return [SessionOut(id=r.id, code=r.code, client_name=r.client_name, state=r.state, published=r.published) for r in rows]

@app.get("/sessions/{session_id}", response_model=SessionOut)
def get_session_status(session_id: int, db=Depends(get_session)):
    s = db.get(SessionRow, session_id)
    if not s: raise HTTPException(404, "Session not found")
    return SessionOut(id=s.id, code=s.code, client_name=s.client_name, state=s.state, published=s.published)

# Greet immediately
@app.get("/sessions/{session_id}/banner", response_model=BannerOut)
def banner(session_id: int, db=Depends(get_session)):
    s = db.get(SessionRow, session_id)
    if not s: raise HTTPException(404, "Session not found")
    return BannerOut(message=f"Hi, {s.client_name}, your wellness journey is about to begin.")

# ----------------- Upload / Parse / Publish -----------------
@app.post("/sessions/{session_id}/upload/{kind}", response_model=FileOut)
def upload_pdf(session_id: int, kind: str, file: UploadFile = File(...), db=Depends(get_session)):
    s = db.get(SessionRow, session_id)
    if not s: raise HTTPException(404, "Session not found")

    _note_job_started("upload")
    try:
        s.state = "INGESTING"
        db.add(s)

        payload = save_upload(session_id, kind, file.file)
        filehash = hashlib.sha256(payload).hexdigest()
        size = len(payload)

        fr = FileRow(session_id=session_id, kind=kind, filename=file.filename,
                     filehash=filehash, size=size, status="uploaded")
        db.add(fr); db.commit(); db.refresh(fr)
        return FileOut(id=fr.id, kind=fr.kind, filename=fr.filename, status=fr.status, error=fr.error)
    finally:
        _note_job_finished("upload")

@app.post("/files/{file_id}/parse", response_model=ParsedOut)
def parse_uploaded(file_id: int, db=Depends(get_session)):
    fr = db.get(FileRow, file_id)
    if not fr: raise HTTPException(404, "File not found")
    s = db.get(SessionRow, fr.session_id)
    if not s: raise HTTPException(404, "Session not found")

    _note_job_started("parse")
    try:
        s.state = "PARSING"; fr.status = "validating"; db.add(s); db.add(fr); db.commit()

        pdf_path = None
        try:
            pdf_path = open_temp_copy(fr.session_id, fr.kind)
        except FileNotFoundError:
            raise HTTPException(400, "PDF not found")
        try:
            version, data = parse_file(fr.kind, pdf_path)
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
            return ParsedOut(session_id=fr.session_id, kind=fr.kind, data=data)
        except Exception as e:
            fr.status = "error"; fr.error = str(e); db.add(fr)
            s.state = "VALIDATING"; db.add(s)
            db.commit()
            raise HTTPException(500, f"Parse failed: {e}")
        finally:
            if pdf_path is not None:
                try:
                    pdf_path.unlink(missing_ok=True)
                except Exception:
                    pass
            discard_upload(fr.session_id, fr.kind)
    finally:
        _note_job_finished("parse")

@app.post("/sessions/{session_id}/publish")
async def publish(session_id: int, req: PublishRequest, db=Depends(get_session)):
    s = db.get(SessionRow, session_id)
    if not s: raise HTTPException(404, "Session not found")
    s.published = bool(req.publish)
    if s.published: s.state = "PUBLISHED"
    db.add(s); db.commit()
    # push an event so patient screens update immediately
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
    if not pr: raise HTTPException(404, "Parsed data not found")
    return ParsedOut(session_id=pr.session_id, kind=pr.kind, data=pr.data)

# ----------------- Patient display binding -----------------
@app.get("/display/current", response_model=DisplayOut)
def display_current(db=Depends(get_session)):
    d = db.exec(select(DisplayRow).where(DisplayRow.code == "main")).first()
    if not d or not d.current_session_id:
        return DisplayOut(session_id=None)
    s = db.get(SessionRow, d.current_session_id)
    if not s:
        return DisplayOut(session_id=None)
    return DisplayOut(session_id=s.id, client_name=s.client_name, published=s.published)

@app.post("/display/current")
async def display_set(req: DisplaySet, db=Depends(get_session)):
    d = db.exec(select(DisplayRow).where(DisplayRow.code == "main")).first()
    if not d:
        d = DisplayRow(code="main")
    d.current_session_id = req.session_id
    db.add(d); db.commit()
    # push an event so patient screens update instantly
    asyncio.create_task(broadcast({"type": "displaySet", "sessionId": req.session_id, "ts": time.time()}))
    return {"ok": True}
