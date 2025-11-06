import importlib
import os
import sys
import time
from collections.abc import Generator
from pathlib import Path
from types import ModuleType

import pytest
from pytest import MonkeyPatch

ROOT = Path(__file__).resolve().parents[2]
BACKEND_ROOT = ROOT / "backend"


def _import_backend_modules() -> tuple[ModuleType, ModuleType]:
    if str(ROOT) not in sys.path:
        sys.path.append(str(ROOT))
    if str(BACKEND_ROOT) not in sys.path:
        sys.path.append(str(BACKEND_ROOT))
    session_fs_module = importlib.import_module("session_fs")
    paths_module = importlib.import_module("paths")
    return session_fs_module, paths_module.app_root


session_fs, app_root = _import_backend_modules()


@pytest.fixture(autouse=True)
def _reset_app_root(
    monkeypatch: MonkeyPatch,
    tmp_path: Path,
) -> Generator[None, None, None]:
    monkeypatch.setenv("LONGQ_ROOT", str(tmp_path))
    app_root.cache_clear()
    yield
    app_root.cache_clear()


def _touch_session(session_id: str, *, age_hours: float = 0.0) -> Path:
    path = session_fs.session_path(session_id)
    # ensure directory exists and adjust mtime
    past_time = time.time() - (age_hours * 3600.0)
    os.utime(path, (past_time, past_time))
    return path


def test_purge_session_directories_respects_age_threshold(monkeypatch: MonkeyPatch) -> None:
    threshold = 2.0
    older = _touch_session("old", age_hours=threshold + 1)
    recent = _touch_session("recent", age_hours=threshold - 1)

    results = session_fs.purge_session_directories(threshold, dry_run=False)
    removed_sessions = {res.session for res in results if res.removed}

    assert "old" in removed_sessions
    assert older.exists() is False
    assert "recent" not in removed_sessions
    assert recent.exists()


def test_default_retention_hours_uses_env_override(monkeypatch: MonkeyPatch) -> None:
    baseline = session_fs.default_session_retention_hours()
    monkeypatch.setenv("SESSION_FILE_RETENTION_HOURS", "12")
    app_root.cache_clear()
    module = importlib.reload(session_fs)
    try:
        assert module.default_session_retention_hours() == pytest.approx(12.0)
        assert baseline != module.default_session_retention_hours()
    finally:
        importlib.reload(session_fs)
