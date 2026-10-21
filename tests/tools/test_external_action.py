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


def test_draft_email_card_includes_cc_and_full_draft_on_gateway(monkeypatch):
    from tools import approval as _a, approval_context as _ctx, approval_gateway_wait as _gw

    dispatched = {}

    monkeypatch.setattr(_ctx, "get_current_session_key", lambda: "sess-1")
    monkeypatch.setattr(_ctx, "_is_gateway_approval_context", lambda: True)
    monkeypatch.setattr(_a, "_gateway_notify_cb", lambda sk: lambda data: None)

    def _fake_decision(session_key, notify_cb, data, *, surface="gateway"):
        dispatched.update(data)
        return {"resolved": True, "choice": "once"}

    monkeypatch.setattr(_gw, "_await_gateway_decision", _fake_decision)
    monkeypatch.setattr(
        external_action_tool.subprocess,
        "run",
        lambda argv, **kw: subprocess.CompletedProcess(
            argv, 0, stdout=json.dumps({"status": "draft_created", "draft_id": "d1"}), stderr=""
        ),
    )

    draft = {
        "action": "draft_email",
        "to": "maharajaclub@flyai.airindia.com",
        "cc": "copy@example.org",
        "subject": "Unsubscribe from marketing emails",
        "body": "Please remove me from your marketing email list.\n\nThank you.",
    }
    out = json.loads(external_action_tool.external_action(draft))

    assert out["success"] is True
    assert dispatched["choices"] == ["once", "deny"]
    assert dispatched["allow_permanent"] is False
    for field in (draft["to"], draft["cc"], draft["subject"], draft["body"]):
        assert field in dispatched["description"]
