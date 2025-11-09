from __future__ import annotations

import json
import os
import threading
import time
from pathlib import Path
from secrets import token_hex
from typing import Any

from paths import backend_dir

_TOKEN_FILE: Path = backend_dir() / "auth_token.json"
_lock = threading.Lock()
_initialized = False
_current_token: str | None = None
_previous_token: tuple[str, float] | None = None  # (token, expires_at_epoch)


def token_file_path() -> Path:
    return _TOKEN_FILE


def _read_token_file() -> str | None:
    try:
        data = json.loads(_TOKEN_FILE.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return None
    except json.JSONDecodeError:
        return None
    token = data.get("token")
    if isinstance(token, str) and token.strip():
        return token.strip()
    return None


def _write_token_file(token: str) -> None:
    payload: dict[str, Any] = {"token": token}
    _TOKEN_FILE.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def initialize() -> None:
    global _initialized, _current_token
    if _initialized:
        return
    with _lock:
        if _initialized:
            return
        token = _read_token_file()
        if not token:
            env_token = os.getenv("LONGQ_API_TOKEN")
            if env_token:
                token = env_token.strip()
                if token:
                    try:
                        _write_token_file(token)
                    except OSError:
                        pass
        if not token:
            token = generate_token()
            try:
                _write_token_file(token)
            except OSError:
                pass
        _current_token = token.strip() if isinstance(token, str) and token else None
        _initialized = True


def current_token() -> str | None:
    initialize()
    return _current_token


def generate_token(bytes_length: int = 24) -> str:
    return token_hex(bytes_length)


def is_token_valid(candidate: str | None) -> bool:
    initialize()
    if not candidate:
        return False
    with _lock:
        global _previous_token
        now = time.time()
        prev = _previous_token
        if prev and prev[1] < now:
            prev = None
            _previous_token = None
        if _current_token and candidate == _current_token:
            return True
        if prev and candidate == prev[0]:
            return True
    return False


def rotate_token(
    new_token: str | None = None,
    *,
    grace_seconds: float = 0.0,
    persist: bool = True,
) -> str:
    initialize()
    token = new_token or generate_token()
    grace = max(0.0, grace_seconds)
    with _lock:
        global _current_token, _previous_token
        previous = _current_token
        if previous and grace > 0:
            _previous_token = (previous, time.time() + grace)
        else:
            _previous_token = None
        _current_token = token
        if persist:
            _write_token_file(token)
    return token


def token_status() -> dict[str, Any]:
    initialize()
    with _lock:
        previous_token = None
        previous_expires = None
        if _previous_token:
            previous_token, previous_expires = _previous_token
        return {
            "token": _current_token,
            "previous_token": previous_token,
            "previous_expires_at": previous_expires,
            "token_file": str(_TOKEN_FILE),
        }
