"""Dashboard WebSocket route: the /api/ws gateway.

Helpers/state that tests monkeypatch on ``web_server`` stay there and are
reached through the late-binding seam (cycle-safe).
"""

import asyncio
import logging
from typing import Optional

from fastapi import APIRouter, WebSocket

from scout_backend.web_deps import late

_log = logging.getLogger("scout_backend.web_server")
router = APIRouter()

# Late-bound so a test's monkeypatch on the owning module wins at call time.
_profile_scope = late("_profile_scope", "scout_backend.web_server_profiles")
_resolve_profile_dir = late("_resolve_profile_dir", "scout_backend.web_server_profiles")
_ws_auth_reason = late("_ws_auth_reason", "scout_backend.web_server_chat")
_ws_client_reason = late("_ws_client_reason", "scout_backend.web_server_chat")
_ws_host_origin_reason = late("_ws_host_origin_reason", "scout_backend.web_server_chat")


def _ws_auth_mode() -> str:
    """Short label for the active WS auth mode — logged on every connection."""
    from scout_backend.web_server_chat import _LOOPBACK_HOSTS
    from scout_backend.web_server import app
    if getattr(app.state, "auth_required", False):
        return "gated"
    bound_host = (getattr(app.state, "bound_host", "") or "").strip().lower()
    if bound_host and bound_host not in _LOOPBACK_HOSTS:
        return "insecure"
    return "loopback"


def _ws_close_reason(text: str) -> str:
    """Clamp to RFC 6455's 123-byte close-reason limit (uvicorn raises past it);
    reasons embed an attacker-controlled origin, so truncate rather than crash."""
    encoded = text.encode("utf-8", "replace")
    if len(encoded) <= 123:
        return text
    return encoded[:120].decode("utf-8", "ignore") + "..."


async def _ws_gate(ws: WebSocket, kind: str) -> Optional[tuple[str, str, str]]:
    """Run the pre-accept gates for /api/console.

    Each gate maps to a distinct close code so the log and the browser banner
    agree on the cause: 4401 bad credential, 4403
    host/origin mismatch, 4408 peer not allowed. Returns ``(peer, mode, cred)``
    once every gate passes, or None after closing the socket.
    """
    peer = ws.client.host if ws.client else "?"

    auth_reason, cred = _ws_auth_reason(ws)
    mode = _ws_auth_mode()
    if auth_reason is not None:
        _log.warning("%s auth rejected reason=%s mode=%s cred=%s peer=%s", kind, auth_reason, mode, cred, peer)
        await ws.close(code=4401, reason=_ws_close_reason(f"auth: {auth_reason}"))
        return None

    host_origin_reason = _ws_host_origin_reason(ws)
    if host_origin_reason is not None:
        _log.warning("%s refused: %s peer=%s", kind, host_origin_reason, peer)
        await ws.close(code=4403, reason=_ws_close_reason(host_origin_reason))
        return None

    client_reason = _ws_client_reason(ws)
    if client_reason is not None:
        _log.warning("%s refused: %s", kind, client_reason)
        await ws.close(code=4408, reason=_ws_close_reason(client_reason))
        return None
    return peer, mode, cred


async def _close_unless_sidecar_allowed(ws: WebSocket) -> bool:
    """Pre-accept gates for the /api/ws gateway:
    4403 when the request isn't allowed, 4401 on bad auth."""
    peer = ws.client.host if ws.client else "?"
    auth_reason, cred = _ws_auth_reason(ws)
    if auth_reason is not None:
        _log.warning("ws rejected reason=%s cred=%s peer=%s", auth_reason, cred, peer)
        await ws.close(code=4401)
        return False
    host_origin_reason = _ws_host_origin_reason(ws)
    if host_origin_reason is not None:
        _log.warning("ws rejected reason=%s cred=%s peer=%s", host_origin_reason, cred, peer)
        await ws.close(code=4403)
        return False
    client_reason = _ws_client_reason(ws)
    if client_reason is not None:
        _log.warning("ws rejected reason=%s cred=%s peer=%s", client_reason, cred, peer)
        await ws.close(code=4403)
        return False
    return True


@router.websocket("/api/ws")
async def gateway_ws(ws: WebSocket) -> None:
    if not await _close_unless_sidecar_allowed(ws):
        return
    from scout_backend.mcp_startup import start_deferred_mcp_discovery_now
    from tui_gateway.ws import handle_ws

    # First chat client of a standalone dashboard: fire the discovery armed at boot (no-op
    # otherwise). Off-loop: the first act is a config read + the ~350 ms `mcp` SDK import.
    await asyncio.to_thread(start_deferred_mcp_discovery_now)

    # The authenticated identity (ticket / internal credential) stamped by
    # _ws_auth_reason becomes the identity authority for privileged RPCs
    # (browser.controller.register). None on the legacy token path.
    await handle_ws(
        ws,
        auth_identity=getattr(ws, "_scout_auth_identity", None),
        subprotocol=getattr(ws, "_scout_ws_subprotocol", None),
    )
