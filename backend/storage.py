from pathlib import Path

BASE = Path("./data").resolve()

def session_dir(session_id: int) -> Path:
    p = BASE / "sessions" / str(session_id)
    p.mkdir(parents=True, exist_ok=True)
    return p

def save_upload(session_id: int, kind: str, filename: str, fileobj) -> Path:
    sdir = session_dir(session_id)
    target = sdir / f"{kind}.pdf"
    with open(target, "wb") as f:
        f.write(fileobj.read())
    return target
