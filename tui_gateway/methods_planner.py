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


def _item_id(params: dict) -> str:
    return str(params.get("id") or "")


def _todo_handlers():
    from planner import todos

    return {
        "list": lambda p: todos.list_todos(include_done=p.get("include_done") is not False),
        "add": lambda p: todos.add_todo(p.get("title"), actor="user",
                                        **_planner_fields(p, "notes", "due", "priority")),
        "update": lambda p: todos.update_todo(_item_id(p), actor="user",
                                              **_planner_fields(p, "title", "notes", "due", "priority", "status")),
        "delete": lambda p: todos.delete_todo(_item_id(p)),
        "clear_completed": lambda p: todos.clear_completed(),
    }


def _reminder_handlers():
    from planner import reminders

    # Every write answers with the full list, so the Dashboard repaints from one response.
    def write(fn):
        return lambda p: {**fn(p), **reminders.list_reminders()}

    return {
        "list": lambda p: reminders.list_reminders(include_fired=p.get("include_fired") is not False),
        # No origin: a reminder set from the Dashboard stays local and the desktop notifies.
        "add": write(lambda p: reminders.add_reminder(p.get("text"), p.get("when"), actor="user")),
        "update": write(lambda p: reminders.update_reminder(_item_id(p), actor="user",
                                                            **_planner_fields(p, "text", "when"))),
        "delete": write(lambda p: reminders.delete_reminder(_item_id(p))),
        "clear_fired": write(lambda p: reminders.clear_fired()),
    }


def _dispatch(handlers, kind: str):
    def run(params: dict) -> dict:
        from planner.todos import PlannerError

        action = str(params.get("action") or "list")
        handler = handlers().get(action)
        if handler is None:
            raise PlannerError(f"unknown {kind} action: {action}")
        return handler(params)
    return run


_planner_todo_action = _dispatch(_todo_handlers, "to-do")
_planner_reminder_action = _dispatch(_reminder_handlers, "reminder")


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
