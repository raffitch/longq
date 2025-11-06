from __future__ import annotations

import os

from fastapi import Request
from starlette import status
from starlette.responses import Response
from starlette.websockets import WebSocket

_token_env = os.getenv("LONGQ_API_TOKEN")
_allow_insecure = os.getenv("LONGQ_ALLOW_INSECURE", "false").lower() in {"1", "true", "yes", "on"}

if _token_env is None and not _allow_insecure:
    raise RuntimeError(
        "LONGQ_API_TOKEN is not set. Set LONGQ_API_TOKEN or use LONGQ_ALLOW_INSECURE=1 "
        "for local testing."
    )

API_TOKEN = _token_env


def _extract_bearer_value(raw: str | None) -> str | None:
    if not raw:
        return None
    if raw.lower().startswith("bearer "):
        return raw[7:]
    return raw


def _token_matches(candidate: str | None) -> bool:
    if API_TOKEN is None:
        return True
    return candidate == API_TOKEN


def enforce_http_middleware(request: Request) -> Response | None:
    if API_TOKEN is None:
        return None
    if request.method.upper() == "OPTIONS":
        return None
    token = _extract_bearer_value(request.headers.get("Authorization"))
    if not _token_matches(token):
        return Response(status_code=status.HTTP_401_UNAUTHORIZED, content="Unauthorized")
    return None


async def ensure_websocket_authorized(ws: WebSocket) -> bool:
    if API_TOKEN is None:
        return True
    token = ws.query_params.get("token")
    if not token:
        token = _extract_bearer_value(ws.headers.get("Authorization"))
    if not _token_matches(token):
        await ws.close(code=4401)
        return False
    return True
