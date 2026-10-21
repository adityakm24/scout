"""``external_action``: every write the User Agent makes outside its sandbox, behind an approval.

The User Agent is read-only: its sandbox reaches Google's APIs with ``access: read-only``, so a
send from its terminal is refused by the OS. To send an email or change the calendar it names the
action here; code (never the model) writes the approval card from the exact arguments, the
person answers it outside the model loop, and only then does the backend perform the action.
A declined, timed-out or headless prompt is a refusal.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path
from typing import Any, Callable, Dict, List, Tuple

from tools.registry import registry

_SCRIPT = (Path(__file__).resolve().parents[1] / "skills" / "productivity" / "google-workspace"
           / "scripts" / "google_api.py")
_MAX_BODY_IN_CARD = 1200


def _req(args: Dict[str, Any], *names: str) -> List[str]:
    missing = [n for n in names if not str(args.get(n) or "").strip()]
    if missing:
        raise ValueError(f"missing {', '.join(missing)}")
    return [str(args[n]) for n in names]


def _clip(text: str) -> str:
    text = str(text or "")
    return text if len(text) <= _MAX_BODY_IN_CARD else text[:_MAX_BODY_IN_CARD] + f"\n… ({len(text)} characters in all)"


def _send_email(a):
    to, subject, body = _req(a, "to", "subject", "body")
    argv = ["gmail", "send", "--to", to, "--subject", subject, "--body", body]
    if a.get("cc"):
        argv += ["--cc", str(a["cc"])]
    card = f"To: {to}\n" + (f"Cc: {a['cc']}\n" if a.get("cc") else "") + f"Subject: {subject}\n\n{_clip(body)}"
    return argv, f"Send an email to {to}", card


def _reply_email(a):
    message_id, body = _req(a, "message_id", "body")
    return (["gmail", "reply", message_id, "--body", body], "Send a reply",
            f"Reply to message {message_id}\n\n{_clip(body)}")


def _draft_email(a):
    to, subject, body = _req(a, "to", "subject", "body")
    argv = ["gmail", "draft", "--to", to, "--subject", subject, "--body", body]
    if a.get("cc"):
        argv += ["--cc", str(a["cc"])]
    card = f"To: {to}\n" + (f"Cc: {a['cc']}\n" if a.get("cc") else "") + f"Subject: {subject}\n\n{_clip(body)}"
    return argv, f"Save a draft to {to}", card


def _create_event(a):
    summary, start, end = _req(a, "summary", "start", "end")
    argv = ["calendar", "create", "--summary", summary, "--start", start, "--end", end]
    lines = [f"{summary}", f"{start} to {end}"]
    for key in ("location", "attendees", "description"):
        if a.get(key):
            argv += [f"--{key}", str(a[key])]
            lines.append(f"{key.capitalize()}: {_clip(a[key])}")
    return argv, f"Add \"{summary}\" to your calendar", "\n".join(lines)


def _delete_event(a):
    (event_id,) = _req(a, "event_id")
    return ["calendar", "delete", event_id], "Delete a calendar event", f"Event ID: {event_id}"


# action -> builder(args) -> (google_api.py argv, card title, card body). The card is built from the
# same arguments that run, so what the person approves is exactly what happens.
_ACTIONS: Dict[str, Callable[[Dict[str, Any]], Tuple[List[str], str, str]]] = {
    "send_email": _send_email,
    "reply_email": _reply_email,
    "draft_email": _draft_email,
    "create_calendar_event": _create_event,
    "delete_calendar_event": _delete_event,
}

EXTERNAL_ACTION_SCHEMA = {
    "name": "external_action",
    "description": (
        "Make a change outside Scout on the person's behalf: send, reply to or draft an email, or add or delete "
        "a calendar event. You are read-only otherwise: nothing you run in the terminal can send or change these. "
        "The person sees exactly these arguments in an approval card and must approve before anything happens; "
        "a declined result means stop and do not retry."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "action": {"type": "string", "enum": sorted(_ACTIONS)},
            "to": {"type": "string", "description": "send_email/draft_email: recipient address(es), comma-separated"},
            "cc": {"type": "string"},
            "subject": {"type": "string"},
            "body": {"type": "string"},
            "message_id": {"type": "string", "description": "reply_email: the message to reply to"},
            "summary": {"type": "string", "description": "create_calendar_event: title"},
            "start": {"type": "string", "description": "ISO 8601 with timezone"},
            "end": {"type": "string", "description": "ISO 8601 with timezone"},
            "location": {"type": "string"},
            "attendees": {"type": "string", "description": "comma-separated emails"},
            "description": {"type": "string"},
            "event_id": {"type": "string", "description": "delete_calendar_event: the event"},
        },
        "required": ["action"],
    },
}


def _approved(title: str, card: str) -> bool:
    from tools.approval_prompt import request_elicitation_consent

    return request_elicitation_consent(title, card, surface="external-action", title="Approve this?") == "accept"


def external_action(args: Dict[str, Any]) -> str:
    builder = _ACTIONS.get(str(args.get("action") or ""))
    if builder is None:
        return json.dumps({"success": False, "error": f"action must be one of: {', '.join(sorted(_ACTIONS))}"})
    try:
        argv, title, card = builder(args)
    except ValueError as exc:
        return json.dumps({"success": False, "error": str(exc)})
    if not _approved(title, card):
        return json.dumps({"success": False, "error_type": "declined",
                           "error": "The person did not approve this. Do not retry; ask them what they want instead."})
    proc = subprocess.run([sys.executable, str(_SCRIPT), *argv], capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        return json.dumps({"success": False, "error": (proc.stderr or proc.stdout).strip()[-600:]})
    try:
        return json.dumps({"success": True, "result": json.loads(proc.stdout)})
    except ValueError:
        return json.dumps({"success": True, "result": proc.stdout.strip()[-600:]})


registry.register(
    name="external_action",
    toolset="external_action",
    schema=EXTERNAL_ACTION_SCHEMA,
    handler=lambda args, **kw: external_action(args),
    emoji="📤",
)
