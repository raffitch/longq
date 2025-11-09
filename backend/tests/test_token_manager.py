import importlib
import os
from pathlib import Path
from types import ModuleType

import pytest


def _reload_token_manager(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> ModuleType:
    import paths

    monkeypatch.setenv("LONGQ_ROOT", str(tmp_path))
    paths.app_root.cache_clear()
    monkeypatch.delenv("LONGQ_API_TOKEN", raising=False)
    monkeypatch.delenv("LONGQ_ALLOW_INSECURE", raising=False)
    assert "LONGQ_API_TOKEN" not in os.environ
    module = importlib.import_module("token_manager")
    return importlib.reload(module)


def test_rotate_persists_to_disk(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    token_manager = _reload_token_manager(monkeypatch, tmp_path)
    assert token_manager.current_token() is not None
    token_manager.rotate_token("initial-token", persist=True)
    assert token_manager.current_token() == "initial-token"
    token_file = token_manager.token_file_path()
    assert token_file.exists()
    assert "initial-token" in token_file.read_text(encoding="utf-8")


def test_previous_token_valid_during_grace(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    token_manager = _reload_token_manager(monkeypatch, tmp_path)
    clock = {"now": 1000.0}

    def fake_time() -> float:
        return clock["now"]

    monkeypatch.setattr(token_manager.time, "time", fake_time)
    token_manager.rotate_token("old-token", persist=False)
    clock["now"] = 1010.0
    token_manager.rotate_token("new-token", grace_seconds=20, persist=False)
    assert token_manager.is_token_valid("new-token")
    assert token_manager.is_token_valid("old-token")
    clock["now"] = 1040.0
    assert not token_manager.is_token_valid("old-token")
