import asyncio
import importlib
from collections.abc import AsyncGenerator
from pathlib import Path
from types import ModuleType
from typing import Self

import pytest
import pytest_asyncio
from pytest import MonkeyPatch


class DummyServer:
    def __init__(self: Self) -> None:
        self.should_exit = False


@pytest_asyncio.fixture
async def idle_app(monkeypatch: MonkeyPatch) -> AsyncGenerator[ModuleType, None]:
    monkeypatch.setenv("EXIT_WHEN_IDLE", "true")
    monkeypatch.setenv("EXIT_IDLE_DEBOUNCE_SEC", "0.05")
    monkeypatch.setenv("LONGQ_API_TOKEN", "test-token")
    repo_root = Path(__file__).resolve().parents[2]
    backend_dir = repo_root / "backend"
    monkeypatch.chdir(backend_dir)
    monkeypatch.syspath_prepend(str(backend_dir))
    module = importlib.import_module("app")
    module = importlib.reload(module)
    await module.on_startup()
    module.operator_clients.clear()
    module.guest_clients.clear()
    module.app.state.uvicorn_server = DummyServer()
    yield module
    module.operator_clients.clear()
    module.guest_clients.clear()
    module.app.state.uvicorn_server = None
    await module.on_shutdown()


@pytest.mark.asyncio
async def test_idle_shutdown_triggers_after_debounce(idle_app: ModuleType) -> None:
    idle_app.operator_clients.clear()
    idle_app.guest_clients.clear()

    idle_app._request_idle_check("test idle")
    await asyncio.sleep(0.1)

    assert idle_app.app.state.uvicorn_server.should_exit is True


@pytest.mark.asyncio
async def test_idle_shutdown_cancelled_when_client_returns(idle_app: ModuleType) -> None:
    idle_app.operator_clients.clear()
    idle_app.guest_clients.clear()

    idle_app._request_idle_check("initial disconnect")
    await asyncio.sleep(0.02)
    idle_app._on_client_connected("operator")
    await asyncio.sleep(0.1)

    assert idle_app.app.state.uvicorn_server.should_exit is False


@pytest.mark.asyncio
async def test_idle_shutdown_waits_for_active_jobs(idle_app: ModuleType) -> None:
    idle_app.operator_clients.clear()
    idle_app.guest_clients.clear()

    idle_app._note_job_started("parse")
    idle_app._request_idle_check("all clients gone")
    await asyncio.sleep(0.1)
    # still running job, shutdown should not trigger
    assert idle_app.app.state.uvicorn_server.should_exit is False

    idle_app._note_job_finished("parse")
    await asyncio.sleep(0.1)

    assert idle_app.app.state.uvicorn_server.should_exit is True
