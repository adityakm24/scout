"""The user's reminders — reminder-kind cron jobs, seen through the planner's lens.

A reminder is a cron job whose ``reminder`` text is delivered verbatim when it fires (no agent
run, no tokens: ``cron/scheduler_reminder.py``). Storing them in the cron store means the
ticker that already serves every profile fires them, missed one-shots get cron's grace and
catch-up policy, recurring reminders ("every monday 9am") come for free, and they show up in
``scout cron list`` and the Scheduled jobs page like any other job.

``when`` accepts every cron schedule form: ``"in 30m"``, an ISO timestamp, ``"every day at
9am"``, a 5-field cron expression. A one-shot is kept after it fires (``state: completed``), so
the planner can show what already went off; ``delete_reminder`` clears it.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from planner.todos import ACTORS, PlannerError, _choice

MAX_REMINDER_CHARS = 1000

_STATUS_BY_STATE = {"completed": "fired", "paused": "paused", "error": "error"}

_UNSET = object()


def _text(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        raise PlannerError("reminder text is required")
    if len(text) > MAX_REMINDER_CHARS:
        raise PlannerError(f"reminder text is longer than {MAX_REMINDER_CHARS} characters")
    return text


def _when(value: Any) -> str:
    when = str(value or "").strip()
    if not when:
        raise PlannerError("when is required (e.g. 'in 30m', '2026-10-01T09:00', 'every monday 9am')")
    return when


def _view(job: Dict[str, Any]) -> Dict[str, Any]:
    schedule = job.get("schedule") or {}
    return {
        "id": job["id"],
        "text": str(job.get("reminder") or ""),
        "when": str(job.get("schedule_display") or schedule.get("display") or ""),
        "recurring": schedule.get("kind") in {"cron", "interval"},
        "next_at": job.get("next_run_at"),
        "last_fired_at": job.get("last_run_at"),
        "status": _STATUS_BY_STATE.get(str(job.get("state") or ""), "scheduled"),
        "created_at": job.get("created_at"),
        "created_by": job.get("reminder_by") or "user",
        "deliver": job.get("deliver") or "local",
    }


def _reminder_job(reminder_id: str) -> Dict[str, Any]:
    from cron.jobs import get_job

    job = get_job(str(reminder_id))
    if not job or not str(job.get("reminder") or "").strip():
        raise PlannerError(f"no reminder with id {reminder_id!r}")
    return job


def _cron_error(exc: ValueError) -> PlannerError:
    return PlannerError(str(exc))


def list_reminders(*, include_fired: bool = True) -> Dict[str, Any]:
    """Upcoming reminders soonest first, then fired ones most recent first."""
    from cron.jobs import list_jobs

    views = [_view(j) for j in list_jobs(include_disabled=True) if str(j.get("reminder") or "").strip()]
    if not include_fired:
        views = [v for v in views if v["status"] != "fired"]
    upcoming = sorted((v for v in views if v["status"] != "fired"), key=lambda v: v["next_at"] or "~")
    fired = sorted((v for v in views if v["status"] == "fired"), key=lambda v: v["last_fired_at"] or "", reverse=True)
    return {"reminders": upcoming + fired}


def add_reminder(text: Any, when: Any, *, actor: str = "user", origin: Optional[Dict[str, Any]] = None,
                 deliver: Optional[str] = None) -> Dict[str, Any]:
    """Schedule a reminder. ``origin`` (the chat it was asked from) makes it fire back there;
    with no origin it stays local, where the desktop notifies."""
    from cron.jobs import create_job

    body = _text(text)
    try:
        job = create_job(
            prompt=None, schedule=_when(when), name=body[:50], deliver=deliver, origin=origin,
            reminder=body, reminder_by=_choice(actor, "actor", ACTORS, "user"))
    except ValueError as exc:
        raise _cron_error(exc) from exc
    return {"reminder": _view(job)}


def update_reminder(reminder_id: str, *, text: Any = _UNSET, when: Any = _UNSET,
                    actor: str = "user") -> Dict[str, Any]:
    """Change the text and/or time. A reminder that already fired is re-created with the new
    values (cron keeps finished jobs terminal), so its id changes — the result carries the new one."""
    from cron.jobs import parse_schedule, remove_job, update_job

    job = _reminder_job(reminder_id)
    body = _text(text) if text is not _UNSET else str(job["reminder"])
    if job.get("state") == "completed":
        if when is _UNSET:
            raise PlannerError("this reminder already fired; give it a new time to set it again")
        created = add_reminder(body, when, actor=actor, origin=job.get("origin"), deliver=job.get("deliver"))
        remove_job(job["id"])
        return created
    updates: Dict[str, Any] = {}
    if text is not _UNSET:
        updates.update(reminder=body, name=body[:50])
    if when is not _UNSET:
        try:
            updates["schedule"] = parse_schedule(_when(when))
        except ValueError as exc:
            raise _cron_error(exc) from exc
    if not updates:
        return {"reminder": _view(job)}
    try:
        updated = update_job(job["id"], updates)
    except ValueError as exc:
        raise _cron_error(exc) from exc
    return {"reminder": _view(updated or job)}


def delete_reminder(reminder_id: str) -> Dict[str, Any]:
    from cron.jobs import remove_job

    job = _reminder_job(reminder_id)
    remove_job(job["id"])
    return {"removed": job["id"]}


def clear_fired() -> Dict[str, Any]:
    from cron.jobs import remove_job

    removed: List[str] = []
    for view in list_reminders()["reminders"]:
        if view["status"] == "fired" and remove_job(view["id"]):
            removed.append(view["id"])
    return {"removed": removed}


SCHEDULER_DOWN_WARNING = (
    "Nothing is running that delivers reminders for this profile, so this one is saved but will not "
    "go off until the Scout desktop app or the messaging gateway (scout gateway start) is running. "
    "If it comes due before then, it goes off as soon as one starts, saying when it was due."
)


def scheduler_notice() -> Dict[str, Any]:
    """``{"warning": ...}`` when no scheduler serves this profile, else ``{}``.

    Reminders are delivered by the cron ticker, which lives in the messaging gateway or a
    desktop-owned backend. Same probe as ``scout cron`` and the cronjob tool; an unknown
    result stays silent.
    """
    from scout_cli.cron import _builtin_gateway_liveness

    return {"warning": SCHEDULER_DOWN_WARNING} if _builtin_gateway_liveness() is False else {}
