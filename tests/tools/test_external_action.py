"""External writes run only after the person approves the exact action (tools/external_action_tool.py)."""

import json
import subprocess

from tools import external_action_tool

SEND = {"action": "send_email", "to": "sam@example.org", "subject": "Lunch", "body": "Friday at noon?"}


def test_a_declined_approval_never_runs_the_action(monkeypatch):
    monkeypatch.setattr(external_action_tool, "_approved", lambda title, card: False)
    monkeypatch.setattr(subprocess, "run", lambda *a, **k: (_ for _ in ()).throw(AssertionError("ran")))

    out = json.loads(external_action_tool.external_action(SEND))

    assert out["success"] is False and out["error_type"] == "declined"


def test_the_approved_card_shows_exactly_what_runs(monkeypatch):
    seen = {}

    def _approve(title, card):
        seen["card"] = card
        return True

    def _run(argv, **kwargs):
        seen["argv"] = argv
        return subprocess.CompletedProcess(argv, 0, stdout=json.dumps({"status": "sent", "id": "m1"}), stderr="")

    monkeypatch.setattr(external_action_tool, "_approved", _approve)
    monkeypatch.setattr(external_action_tool.subprocess, "run", _run)

    out = json.loads(external_action_tool.external_action(SEND))

    assert out["success"] is True
    for value in (SEND["to"], SEND["subject"], SEND["body"]):
        assert value in seen["card"] and value in seen["argv"]
