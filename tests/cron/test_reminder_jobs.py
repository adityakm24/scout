"""Reminder-kind cron jobs fire late instead of never.

An ordinary one-shot that missed its minute by more than cron's grace is retired unrun; a
reminder the scheduler slept through (laptop asleep, app closed) must still reach the user,
naming the time it was due.
"""

from __future__ import annotations

from datetime import timedelta

import pytest


@pytest.fixture
def home(tmp_path, monkeypatch):
    home = tmp_path / ".scout"
    (home / "cron").mkdir(parents=True)
    monkeypatch.setenv("SCOUT_HOME", str(home))
    return home


def _age_job(job_id: str, minutes: int) -> None:
    """Move a stored one-shot's due time ``minutes`` into the past (a scheduler that was down)."""
    from cron.jobs import _scout_now, load_jobs, save_jobs

    due = (_scout_now() - timedelta(minutes=minutes)).isoformat()
    jobs = load_jobs()
    for job in jobs:
        if job["id"] == job_id:
            job["schedule"]["run_at"] = due
            job["next_run_at"] = due
    save_jobs(jobs)


def test_a_missed_reminder_still_comes_due_but_a_missed_one_shot_does_not(home):
    from cron.jobs import create_job, get_due_jobs, get_job

    reminder = create_job(prompt=None, schedule="in 30m", reminder="Take the laundry out")
    chore = create_job(prompt="Summarise the inbox", schedule="in 30m")
    _age_job(reminder["id"], 45)
    _age_job(chore["id"], 45)

    due_ids = {job["id"] for job in get_due_jobs()}

    assert reminder["id"] in due_ids
    assert chore["id"] not in due_ids and get_job(chore["id"]) is None


def test_a_late_reminder_says_when_it_was_due(home):
    from cron.jobs import create_job, get_job
    from cron.scheduler import run_job

    job = create_job(prompt=None, schedule="in 30m", reminder="Stretch")
    _age_job(job["id"], 45)

    _ok, _doc, delivered, _error = run_job(get_job(job["id"]))

    assert delivered.startswith("⏰ Reminder: Stretch") and "was due" in delivered
