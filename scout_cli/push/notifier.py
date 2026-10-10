"""What Scout tells a phone whose app is closed.

The phone's own page shows everything while the app is open (Live Activity, ongoing notification,
alerts: mobile/src/activity.ts); once iOS or Android suspends it, the backend takes over:

- the Live Activity keeps changing on the lock screen (Apple's push service, apns.py), and is
  started there by push when a chat the phone follows gets busy while the app is closed;
- "Scout needs you" (an approval or a question), replies in chats the phone follows, and the
  results of tasks Scout ran on its own arrive as notifications (Expo's push service, expo.py).

Callers run on the agent's hot path, so they only enqueue: one worker thread sends. The caller
names the profile home (it is inside the turn's profile scope, or passes the session's own home);
the worker reads that home's files by path and never relies on a scope of its own.
"""

from __future__ import annotations

import atexit
import logging
import queue
import re
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from scout_cli.push import apns, devices, expo

logger = logging.getLogger(__name__)

_MAX_BODY = 180


@dataclass
class _Send:
    home: Path
    run: Callable[["_Send"], None]
    args: Dict[str, Any] = field(default_factory=dict)
    settings: Dict[str, Any] = field(default_factory=dict)


_queue: "queue.Queue[_Send]" = queue.Queue(maxsize=500)
_worker: Optional[threading.Thread] = None
_worker_lock = threading.Lock()

# (home, device id, session id) → the line the lock screen shows, so an unchanged step is not resent.
_shown: Dict[tuple, str] = {}
# (home, device id, session id) of Live Activities started by push and not yet told they ended.
_started: set = set()


def plain_text(markdown: str, limit: int = _MAX_BODY) -> str:
    """Markdown as one plain line, as a notification shows it (mirrors the desktop's
    apps/desktop/src/lib/notification-text.ts)."""
    text = re.sub(r"```[\s\S]*?```", " ", markdown or "")
    text = re.sub(r"!\[[^\]]*\]\([^)]*\)", "", text)
    text = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", text)
    text = re.sub(r"^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)", "", text, flags=re.M)
    text = re.sub(r"(\*\*|__|\*|_|~~|`)(?=\S)([\s\S]*?\S)\1", r"\2", text)
    text = re.sub(r"[*_`~]{2,}", "", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text if len(text) <= limit else text[:limit - 1].rstrip() + "…"


def _settings(home: Path) -> Dict[str, Any]:
    """The ``push`` section of that home's config.yaml (unset keys keep their defaults)."""
    from scout_cli.config_effective import load_user_config_effective

    path = home / "config.yaml"
    try:
        section = load_user_config_effective(path).get("push") if path.is_file() else None
    except Exception:
        section = None
    return section if isinstance(section, dict) else {}


def _home(home: Optional[Path]) -> Path:
    if home is None:
        from scout_constants import get_scout_home

        return get_scout_home()
    return Path(home)


def has_devices(home: Optional[Path] = None) -> bool:
    """A phone has registered with this profile (cheap: callers on the hot path ask first)."""
    return devices.path(_home(home)).is_file()


def _enqueue(run: Callable[[_Send], None], home: Optional[Path] = None, **args: Any) -> None:
    home = _home(home)
    if not has_devices(home):
        return
    _ensure_worker()
    try:
        _queue.put_nowait(_Send(home, run, args))
    except queue.Full:
        logger.warning("push: queue full, dropping %s", run.__name__)


def _ensure_worker() -> None:
    global _worker
    with _worker_lock:
        if _worker is None or not _worker.is_alive():
            _worker = threading.Thread(target=_work, name="scout-push", daemon=True)
            _worker.start()


def _work() -> None:
    while True:
        job = _queue.get()
        try:
            job.settings = _settings(job.home)
            if job.settings.get("enabled", True) is not False:
                job.run(job)
        except Exception:
            logger.warning("push: %s failed", job.run.__name__, exc_info=True)
        finally:
            _queue.task_done()


@atexit.register
def _drain(timeout: float = 5.0) -> None:
    """A cron worker process exits right after its run: give its last pushes a moment to leave."""
    deadline = time.monotonic() + timeout
    while _queue.unfinished_tasks and time.monotonic() < deadline:
        time.sleep(0.05)


# ── sending ───────────────────────────────────────────────────────────────────────────────────


def _away(home: Path) -> List[Dict[str, Any]]:
    return [device for device in devices.all_devices(home) if devices.is_away(device)]


def _notify(job: _Send, targets: List[Dict[str, Any]], title: str, body: str, data: Dict[str, Any]) -> None:
    messages = [expo.message(device["expo_token"], title, body, data=data) for device in targets
                if device.get("expo_token")]
    if not messages:
        return
    results = expo.send(messages)
    for msg, ticket in results:
        ok = ticket.get("status") == "ok"
        if not ok:
            # InvalidCredentials: the app's push keys are not uploaded to Expo (`eas credentials`).
            logger.warning("push: Expo did not take a notification: %s %s",
                           (ticket.get("details") or {}).get("error") or "", ticket.get("message") or "")
        devices.record_delivery(job.home, msg["to"], ok)
    for token in expo.gone_tokens(results):
        devices.drop_token(job.home, token)


def _apns(job: _Send, token: str, payload: Dict[str, Any], priority: int) -> bool:
    creds = apns.credentials(job.home, job.settings.get("apns") or {})
    if creds is None:
        return False
    status, reason = apns.send(creds, token, payload, priority=priority)
    if status == 200:
        return True
    logger.info("push: Apple refused a Live Activity push (%s %s)", status, reason)
    if reason in apns.GONE_REASONS:
        devices.drop_token(job.home, token)
    return False


def _send_activity(job: _Send) -> None:
    session_id, line, chat = job.args["session_id"], job.args["line"], job.args["chat_title"]
    for device in _away(job.home):
        if device.get("platform") != "ios":
            continue
        key = (str(job.home), device["id"], session_id)
        if _shown.get(key) == line:
            continue
        token = ((device.get("activities") or {}).get(session_id) or {}).get("token")
        if token:
            # Waiting on the user is worth Apple's limited high-priority budget; a step is not.
            sent = _apns(job, token, apns.update_payload(line, chat), 10 if job.args["waiting"] else 5)
        elif (device.get("push_to_start_token") and key not in _started
              and (job.args.get("task") or devices.watches(device, session_id))):
            sent = _apns(job, device["push_to_start_token"], apns.start_payload(session_id, line, chat), 10)
            if sent:
                _started.add(key)
        else:
            continue
        if sent:
            _shown[key] = line


def _end_activities(job: _Send, away: List[Dict[str, Any]], session_id: str, chat: str, ok: bool) -> None:
    """The lock screen says how it went, then the Live Activity goes away."""
    for device in away:
        key = (str(job.home), device["id"], session_id)
        _started.discard(key)
        line = _shown.pop(key, None)
        token = ((device.get("activities") or {}).get(session_id) or {}).get("token")
        if token and line is not None:
            _apns(job, token, apns.end_payload("Done" if ok else "Stopped", chat), 10)


def _send_finished(job: _Send) -> None:
    session_id, chat, text = job.args["session_id"], job.args["chat_title"], job.args["text"]
    outcome = job.args["outcome"]
    away = _away(job.home)
    _end_activities(job, away, session_id, chat, outcome == "complete")
    if outcome == "interrupted":
        return
    watching = [device for device in away if devices.watches(device, session_id)]
    if outcome == "error":
        _notify(job, watching, chat or "Scout", "Scout ran into a problem and stopped.", {"sessionId": session_id})
        return
    body = plain_text(text) if job.settings.get("previews", True) else ""
    _notify(job, watching, chat or "Scout replied", body or "Scout replied", {"sessionId": session_id})


def _send_needs_you(job: _Send) -> None:
    body = job.args["body"] if job.settings.get("previews", True) else job.args["chat_title"]
    _notify(job, _away(job.home), job.args["title"], body or "Open Scout to answer",
            {"sessionId": job.args["session_id"]})


def _send_task_result(job: _Send) -> None:
    away = _away(job.home)
    _end_activities(job, away, _task_key(job.args["job_id"]), job.args["name"], job.args["ok"])
    text = plain_text(job.args["text"]) if job.settings.get("previews", True) else ""
    title = job.args["name"] if job.args["ok"] else f"{job.args['name']} didn't finish"
    _notify(job, away, title, text or "Open Scout to see the result", {"jobId": job.args["job_id"]})


def _task_key(job_id: str) -> str:
    # A task has no chat; its Live Activity is keyed apart from every chat's.
    return f"task:{job_id}"


# ── what callers say ──────────────────────────────────────────────────────────────────────────


def activity(session_id: str, line: str, chat_title: str = "", *, waiting: bool = False,
             home: Optional[Path] = None) -> None:
    """A chat's turn moved on ("Checking where you are"): the lock screen follows."""
    if session_id and line:
        _enqueue(_send_activity, home, session_id=session_id, line=line, chat_title=chat_title or "Scout",
                 waiting=waiting)


def finished(session_id: str, text: str, chat_title: str = "", *, outcome: str = "complete",
             home: Optional[Path] = None) -> None:
    """A chat's turn ended (``outcome``: complete, error or interrupted)."""
    if session_id:
        _enqueue(_send_finished, home, session_id=session_id, text=text or "", chat_title=chat_title,
                 outcome=outcome)


def needs_you(session_id: str, title: str, body: str, chat_title: str = "", *, home: Optional[Path] = None) -> None:
    """Scout is waiting on the user: an approval or a question."""
    activity(session_id, title, chat_title, waiting=True, home=home)
    _enqueue(_send_needs_you, home, session_id=session_id, title=title, body=body, chat_title=chat_title)


def task_result(job_id: str, name: str, text: str, *, ok: bool) -> None:
    """A task Scout ran on its own (a scheduled order, a one-off job) finished."""
    _enqueue(_send_task_result, None, job_id=job_id, name=name or "Scout", text=text or "", ok=ok)


def task_steps_callback(job: Dict[str, Any]) -> Optional[Callable[..., None]]:
    """``tool_start_callback`` for the agent running a one-off task ("place the Zepto order at
    18:42"): its steps show on an away iPhone's lock screen, started there by push. A recurring
    job (a morning brief) gets only its result notification."""
    schedule = job.get("schedule")
    if not isinstance(schedule, dict) or schedule.get("kind") != "once":
        return None
    home, key, name = _home(None), _task_key(str(job.get("id") or "")), str(job.get("name") or "Scout")

    def on_tool_start(_tool_call_id: str, tool_name: str, args: Any) -> None:
        from tools.tool_activity import activity_for_tool

        if line := activity_for_tool(tool_name, args):
            _enqueue(_send_activity, home, session_id=key, line=line, chat_title=name, waiting=False, task=True)

    return on_tool_start


def approval_title(params: Dict[str, Any]) -> tuple:
    """``(title, body)`` for an approval request: an order names its shop and total."""
    order = params.get("order") if isinstance(params.get("order"), dict) else None
    if order:
        merchant = str(order.get("merchant") or "").strip()
        total = order.get("total")
        items = [f"{item.get('quantity', 1)} × {item.get('name')}" for item in order.get("items") or []
                 if isinstance(item, dict) and item.get("name")]
        body = ", ".join(items[:3]) + (f" and {len(items) - 3} more" if len(items) > 3 else "")
        if isinstance(total, (int, float)):
            body = f"₹{total:g}" + (f" · {body}" if body else "")
        return (f"Approve your {merchant} order" if merchant else "Approve your order"), body
    return "Scout is waiting for your OK", plain_text(str(params.get("description") or params.get("command") or ""))


def question_text(params: Dict[str, Any]) -> str:
    if params.get("question"):
        return plain_text(str(params["question"]))
    questions = params.get("questions") or []
    first = questions[0] if questions and isinstance(questions[0], dict) else {}
    return plain_text(str(first.get("question") or ""))
