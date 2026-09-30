"""Reminder jobs: the stored text IS the delivery — no agent, no script, no tokens.

A reminder is a ``no_agent`` job carrying ``reminder`` text instead of a script (the planner's
reminders; see ``planner/reminders.py``). It rides the ordinary run path from there: the
delivery, occurrence accounting and repeat bookkeeping are cron's, unchanged.
"""

from __future__ import annotations

from datetime import datetime
from typing import Optional

REMINDER_PREFIX = "⏰ Reminder: "

# A one-shot job that missed its minute by more than cron's 120s grace is retired unrun — right for
# work that only made sense at that time, wrong for a reminder: after the laptop slept through it,
# the user still wants to be told. Reminders fire late (saying so) for up to a week.
REMINDER_LATE_GRACE_SECONDS = 7 * 24 * 3600
LATE_AFTER_SECONDS = 120


def oneshot_grace_seconds(job: dict, default: int) -> int:
    """The lateness a one-shot may fire with: the reminder window for reminders, else ``default``."""
    return REMINDER_LATE_GRACE_SECONDS if str(job.get("reminder") or "").strip() else default


def reminder_message(text: str, *, was_due: Optional[datetime] = None) -> str:
    """What the user receives when a reminder fires; a late one names the time it was due."""
    late = f" (was due {was_due.strftime('%a %H:%M')})" if was_due is not None else ""
    return f"{REMINDER_PREFIX}{text.strip()}{late}"


def _late_due_time(job: dict, now: datetime) -> Optional[datetime]:
    """The one-shot's due time when this fire is noticeably late, else None."""
    run_at = (job.get("schedule") or {}).get("run_at")
    if not run_at:
        return None
    try:
        due = datetime.fromisoformat(str(run_at))
    except ValueError:
        return None
    if due.tzinfo is None or now.tzinfo is None:
        return None
    return due if (now - due).total_seconds() > LATE_AFTER_SECONDS else None


def run_reminder_job(job: dict, job_id: str, job_name: str) -> tuple[bool, str, str, Optional[str]]:
    """``(success, run document, delivered text, error)`` — the no_agent result shape."""
    from cron import scheduler as _sched

    now = _sched._scout_now()
    message = reminder_message(str(job.get("reminder") or ""), was_due=_late_due_time(job, now))
    now_iso = now.strftime("%Y-%m-%d %H:%M:%S")
    header = _sched._job_doc_header(job_name, job_id, now_iso, "reminder")
    return True, f"{header}\n---\n\n{message}\n", message, None
