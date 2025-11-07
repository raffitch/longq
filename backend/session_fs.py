from __future__ import annotations

import errno
import os
import shutil
import time
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import cast

from paths import sessions_dir

SESSION_LOCK_NAME = "session.lock"
_REMOVE_ATTEMPTS = 5
_REMOVE_BACKOFF_SECONDS = 0.2

try:
    _DEFAULT_RETENTION_HOURS = float(os.getenv("SESSION_FILE_RETENTION_HOURS", "168"))
except ValueError:
    _DEFAULT_RETENTION_HOURS = 168.0


def default_session_retention_hours() -> float:
    """Return the configured retention window (hours) for session directories."""
    return _DEFAULT_RETENTION_HOURS


@dataclass(frozen=True)
class SessionRetentionResult:
    session: str
    age_hours: float
    removed: bool


def _session_id_to_str(session_id: int | str) -> str:
    return str(session_id)


def _sessions_root() -> Path:
    return cast(Path, sessions_dir())


def session_path(session_id: int | str) -> Path:
    path = _sessions_root() / _session_id_to_str(session_id)
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
    _robust_rmtree(tmp_dir)
    tmp_dir.mkdir(parents=True, exist_ok=True)


def build_upload_filename(file_id: int, original_filename: str | None) -> str:
    suffix = ""
    if original_filename:
        suffix = Path(original_filename).suffix
    if not suffix:
        suffix = ".pdf"
    # ensure suffix starts with dot
    if not suffix.startswith("."):
        suffix = f".{suffix}"
    return f"{file_id}{suffix}"


def store_upload_bytes(
    session_id: int | str,
    file_id: int,
    original_filename: str | None,
    payload: bytes,
) -> Path:
    files_dir = session_files_path(session_id)
    target = files_dir / build_upload_filename(file_id, original_filename)
    target.write_bytes(payload)
    return target


def load_upload_bytes(
    session_id: int | str,
    file_id: int,
    original_filename: str | None,
) -> bytes | None:
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
    _robust_rmtree(files_dir)


def remove_session_directory(session_id: int | str) -> None:
    path = session_path(session_id)
    _robust_rmtree(path)


def iter_session_dirs() -> Iterable[Path]:
    root = _sessions_root()
    if not root.exists():
        return []
    return (p for p in root.iterdir() if p.is_dir())


def _session_age_hours(path: Path, *, reference: float | None = None) -> float | None:
    try:
        stat = path.stat()
    except FileNotFoundError:
        return None
    now = reference or time.time()
    age_seconds = max(0.0, now - stat.st_mtime)
    return age_seconds / 3600.0


def purge_session_directories(
    max_age_hours: float,
    dry_run: bool = False,
) -> list[SessionRetentionResult]:
    """
    Remove session directories older than the specified age threshold.

    Returns details for each directory evaluated for removal.
    """
    results: list[SessionRetentionResult] = []
    if max_age_hours <= 0:
        return results
    reference = time.time()
    for session_dir in iter_session_dirs():
        age_hours = _session_age_hours(session_dir, reference=reference)
        if age_hours is None or age_hours < max_age_hours:
            continue
        removed = False
        if not dry_run:
            _robust_rmtree(session_dir)
            removed = True
        results.append(
            SessionRetentionResult(
                session=session_dir.name,
                age_hours=age_hours,
                removed=removed,
            )
        )
    return results


def _robust_rmtree(target: Path) -> None:
    if not target.exists():
        return
    attempts = 0
    last_error: OSError | None = None
    while attempts < _REMOVE_ATTEMPTS:
        try:
            shutil.rmtree(target)
            return
        except FileNotFoundError:
            return
        except PermissionError as exc:
            last_error = exc
            attempts += 1
            time.sleep(_REMOVE_BACKOFF_SECONDS * attempts)
        except OSError as exc:
            if exc.errno not in {errno.EACCES, errno.EPERM}:
                raise
            last_error = exc
            attempts += 1
            time.sleep(_REMOVE_BACKOFF_SECONDS * attempts)
    if last_error is not None:
        raise last_error
