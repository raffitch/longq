from __future__ import annotations

import shutil
from pathlib import Path
from typing import Iterable, Optional

from paths import sessions_dir

SESSION_LOCK_NAME = "session.lock"


def _session_id_to_str(session_id: int | str) -> str:
    return str(session_id)


def session_path(session_id: int | str) -> Path:
    path = sessions_dir() / _session_id_to_str(session_id)
    path.mkdir(parents=True, exist_ok=True)
    return path


def session_files_path(session_id: int | str) -> Path:
    path = session_path(session_id) / "files"
    path.mkdir(parents=True, exist_ok=True)
    return path


def session_tmp_path(session_id: int | str) -> Path:
    path = session_path(session_id) / "tmp"
    path.mkdir(parents=True, exist_ok=True)
    return path


def session_lock_path(session_id: int | str) -> Path:
    return session_path(session_id) / SESSION_LOCK_NAME


def ensure_session_scaffold(session_id: int | str) -> None:
    session_files_path(session_id)
    session_tmp_path(session_id)
    touch_session_lock(session_id)


def touch_session_lock(session_id: int | str) -> None:
    lock_path = session_lock_path(session_id)
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    lock_path.touch()


def remove_session_lock(session_id: int | str) -> None:
    lock_path = session_lock_path(session_id)
    try:
        lock_path.unlink()
    except FileNotFoundError:
        pass


def reset_tmp_directory(session_id: int | str) -> None:
    tmp_dir = session_path(session_id) / "tmp"
    if tmp_dir.exists():
        shutil.rmtree(tmp_dir, ignore_errors=True)
    tmp_dir.mkdir(parents=True, exist_ok=True)


def build_upload_filename(file_id: int, original_filename: Optional[str]) -> str:
    suffix = ""
    if original_filename:
        suffix = Path(original_filename).suffix
    if not suffix:
        suffix = ".pdf"
    # ensure suffix starts with dot
    if not suffix.startswith("."):
        suffix = f".{suffix}"
    return f"{file_id}{suffix}"


def store_upload_bytes(session_id: int | str, file_id: int, original_filename: Optional[str], payload: bytes) -> Path:
    files_dir = session_files_path(session_id)
    target = files_dir / build_upload_filename(file_id, original_filename)
    target.write_bytes(payload)
    return target


def load_upload_bytes(session_id: int | str, file_id: int, original_filename: Optional[str]) -> Optional[bytes]:
    files_dir = session_files_path(session_id)
    target = files_dir / build_upload_filename(file_id, original_filename)
    if target.exists():
        try:
            return target.read_bytes()
        except Exception:
            return None
    return None


def remove_files_directory(session_id: int | str) -> None:
    files_dir = session_path(session_id) / "files"
    if files_dir.exists():
        shutil.rmtree(files_dir, ignore_errors=True)


def remove_session_directory(session_id: int | str) -> None:
    path = session_path(session_id)
    if path.exists():
        shutil.rmtree(path, ignore_errors=True)


def iter_session_dirs() -> Iterable[Path]:
    root = sessions_dir()
    if not root.exists():
        return []
    return (p for p in root.iterdir() if p.is_dir())
