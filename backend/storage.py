from pathlib import Path
from tempfile import NamedTemporaryFile

_UPLOAD_CACHE: dict[tuple[int, str], bytes] = {}


def save_upload(session_id: int, kind: str, fileobj) -> bytes:
    """Store the uploaded PDF bytes in memory and return the raw payload."""
    data = fileobj.read()
    _UPLOAD_CACHE[(session_id, kind)] = data
    return data


def open_temp_copy(session_id: int, kind: str) -> Path:
    """Write the in-memory PDF to a temporary file and return its path."""
    data = _UPLOAD_CACHE.get((session_id, kind))
    if data is None:
        raise FileNotFoundError("No PDF stored for this session/kind")
    tmp = NamedTemporaryFile(delete=False, suffix=".pdf")
    tmp.write(data)
    tmp.flush()
    tmp.close()
    return Path(tmp.name)


def clear_uploads() -> None:
    """Remove all stored PDF bytes from memory."""
    _UPLOAD_CACHE.clear()


def discard_upload(session_id: int, kind: str) -> None:
    """Drop a specific upload from the in-memory cache."""
    _UPLOAD_CACHE.pop((session_id, kind), None)
