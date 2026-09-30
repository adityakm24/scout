"""The user's planner (``planner.*``): the to-do list and reminders shown on the Dashboard.

Both methods are profile-scoped (the desktop adds ``profile``) and return the full current list
after every action, so a client never has to merge a partial result. A rejected request (unknown
id, empty title, unparseable time) comes back as ``success: false`` + ``error`` — a user-facing
message — not as an RPC error. Reminders live in the cron store, so a reminder edit ALSO moves
``cron.changed``; to-do edits move ``planner.changed``.
"""

from __future__ import annotations

from pydantic import Field

from .base import WireEnum
from .common import OpenModel, ProfileParams
from .registry import method


class PlannerTodoAction(WireEnum):
    list = "list"
    add = "add"
    update = "update"
    delete = "delete"
    clear_completed = "clear_completed"
    reorder = "reorder"


class PlannerTodosParams(ProfileParams):
    action: PlannerTodoAction = PlannerTodoAction.list
    id: str | None = None
    title: str | None = None
    notes: str | None = None
    # "" clears the due date; absent/null leaves it unchanged.
    due: str | None = None
    priority: str | None = None
    status: str | None = None
    include_done: bool | None = None
    ids: list[str] | None = None


class PlannerTodo(OpenModel):
    """``planner/todos.py`` item."""

    id: str
    title: str
    notes: str = ""
    status: str = "open"
    priority: str = "none"
    due: str | None = None
    created_by: str = "user"
    updated_by: str | None = None
    created_at: str | None = None
    updated_at: str | None = None
    completed_at: str | None = None


class PlannerTodosResult(OpenModel):
    success: bool
    error: str | None = None
    revision: int | None = None
    items: list[PlannerTodo] = Field(default_factory=list)
    item: PlannerTodo | None = None


class PlannerReminderAction(WireEnum):
    list = "list"
    add = "add"
    update = "update"
    delete = "delete"
    clear_fired = "clear_fired"


class PlannerRemindersParams(ProfileParams):
    action: PlannerReminderAction = PlannerReminderAction.list
    id: str | None = None
    text: str | None = None
    when: str | None = None
    include_fired: bool | None = None


class PlannerReminder(OpenModel):
    """``planner/reminders.py::_view`` — a reminder-kind cron job."""

    id: str
    text: str
    when: str = ""
    recurring: bool = False
    next_at: str | None = None
    last_fired_at: str | None = None
    status: str = "scheduled"
    created_at: str | None = None
    created_by: str = "user"
    deliver: str = "local"


class PlannerRemindersResult(OpenModel):
    success: bool
    error: str | None = None
    reminders: list[PlannerReminder] = Field(default_factory=list)
    reminder: PlannerReminder | None = None
    removed: str | list[str] | None = None


method("planner.todos", params=PlannerTodosParams, result=PlannerTodosResult,
       doc="List/add/update/delete/reorder the user's to-dos (shared with the agent's planner tool).")
method("planner.reminders", params=PlannerRemindersParams, result=PlannerRemindersResult,
       doc="List/add/update/delete the user's reminders (reminder-kind cron jobs).")
