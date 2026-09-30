"""``scout todo`` / ``scout remind`` — the user's planner from the terminal.

The same per-profile store the agent's ``planner`` tool and the desktop Dashboard edit
(``planner/``), so ``scout todo done t_1a2b`` is seen by the next agent turn and every open
Dashboard. Each subparser carries its own handler via ``set_defaults(func=…)``, so aliases
(``ls``, ``rm``) dispatch without comparing the literal the user typed.
"""

from __future__ import annotations

import argparse
import json
from typing import Callable, Dict, List

_PRIORITY_MARK = {"high": "!!", "medium": "! ", "low": "· ", "none": "  "}


def _print_todos(items: List[Dict]) -> None:
    if not items:
        print("No to-dos. Add one with: scout todo add \"Buy milk\"")
        return
    for item in items:
        box = "[x]" if item.get("status") == "done" else "[ ]"
        due = f"  due {item['due']}" if item.get("due") else ""
        who = "  (by Scout)" if item.get("created_by") == "agent" else ""
        print(f"{box} {_PRIORITY_MARK.get(item.get('priority') or 'none', '  ')} {item['title']}"
              f"{due}{who}  [{item['id']}]")


def _print_reminders(reminders: List[Dict]) -> None:
    if not reminders:
        print("No reminders. Add one with: scout remind add \"Call mom\" --at \"in 2h\"")
        return
    for r in reminders:
        at = r.get("next_at") or r.get("last_fired_at") or ""
        state = {"fired": "✓ fired", "paused": "paused", "error": "error"}.get(r["status"], "⏰")
        repeat = "  (repeats)" if r.get("recurring") else ""
        print(f"{state:8} {r['text']}  — {r.get('when') or at}{repeat}  [{r['id']}]")


def _run(fn: Callable[[argparse.Namespace], Dict], show: Callable[[Dict], None]):
    """Wrap a store call: print (or ``--json``) the result; a PlannerError is exit 1."""
    def handler(args: argparse.Namespace) -> int:
        from planner.todos import PlannerError

        try:
            result = fn(args)
        except PlannerError as exc:
            print(f"✗ {exc}")
            return 1
        if getattr(args, "json", False):
            print(json.dumps(result, indent=2, ensure_ascii=False))
        else:
            show(result)
        return 0
    return handler


def _todos(args: argparse.Namespace) -> Dict:
    from planner import todos
    return todos.list_todos(include_done=not args.open)


def _todo_add(args: argparse.Namespace) -> Dict:
    from planner import todos
    return todos.add_todo(" ".join(args.title), notes=args.notes, due=args.due, priority=args.priority)


def _todo_status(status: str):
    def run(args: argparse.Namespace) -> Dict:
        from planner import todos
        return todos.update_todo(args.id, status=status)
    return run


def _todo_edit(args: argparse.Namespace) -> Dict:
    from planner import todos
    fields = {k: getattr(args, k) for k in ("title", "notes", "due", "priority") if getattr(args, k) is not None}
    return todos.update_todo(args.id, **fields)


def _todo_rm(args: argparse.Namespace) -> Dict:
    from planner import todos
    return todos.delete_todo(args.id)


def _todo_clear(args: argparse.Namespace) -> Dict:
    from planner import todos
    return todos.clear_completed()


def _reminders(args: argparse.Namespace) -> Dict:
    from planner import reminders
    return reminders.list_reminders()


def _remind_add(args: argparse.Namespace) -> Dict:
    from planner import reminders
    reminders.add_reminder(" ".join(args.text), args.at)
    return {**reminders.list_reminders(), **reminders.scheduler_notice()}


def _remind_rm(args: argparse.Namespace) -> Dict:
    from planner import reminders
    reminders.delete_reminder(args.id)
    return reminders.list_reminders()


def _show_todos(result: Dict) -> None:
    _print_todos(result.get("items") or [])


def _show_reminders(result: Dict) -> None:
    _print_reminders(result.get("reminders") or [])
    if result.get("warning"):
        print(f"\n⚠  {result['warning']}")


def _json_flag(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--json", action="store_true", help="Print the result as JSON")


def build_planner_parser(subparsers) -> None:
    """Attach ``todo`` and ``remind`` to ``subparsers``."""
    todo = subparsers.add_parser(
        "todo", help="Your to-do list (shared with Scout and the desktop Dashboard)",
        description="Manage the to-do list you share with Scout. The agent's planner tool and the "
            "desktop Dashboard edit the same list.")
    _json_flag(todo)
    todo.add_argument("--open", action="store_true", help="Hide completed items")
    todo.set_defaults(func=_run(_todos, _show_todos), open=False)
    todo_sub = todo.add_subparsers(dest="todo_command")

    p = todo_sub.add_parser("list", aliases=["ls"], help="Show the list")
    p.add_argument("--open", action="store_true", help="Hide completed items")
    _json_flag(p)
    p.set_defaults(func=_run(_todos, _show_todos))

    p = todo_sub.add_parser("add", help="Add a to-do")
    p.add_argument("title", nargs="+")
    p.add_argument("--notes", default="")
    p.add_argument("--due", default=None, help="YYYY-MM-DD or ISO datetime")
    p.add_argument("--priority", default="none", choices=["none", "low", "medium", "high"])
    _json_flag(p)
    p.set_defaults(func=_run(_todo_add, _show_todos))

    for name, status, help_text in (("done", "done", "Mark done"), ("reopen", "open", "Mark not done")):
        p = todo_sub.add_parser(name, help=help_text)
        p.add_argument("id")
        _json_flag(p)
        p.set_defaults(func=_run(_todo_status(status), _show_todos))

    p = todo_sub.add_parser("edit", help="Change a to-do's fields")
    p.add_argument("id")
    p.add_argument("--title")
    p.add_argument("--notes")
    p.add_argument("--due", help="YYYY-MM-DD or ISO datetime; '' clears")
    p.add_argument("--priority", choices=["none", "low", "medium", "high"])
    _json_flag(p)
    p.set_defaults(func=_run(_todo_edit, _show_todos))

    p = todo_sub.add_parser("rm", aliases=["remove", "delete"], help="Delete a to-do")
    p.add_argument("id")
    _json_flag(p)
    p.set_defaults(func=_run(_todo_rm, _show_todos))

    p = todo_sub.add_parser("clear", help="Delete every completed to-do")
    _json_flag(p)
    p.set_defaults(func=_run(_todo_clear, _show_todos))

    remind = subparsers.add_parser(
        "remind", help="Your reminders (shared with Scout and the desktop Dashboard)",
        description="Schedule reminders Scout delivers at a time — on the desktop as a "
            "notification. They are reminder-kind cron jobs, so `scout cron list` shows them too.")
    _json_flag(remind)
    remind.set_defaults(func=_run(_reminders, _show_reminders))
    remind_sub = remind.add_subparsers(dest="remind_command")

    p = remind_sub.add_parser("list", aliases=["ls"], help="Show reminders")
    _json_flag(p)
    p.set_defaults(func=_run(_reminders, _show_reminders))

    p = remind_sub.add_parser("add", help="Add a reminder")
    p.add_argument("text", nargs="+")
    p.add_argument("--at", required=True,
                   help="'in 30m', '2026-10-01T09:00', 'every day at 9am', 'every monday 9am', or cron syntax")
    _json_flag(p)
    p.set_defaults(func=_run(_remind_add, _show_reminders))

    p = remind_sub.add_parser("rm", aliases=["remove", "delete"], help="Delete a reminder")
    p.add_argument("id")
    _json_flag(p)
    p.set_defaults(func=_run(_remind_rm, _show_reminders))
