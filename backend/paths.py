import os
from functools import lru_cache
from pathlib import Path


_REPO_ROOT = Path(__file__).resolve().parent.parent
_DEFAULT_ROOT = _REPO_ROOT / "data"


@lru_cache(maxsize=1)
def app_root() -> Path:
    """Return the root directory for runtime state (logs, db, sessions, runtime metadata)."""
    env_root = os.getenv("LONGQ_ROOT")
    root = Path(env_root).expanduser() if env_root else _DEFAULT_ROOT
    root.mkdir(parents=True, exist_ok=True)
    return root


def backend_dir() -> Path:
    path = app_root() / "backend"
    path.mkdir(parents=True, exist_ok=True)
    return path


def sessions_dir() -> Path:
    path = app_root() / "sessions"
    path.mkdir(parents=True, exist_ok=True)
    return path


def runtime_dir() -> Path:
    path = app_root() / "runtime"
    path.mkdir(parents=True, exist_ok=True)
    return path


def logs_dir() -> Path:
    path = app_root() / "logs"
    path.mkdir(parents=True, exist_ok=True)
    return path


def ensure_app_dirs() -> None:
    """Ensure all primary directories exist."""
    backend_dir()
    sessions_dir()
    runtime_dir()
    logs_dir()

