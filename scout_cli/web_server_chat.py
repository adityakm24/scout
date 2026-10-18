"""Dashboard WebSocket plumbing: WS client/origin/auth gates and the Scout Console worker pool."""

import logging
import atexit
import concurrent.futures
import hmac
import threading
import urllib.request
from fastapi import WebSocket
from typing import Optional

# Same logger the code used before extraction (record parity).
_log = logging.getLogger("scout_cli.web_server")


# Starlette's TestClient reports the peer as "testclient"; treat it as
# loopback so tests don't need to rewrite request scope.
_LOOPBACK_HOSTS = frozenset({"127.0.0.1", "::1", "localhost", "testclient"})


def _ws_client_reason(ws: "WebSocket") -> Optional[str]:
    """Return a rejection reason token for the peer IP, or None when allowed.

    Loopback bind: only loopback peers (the legacy ``?token=`` is the only auth,
    LAN hosts must not get to guess it); an empty peer fails closed.  Explicit
    non-loopback bind (``--insecure``) or gated mode: any peer — DNS-rebinding is
    blocked by :func:`_ws_host_origin_reason`, and in gated mode
    ``ws.client.host`` is the X-Forwarded-For value anyway.
    """
    from scout_cli.web_server import app
    if getattr(app.state, "auth_required", False):
        return None
    bound_host = (getattr(app.state, "bound_host", "") or "").strip().lower()
    if bound_host and bound_host not in _LOOPBACK_HOSTS:
        return None
    client_host = ws.client.host if ws.client else ""
    if not client_host:
        return f"missing_or_empty_peer bound={bound_host or '?'}"
    if client_host in _LOOPBACK_HOSTS:
        return None
    return f"peer_not_loopback peer={client_host} bound={bound_host or '?'}"


def _ws_client_is_allowed(ws: "WebSocket") -> bool:
    """True when the peer IP passes :func:`_ws_client_reason`."""
    return _ws_client_reason(ws) is None


def _ws_host_origin_reason(ws: "WebSocket") -> Optional[str]:
    """Return ``host_mismatch …`` / ``origin_mismatch …``, or None when allowed.

    HTTP middleware does not run for WebSocket routes, so the DNS-rebinding
    Host check is repeated here; an Origin header, when present, must target the
    bound host.  Non-web origins (packaged Electron: file://, null, app://) are
    trusted — the credential check is the real auth boundary there.
    """
    from scout_cli.web_server import _is_accepted_host, app
    bound_host = getattr(app.state, "bound_host", None)
    if not bound_host:
        return None
    trusted_public_hosts = getattr(app.state, "trusted_public_hosts", frozenset())
    host_header = ws.headers.get("host", "")
    if not _is_accepted_host(host_header, bound_host, trusted_public_hosts):
        return f"host_mismatch host={host_header or '?'} bound={bound_host}"
    origin = ws.headers.get("origin", "")
    if not origin:
        return None
    parsed = urllib.parse.urlparse(origin)
    if parsed.scheme not in {"http", "https"}:
        return None
    if not parsed.netloc or not _is_accepted_host(parsed.netloc, bound_host, trusted_public_hosts):
        return f"origin_mismatch origin={origin} bound={bound_host}"
    return None


def _ws_host_origin_is_allowed(ws: "WebSocket") -> bool:
    """True when the upgrade passes the dashboard Host/Origin guard."""
    return _ws_host_origin_reason(ws) is None


def _ws_request_is_allowed(ws: "WebSocket") -> bool:
    """Return True when the WebSocket upgrade matches dashboard boundaries."""
    return _ws_host_origin_is_allowed(ws) and _ws_client_is_allowed(ws)


_GATEWAY_WS_PROTOCOL = "scout-gateway-v1"
_GATEWAY_WS_TICKET_PROTOCOL_PREFIX = "scout-gateway-ticket."


def _gateway_ws_ticket_from_subprotocol(ws: "WebSocket") -> tuple[str, str]:
    """Return ``(ticket, reason)`` from an unambiguous gateway protocol set."""
    raw = str(ws.headers.get("sec-websocket-protocol", "") or "")
    protocols = [value.strip() for value in raw.split(",") if value.strip()]
    ticket_protocols = [
        value for value in protocols if value.startswith(_GATEWAY_WS_TICKET_PROTOCOL_PREFIX)]
    if not ticket_protocols:
        return "", "none"
    if _GATEWAY_WS_PROTOCOL not in protocols or len(ticket_protocols) != 1:
        return "", "invalid"
    ticket = ticket_protocols[0][len(_GATEWAY_WS_TICKET_PROTOCOL_PREFIX):]
    return (ticket, "ok") if ticket else ("", "invalid")


def _ws_auth_reason(ws: "WebSocket") -> tuple[Optional[str], str]:
    """Validate WS-upgrade auth; return ``(reason, credential)``.

    ``reason`` is None when accepted, else a short token (``no_credential``,
    ``token_mismatch``, ``ticket_invalid``, ``internal_invalid``);
    ``credential`` names what was presented so the accept path can log *how*.

    Loopback / ``--insecure``: legacy ``?token=`` (constant-time compared).
    Gated: ``?ticket=`` (browser-minted, single-use, 30s TTL) or ``?internal=``
    (process-lifetime, multi-use, only for server-spawned WS clients so the PTY
    child can reconnect; never injected into the SPA).  The legacy token is
    rejected in gated mode: a leaked ``_SESSION_TOKEN`` must not grant access.
    """
    from scout_cli.web_server import _SESSION_TOKEN, app
    auth_required = bool(getattr(app.state, "auth_required", False))
    if auth_required:
        # Lazy import — keeps this function importable in test harnesses
        # that don't bring in the dashboard_auth layer.
        from scout_cli.dashboard_auth.audit import AuditEvent, audit_log
        from scout_cli.dashboard_auth.ws_tickets import (
            TicketInvalid, consume_internal_credential, consume_ticket)

        def _reject(reason: str) -> None:
            audit_log(
                AuditEvent.WS_TICKET_REJECTED, reason=reason,
                ip=(ws.client.host if ws.client else ""), path=ws.url.path)

        def _stamp_identity(info) -> None:
            # Server-minted {user_id, provider} stamped onto the WS object is the
            # sole identity authority downstream (gateway transport / controller
            # registration); a client can never supply it through RPC params.
            # Only the two identity fields are carried — bookkeeping such as
            # ``minted_at`` is not part of the identity contract.
            ws._scout_auth_identity = {
                "user_id": info.get("user_id"), "provider": info.get("provider")}

        internal = ws.query_params.get("internal", "")
        if internal:
            try:
                _stamp_identity(consume_internal_credential(internal))
                return None, "internal"
            except TicketInvalid as exc:
                _reject(f"internal: {exc}")
                return "internal_invalid", "internal"

        protocol_ticket, protocol_reason = _gateway_ws_ticket_from_subprotocol(ws)
        if protocol_reason == "invalid":
            return "ticket_invalid", "ticket-subprotocol"
        ticket = protocol_ticket or ws.query_params.get("ticket", "")
        if not ticket:
            return "no_credential", "none"

        try:
            info = consume_ticket(ticket)
            if info.get("provider") == "bot-desktop":
                # A display ticket admits one RFB bridge on /api/display/ws (a watch-only
                # capability handed to a screen viewer); it must not double as a login here.
                raise TicketInvalid("display ticket presented as a gateway login")
            _stamp_identity(info)
            if protocol_ticket:
                # Select only the stable public protocol during accept. The
                # ticket-bearing protocol is a credential and must never be
                # reflected back to the browser or retained after admission.
                ws._scout_ws_subprotocol = _GATEWAY_WS_PROTOCOL
                return None, "ticket-subprotocol"
            return None, "ticket"
        except TicketInvalid as exc:
            _reject(str(exc))
            return "ticket_invalid", "ticket"

    token = ws.query_params.get("token", "")
    if not token:
        return "no_credential", "none"
    if hmac.compare_digest(token.encode(), _SESSION_TOKEN.encode()):
        return None, "token"
    return "token_mismatch", "token"


def _ws_auth_ok(ws: "WebSocket") -> bool:
    """True when the WS-upgrade credential is accepted. See _ws_auth_reason."""
    return _ws_auth_reason(ws)[0] is None


# On timeout asyncio cancels the awaitable but the console thread keeps running;
# a small dedicated pool caps the leak instead of exhausting the default pool.
_CONSOLE_EXECUTOR_MAX_WORKERS = 4
_console_executor: Optional[concurrent.futures.ThreadPoolExecutor] = None
_console_executor_lock = threading.Lock()


def _get_console_executor() -> concurrent.futures.ThreadPoolExecutor:
    """Lazily create the bounded console worker pool (once per process)."""
    global _console_executor
    if _console_executor is None:
        with _console_executor_lock:
            if _console_executor is None:
                _console_executor = concurrent.futures.ThreadPoolExecutor(
                    max_workers=_CONSOLE_EXECUTOR_MAX_WORKERS, thread_name_prefix="scout-console")
                # Tear down on interpreter exit without waiting on in-flight
                # workers: a stuck 60s console command must not block shutdown.
                atexit.register(
                    lambda: _console_executor
                    and _console_executor.shutdown(wait=False, cancel_futures=True))
    return _console_executor
