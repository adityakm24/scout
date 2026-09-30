"""Planner RPC surface (``planner.todos`` / ``planner.reminders``) — the desktop Dashboard.

The same store the agent's ``planner`` tool edits (``planner/``), so a Dashboard edit is what
the agent reads on its next ``todo_list`` and vice versa. Profile-scoped: the desktop adds
``profile``, and the store paths resolve from the bound home at call time. Bodies are rebound
onto server.py's globals at install (method_ctx.bind_module).
"""

from __future__ import annotations

from .method_ctx import HandlerRegistry, bind_module

_registry = HandlerRegistry()
method = _registry.method

_E_PLANNER = 5130


def _planner_fields(params: dict, *keys: str) -> dict:
    """Only the keys the client actually sent (``null`` = not sent), so an update never blanks a
    field it did not mention; ``due: ""`` still reaches the store and clears the date."""
    return {k: params[k] for k in keys if params.get(k) is not None}


def _planner_todo_action(params: dict) -> dict:
    from planner import todos

    action = str(params.get("action") or "list")
    item_id = str(params.get("id") or "")
    if action == "list":
        return todos.list_todos(include_done=params.get("include_done") is not False)
    if action == "add":
        return todos.add_todo(params.get("title"), actor="user",
                              **_planner_fields(params, "notes", "due", "priority"))
    if action == "update":
        return todos.update_todo(item_id, actor="user",
                                 **_planner_fields(params, "title", "notes", "due", "priority", "status"))
    if action == "delete":
        return todos.delete_todo(item_id)
    if action == "clear_completed":
        return todos.clear_completed()
    if action == "reorder":
        return todos.reorder_todos(list(params.get("ids") or []))
    raise todos.PlannerError(f"unknown to-do action: {action}")


def _planner_reminder_action(params: dict) -> dict:
    from planner import reminders
    from planner.todos import PlannerError

    action = str(params.get("action") or "list")
    item_id = str(params.get("id") or "")
    if action == "list":
        return reminders.list_reminders(include_fired=params.get("include_fired") is not False)
    if action == "add":
        # No origin: a reminder set from the Dashboard stays local and the desktop notifies.
        changed = reminders.add_reminder(params.get("text"), params.get("when"), actor="user")
    elif action == "update":
        changed = reminders.update_reminder(item_id, actor="user", **_planner_fields(params, "text", "when"))
    elif action == "delete":
        changed = reminders.delete_reminder(item_id)
    elif action == "clear_fired":
        changed = reminders.clear_fired()
    else:
        raise PlannerError(f"unknown reminder action: {action}")
    return {**changed, **reminders.list_reminders()}


def _planner_call(rid, fn, params: dict) -> dict:
    from planner.todos import PlannerError

    try:
        return _ok(rid, {"success": True, **fn(params)})
    except PlannerError as exc:
        return _ok(rid, {"success": False, "error": str(exc)})
    except Exception as exc:  # noqa: BLE001 - surfaced to the client as an RPC error
        return _err(rid, _E_PLANNER, f"planner failed: {exc}")


@method("planner.todos")
@_registry.profile_scoped
def _planner_todos(rid, params: dict) -> dict:
    return _planner_call(rid, _planner_todo_action, params)


@method("planner.reminders")
@_registry.profile_scoped
def _planner_reminders(rid, params: dict) -> dict:
    return _planner_call(rid, _planner_reminder_action, params)


def register(server) -> None:
    """Publish this module's helpers + handlers onto ``server``, rebound to its globals."""
    bind_module(globals(), server)
