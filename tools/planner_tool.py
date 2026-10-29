"""planner tool — the user's own to-do list and reminders, shared live with the user.

Both the user (desktop Dashboard, ``scout todo`` / ``scout remind``) and the agent edit the same
per-profile store (``planner/``), and every call reads it fresh, so the agent sees edits the user
made moments ago. Nothing is injected into the system prompt: the list is read through this tool,
which keeps the conversation's cached prefix intact.
"""

import json
from typing import Any, Callable, Dict

from tools.registry import registry

_ACTIONS = (
    "todo_list", "todo_add", "todo_update", "todo_complete", "todo_reopen", "todo_delete",
    "reminder_list", "reminder_add", "reminder_update", "reminder_delete",
)

PLANNER_SCHEMA = {
    "name": "planner",
    "description": (
        "The USER's personal to-do list and reminders — persistent across every session and shared "
        "live with the user's Dashboard, where they add, tick off, edit and delete items too. "
        "Use it when the user asks you to remember to do something, add/check/update their to-dos, "
        "or remind them of something at a time. It is not their calendar (meetings and events "
        "live in their calendar connection), not your own working checklist for the "
        "current task, nor the place for instructions about how a scheduled job reports (\"ignore "
        "transaction emails in my updates\") — those are that job's rules: `scout cron rules`.\n\n"
        "The user edits this list themselves, so call todo_list / reminder_list first whenever "
        "you need its current state — never rely on an earlier result in the conversation.\n\n"
        "To-dos: todo_add(title, notes?, due?, priority?), todo_update(id, …changed fields), "
        "todo_complete(id), todo_reopen(id), todo_delete(id). due is a date 'YYYY-MM-DD' or ISO "
        "datetime; priority is none|low|medium|high.\n"
        "Reminders: reminder_add(text, when, minutes_before?) sends the user `text` at that time on the "
        "originating messaging chat, or to the profile's persistent Bot Chat for desktop/TUI sessions. "
        "The app notification opens that chat. when: 'in 30m' / 'in 2h' (one-shot, "
        "relative — prefer this for 'in N minutes'), an ISO timestamp '2026-06-01T09:00:00' "
        "(one-shot, local time), 'every day at 9am' / 'every monday 9am' / 'weekdays at 9am' "
        "(recurring). reminder_update(id, text?, when?), reminder_delete(id). The reminder text "
        "is delivered verbatim, so write it to the user ('Call mom').\n\n"
        "CRITICAL FOR COMMUTES / ARRIVALS: When the user asks for a reminder 'X minutes before arrival / reaching [destination]', "
        "use minutes_before=X or when='X minutes before arrival'. This requires active commute tracking and queues a location-triggered "
        "reminder based on refreshed route ETA. Never convert it to a fixed clock time or 'in Xm'.\n\n"
        "Every call returns the full current list for its kind. A `warning` in a reminder result "
        "means nothing is running to deliver it yet; pass that on to the user."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "action": {"type": "string", "enum": list(_ACTIONS)},
            "id": {"type": "string", "description": "Item id (from a list result) for update/complete/reopen/delete."},
            "title": {"type": "string", "description": "To-do title (todo_add, todo_update)."},
            "notes": {"type": "string", "description": "Optional to-do details."},
            "due": {"type": "string", "description": "To-do due date 'YYYY-MM-DD' or ISO datetime; '' clears it."},
            "priority": {"type": "string", "enum": ["none", "low", "medium", "high"]},
            "include_done": {"type": "boolean", "description": "todo_list: include completed items (default true)."},
            "text": {"type": "string", "description": "Reminder text delivered to the user (reminder_add, reminder_update)."},
            "when": {"type": "string", "description": "Reminder time — see the schedule forms above, or '5m before arrival' (location-triggered; requires active commute tracking)."},
            "minutes_before": {"type": "integer", "description": "Optional: trigger when live route ETA reaches this many minutes before arrival (requires active commute tracking)."},
        },
        "required": ["action"],
    },
}


def _require(args: Dict[str, Any], key: str) -> str:
    from planner.todos import PlannerError

    value = str(args.get(key) or "").strip()
    if not value:
        raise PlannerError(f"{key} is required for {args.get('action')}")
    return value


def _present(args: Dict[str, Any], *keys: str) -> Dict[str, Any]:
    return {k: args[k] for k in keys if k in args and args[k] is not None}


def _todo_list(args):
    from planner import todos
    return todos.list_todos(include_done=args.get("include_done") is not False)


def _todo_add(args):
    from planner import todos
    return todos.add_todo(_require(args, "title"), actor="agent", **_present(args, "notes", "due", "priority"))


def _todo_update(args):
    from planner import todos
    fields = _present(args, "title", "notes", "due", "priority")
    return todos.update_todo(_require(args, "id"), actor="agent", **fields)


def _todo_status(status: str) -> Callable:
    def run(args):
        from planner import todos
        return todos.update_todo(_require(args, "id"), status=status, actor="agent")
    return run


def _todo_delete(args):
    from planner import todos
    return {**todos.delete_todo(_require(args, "id")), "deleted": args["id"]}


def _reminder_list(args):
    from planner import reminders
    return reminders.list_reminders()


def _reminder_add(args):
    import re
    from planner import reminders
    from tools.cronjob_job_args import _origin_from_env

    when = str(args.get("when") or "").strip()
    text = _require(args, "text")

    # Check for relative commute arrival timing:
    # 1) Explicit minutes_before parameter
    # 2) when containing "before", "left", "prior", "reaching"
    # 3) text containing "X minutes left to..." or "X mins before..." combined with when="in Xm"
    lead_min = None
    if args.get("minutes_before") is not None:
        try:
            lead_min = int(args["minutes_before"])
        except (ValueError, TypeError):
            pass

    when_lower = when.lower()
    text_lower = text.lower()

    if lead_min is None:
        m = re.search(r"(\d+)\s*(?:m|min|mins|minutes)?\s*(?:before|left|prior|ahead of)", when_lower)
        if not m and when_lower.startswith("in "):
            m = re.search(r"(\d+)\s*(?:m|min|mins|minutes)?\s*(?:before|left to|prior to)", text_lower)
        if m:
            lead_min = int(m.group(1))

    if lead_min is not None:
        from planner.todos import PlannerError
        from tools.commute_eta_sync_tool import _read_active_sync, set_commute_arrival_reminder
        active = _read_active_sync()
        if active and active.get("status") == "tracking":
            queued = json.loads(set_commute_arrival_reminder(lead_min, text))
            if not queued.get("success"):
                raise PlannerError(queued.get("error", "Could not queue the arrival reminder."))
            return {
                **queued,
                **reminders.list_reminders(),
                **reminders.scheduler_notice(),
            }
        raise PlannerError(
            "An arrival-relative reminder needs active commute tracking. Start tracking the destination "
            "first so the reminder can follow live location instead of guessing a clock time."
        )

    if not when:
        from planner.todos import PlannerError
        raise PlannerError("when is required for reminder_add")

    added = reminders.add_reminder(text, when, actor="agent", origin=_origin_from_env(when))
    return {**added, **reminders.list_reminders(), **reminders.scheduler_notice()}


def _reminder_update(args):
    from planner import reminders
    updated = reminders.update_reminder(_require(args, "id"), actor="agent", **_present(args, "text", "when"))
    return {**updated, **reminders.list_reminders(), **reminders.scheduler_notice()}


def _reminder_delete(args):
    from planner import reminders
    return {**reminders.delete_reminder(_require(args, "id")), **reminders.list_reminders()}


_HANDLERS: Dict[str, Callable[[Dict[str, Any]], Dict[str, Any]]] = {
    "todo_list": _todo_list,
    "todo_add": _todo_add,
    "todo_update": _todo_update,
    "todo_complete": _todo_status("done"),
    "todo_reopen": _todo_status("open"),
    "todo_delete": _todo_delete,
    "reminder_list": _reminder_list,
    "reminder_add": _reminder_add,
    "reminder_update": _reminder_update,
    "reminder_delete": _reminder_delete,
}


def planner_tool(args: Dict[str, Any]) -> str:
    from planner.todos import PlannerError

    action = str(args.get("action") or "").strip()
    handler = _HANDLERS.get(action)
    if handler is None:
        return json.dumps({"success": False, "error": f"unknown action {action!r}; use one of {', '.join(_ACTIONS)}"})
    try:
        return json.dumps({"success": True, **handler(args)}, ensure_ascii=False)
    except PlannerError as exc:
        return json.dumps({"success": False, "error": str(exc)}, ensure_ascii=False)


registry.register(
    name="planner",
    toolset="planner",
    schema=PLANNER_SCHEMA,
    handler=lambda args, **kw: planner_tool(args),
    emoji="🗓️",
)
