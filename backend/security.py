from __future__ import annotations

import os

from fastapi import Request
from starlette import status
from starlette.responses import Response
from starlette.websockets import WebSocket

from token_manager import current_token, is_token_valid
from token_manager import initialize as initialize_tokens

_allow_insecure = os.getenv("LONGQ_ALLOW_INSECURE", "false").lower() in {"1", "true", "yes", "on"}

initialize_tokens()

if current_token() is None and not _allow_insecure:
    raise RuntimeError(
        "Authentication token is not configured. Set LONGQ_API_TOKEN, place auth_token.json under "
        "backend/, or use LONGQ_ALLOW_INSECURE=1 for local testing."
    )


def _extract_bearer_value(raw: str | None) -> str | None:
    if not raw:
        return None
    if raw.lower().startswith("bearer "):
        return raw[7:]
    return raw


def _token_matches(candidate: str | None) -> bool:
    if _allow_insecure:
        return True
    token = current_token()
    if token is None:
        return True
    return bool(is_token_valid(candidate))


def enforce_http_middleware(request: Request) -> Response | None:
    if _allow_insecure or current_token() is None:
        return None
    if request.method.upper() == "OPTIONS":
        return None
    token = _extract_bearer_value(request.headers.get("Authorization"))
    if not _token_matches(token):
        return Response(status_code=status.HTTP_401_UNAUTHORIZED, content="Unauthorized")
    return None


async def ensure_websocket_authorized(ws: WebSocket) -> bool:
    if _allow_insecure or current_token() is None:
        return True
    token = ws.query_params.get("token")
    if not token:
        token = _extract_bearer_value(ws.headers.get("Authorization"))
    if not _token_matches(token):
        await ws.close(code=4401)
        return False
    return True
