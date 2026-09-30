"""The user's to-do list — one JSON document per profile home, shared by every surface.

Unlike the agent's per-session ``todo_list`` (its working checklist for the current task, held
in memory), this list is the USER's: it persists across sessions and is edited by the user
(Dashboard, CLI) and by the agent (``planner`` tool) alike. Every mutation re-reads the file
under an exclusive lock, so a write from one process never clobbers another's; every read goes
to disk, so the agent sees an edit the user made a second ago.

The path resolves from ``get_scout_home()`` at call time (never a module constant), so a
process serving several profiles reads the scoped profile's list.
"""

from __future__ import annotations

import os
import secrets
from contextlib import contextmanager, suppress
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, Optional

try:
    import fcntl
except ImportError:  # Windows
    fcntl = None  # type: ignore[assignment]
try:
    import msvcrt
except ImportError:  # POSIX
    msvcrt = None  # type: ignore[assignment]

SCHEMA_VERSION = 1
PRIORITIES = ("none", "low", "medium", "high")
STATUSES = ("open", "done")
ACTORS = ("user", "agent")
MAX_ITEMS = 1000
MAX_TITLE_CHARS = 500
MAX_NOTES_CHARS = 4000


class PlannerError(ValueError):
    """A rejected planner request (bad id, empty title, malformed date). Message is user-facing."""


def todos_path() -> Path:
    from scout_constants import get_scout_home

    return get_scout_home() / "planner" / "todos.json"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


@contextmanager
def _locked(path: Path):
    """Exclusive lock on a sibling ``.lock`` file (the JSON itself is atomically replaced)."""
    from scout_constants import mkdir_under_scout_home

    mkdir_under_scout_home(path.parent)
    if fcntl is None and msvcrt is None:
        yield
        return
    flags = os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0)
    raw_fd = os.open(path.with_suffix(path.suffix + ".lock"), flags, 0o600)
    with os.fdopen(raw_fd, "r+", encoding="utf-8") as fd:
        def _flock(unlock: bool) -> None:
            if fcntl:
                fcntl.flock(fd, fcntl.LOCK_UN if unlock else fcntl.LOCK_EX)
            else:
                fd.seek(0)
                msvcrt.locking(fd.fileno(), msvcrt.LK_UNLCK if unlock else msvcrt.LK_LOCK, 1)

        _flock(False)
        try:
            yield
        finally:
            with suppress(OSError):
                _flock(True)


def _read(path: Path) -> Dict[str, Any]:
    from utils import read_json_or_empty

    doc = read_json_or_empty(path)
    items = doc.get("items")
    return {
        "version": SCHEMA_VERSION,
        "revision": int(doc.get("revision") or 0),
        "items": [i for i in items if isinstance(i, dict) and i.get("id")] if isinstance(items, list) else [],
    }


def _write(path: Path, doc: Dict[str, Any]) -> None:
    from utils import atomic_json_write

    atomic_json_write(path, doc, mode=0o600)


def _snapshot(doc: Dict[str, Any]) -> Dict[str, Any]:
    return {"revision": doc["revision"], "items": [dict(i) for i in doc["items"]]}


def _text(value: Any, field: str, limit: int, *, required: bool = False) -> str:
    text = str(value or "").strip()
    if required and not text:
        raise PlannerError(f"{field} is required")
    if len(text) > limit:
        raise PlannerError(f"{field} is longer than {limit} characters")
    return text


def _due(value: Any) -> Optional[str]:
    """``None``/"" clears; a date (``2026-10-01``) or ISO datetime is kept in canonical form."""
    raw = str(value or "").strip()
    if not raw:
        return None
    try:
        return date.fromisoformat(raw).isoformat()
    except ValueError:
        pass
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError as exc:
        raise PlannerError(f"due must be a date (YYYY-MM-DD) or ISO datetime, got {raw!r}") from exc
    return parsed.isoformat(timespec="minutes")


def _choice(value: Any, field: str, allowed: Iterable[str], default: str) -> str:
    text = str(value or default).strip().lower()
    if text not in allowed:
        raise PlannerError(f"{field} must be one of {', '.join(allowed)}")
    return text


def _find(doc: Dict[str, Any], item_id: str) -> Dict[str, Any]:
    for item in doc["items"]:
        if item["id"] == item_id:
            return item
    raise PlannerError(f"no to-do with id {item_id!r}")


def _mutate(fn) -> Dict[str, Any]:
    """Read-modify-write under the lock; bumps ``revision`` only when something changed."""
    path = todos_path()
    with _locked(path):
        doc = _read(path)
        before = [dict(i) for i in doc["items"]]
        fn(doc)
        if doc["items"] != before:
            doc["revision"] += 1
            _write(path, doc)
        return _snapshot(doc)


def list_todos(*, include_done: bool = True) -> Dict[str, Any]:
    doc = _read(todos_path())
    if not include_done:
        doc["items"] = [i for i in doc["items"] if i.get("status") != "done"]
    return _snapshot(doc)


def add_todo(title: Any, *, notes: Any = "", due: Any = None, priority: Any = "none",
             actor: str = "user") -> Dict[str, Any]:
    item = {
        "id": f"t_{secrets.token_hex(4)}",
        "title": _text(title, "title", MAX_TITLE_CHARS, required=True),
        "notes": _text(notes, "notes", MAX_NOTES_CHARS),
        "status": "open",
        "priority": _choice(priority, "priority", PRIORITIES, "none"),
        "due": _due(due),
        "created_by": _choice(actor, "actor", ACTORS, "user"),
        "created_at": _now(),
        "updated_at": _now(),
        "updated_by": _choice(actor, "actor", ACTORS, "user"),
        "completed_at": None,
    }

    def apply(doc):
        if len(doc["items"]) >= MAX_ITEMS:
            raise PlannerError(f"the list is full ({MAX_ITEMS} items); clear completed items first")
        doc["items"].insert(0, item)

    snapshot = _mutate(apply)
    return {**snapshot, "item": item}


_UNSET = object()


def update_todo(item_id: str, *, title: Any = _UNSET, notes: Any = _UNSET, due: Any = _UNSET,
                priority: Any = _UNSET, status: Any = _UNSET, actor: str = "user") -> Dict[str, Any]:
    """Change only the fields passed. ``status="done"`` stamps ``completed_at``; reopening clears it."""
    changes: Dict[str, Any] = {}
    if title is not _UNSET:
        changes["title"] = _text(title, "title", MAX_TITLE_CHARS, required=True)
    if notes is not _UNSET:
        changes["notes"] = _text(notes, "notes", MAX_NOTES_CHARS)
    if due is not _UNSET:
        changes["due"] = _due(due)
    if priority is not _UNSET:
        changes["priority"] = _choice(priority, "priority", PRIORITIES, "none")
    if status is not _UNSET:
        changes["status"] = _choice(status, "status", STATUSES, "open")
    who = _choice(actor, "actor", ACTORS, "user")
    result: Dict[str, Any] = {}

    def apply(doc):
        item = _find(doc, str(item_id))
        effective = {k: v for k, v in changes.items() if item.get(k) != v}
        if not effective:
            result["item"] = dict(item)
            return
        if "status" in effective:
            effective["completed_at"] = _now() if effective["status"] == "done" else None
        item.update(effective, updated_at=_now(), updated_by=who)
        result["item"] = dict(item)

    return {**_mutate(apply), **result}


def delete_todo(item_id: str) -> Dict[str, Any]:
    def apply(doc):
        _find(doc, str(item_id))
        doc["items"] = [i for i in doc["items"] if i["id"] != item_id]

    return _mutate(apply)


def clear_completed() -> Dict[str, Any]:
    def apply(doc):
        doc["items"] = [i for i in doc["items"] if i.get("status") != "done"]

    return _mutate(apply)

