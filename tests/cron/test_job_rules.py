"""Standing rules on a scheduled job ("ignore transaction emails") reach every run's prompt.

The user tells the agent once; the job carries the rule from then on — through create, update
(the agent's cronjob tool and the desktop Heartbeat), and the scheduler's prompt build.
"""
import json

from cron import jobs
from cron.scheduler_prompt import _build_job_prompt


def test_rules_set_on_a_job_reach_its_runs_until_cleared(tmp_path, monkeypatch):
    monkeypatch.setattr(jobs, "CRON_DIR", tmp_path)
    monkeypatch.setattr(jobs, "JOBS_FILE", tmp_path / "jobs.json")
    monkeypatch.setattr(jobs, "OUTPUT_DIR", tmp_path / "output")

    job = jobs.create_job(prompt="Summarise new email.", schedule="every 30m")
    assert "rules" not in job  # unset stays byte-identical to older jobs

    jobs.update_job(job["id"], {"rules": ["ignore transaction emails", "  "]})
    stored = jobs.get_job(job["id"])
    assert stored["rules"] == ["ignore transaction emails"]
    prompt = _build_job_prompt(stored)
    assert "- ignore transaction emails" in prompt and "[SILENT]" in prompt

    jobs.update_job(job["id"], {"rules": []})
    assert "rules for this job" not in _build_job_prompt(jobs.get_job(job["id"]))


def test_the_agent_can_give_a_job_rules(tmp_path, monkeypatch):
    from tools import cronjob_tools

    monkeypatch.setattr(jobs, "CRON_DIR", tmp_path)
    monkeypatch.setattr(jobs, "JOBS_FILE", tmp_path / "jobs.json")
    monkeypatch.setattr(jobs, "OUTPUT_DIR", tmp_path / "output")
    job = jobs.create_job(prompt="Summarise new email.", schedule="every 30m")

    result = json.loads(cronjob_tools.cronjob(action="update", job_id=job["id"], rules=["ignore transaction emails"]))

    assert result.get("success") is not False, result
    assert jobs.get_job(job["id"])["rules"] == ["ignore transaction emails"]


def test_rules_can_be_managed_from_the_terminal(tmp_path, monkeypatch, capsys):
    """The terminal path the agent always has: `scout cron rules <job> add|remove|clear`."""
    from types import SimpleNamespace

    from scout_cli.cron import cron_rules

    monkeypatch.setattr(jobs, "CRON_DIR", tmp_path)
    monkeypatch.setattr(jobs, "JOBS_FILE", tmp_path / "jobs.json")
    monkeypatch.setattr(jobs, "OUTPUT_DIR", tmp_path / "output")
    job = jobs.create_job(prompt="Summarise new email.", schedule="every 30m", name="New email check")

    def run(action, value=None):
        return cron_rules(SimpleNamespace(job_id="New email check", rules_action=action, value=value))

    assert run("add", "ignore transaction emails") == 0
    assert run("add", "only family on weekends") == 0
    assert run("remove", "1") == 0
    assert jobs.get_job(job["id"])["rules"] == ["only family on weekends"]
    assert run("remove", "5") == 1
    assert run("clear") == 0 and not jobs.get_job(job["id"]).get("rules")
