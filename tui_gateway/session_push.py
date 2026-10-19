"""A paired phone hears about this server's chats while its Scout app is closed: the turn's steps
on the lock screen, approvals and questions, and replies (scout_backend/push/notifier.py decides which
phone gets what). Bodies are rebound onto server.py's globals (method_ctx.bind_module) and
reference them bare.

Each hook only reads the session and enqueues; a push that cannot be prepared is logged and
dropped, never raised into the turn that caused it.
"""

from __future__ import annotations

from .method_ctx import bind_module


def _push_target(sid: str):
    """``(stored session id, chat title, profile home)`` when a phone could want this chat."""
    from scout_backend.push import notifier

    session = _sessions.get(sid)
    if session is None:
        return None
    home = session.get("profile_home") or None
    if not notifier.has_devices(home):
        return None
    key = _session_lookup_key(session, fallback=sid)
    return key, _session_live_title(session, key) if key else "", home


def _push_turn_finished(sid: str, payload: dict | None) -> None:
    try:
        from scout_backend.push import notifier

        if (target := _push_target(sid)) is None:
            return
        payload = payload or {}
        text = payload.get("text") if isinstance(payload.get("text"), str) else ""
        notifier.finished(target[0], text, target[1], outcome=str(payload.get("status") or "complete"),
                          home=target[2])
    except Exception:
        logger.debug("push: turn end for %s not sent", sid, exc_info=True)


def _push_tool_activity(sid: str, line: str) -> None:
    try:
        from scout_backend.push import notifier

        if line and (target := _push_target(sid)) is not None:
            notifier.activity(target[0], line, target[1], home=target[2])
    except Exception:
        logger.debug("push: activity for %s not sent", sid, exc_info=True)


def _push_server_request(method: str, sid: str, params: dict) -> None:
    """An approval card or a question is waiting in the chat."""
    if method not in ("approval", "clarify"):
        return
    try:
        from scout_backend.push import notifier

        if (target := _push_target(sid)) is None:
            return
        if method == "approval":
            title, body = notifier.approval_title(params)
        else:
            title, body = "Scout has a question", notifier.question_text(params)
        notifier.needs_you(target[0], title, body, target[1], home=target[2])
    except Exception:
        logger.debug("push: %s for %s not sent", method, sid, exc_info=True)


def register(server) -> None:
    """Publish this module's helpers onto ``server``, rebound to its globals."""
    bind_module(globals(), server, skip=("_",))
