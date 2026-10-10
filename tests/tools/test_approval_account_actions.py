"""Acting on the user's Google account needs the user, even in smart approval mode.

A small model ignored the google-workspace skill's "confirm first" rule and ran
`scout google gmail send` unasked: plain terminal commands only prompt when a dangerous
pattern matches, and the smart guardian approves "benign script execution".
"""
import pytest

import tools.approval as approval_module
from tools import approval_context, approval_smart
from tools.approval import check_all_command_guards, clear_session
from tools.approval_context import set_current_session_key
from tools.approval_detection import detect_dangerous_command

SEND = 'scout google gmail send --to a@example.com --subject "Saturday" --body "Are you free?"'


@pytest.mark.parametrize(("command", "gated"), [
    (SEND, True),
    ("scout google gmail reply MSG --body hi", True),
    ("python ~/.scout/skills/productivity/google-workspace/scripts/google_api.py gmail send --to a@b.c", True),
    ("scout google calendar create --summary Lunch --start 2026-10-03T12:00:00Z", True),
    ("scout google drive share FILE --email a@example.com", True),
    ('scout google gmail search "from:dbs"', False),
    ("scout google gmail get MSG", False),
    ("scout google calendar list", False),
    # Usage text sends nothing; asking for it teaches the user to click "Run" without reading.
    ("scout google gmail send --help", False),
    ("scout google calendar create -h 2>&1 | head", False),
    # ...but "--help" inside a quoted argument, or a real send after a help call, still asks.
    ('scout google gmail send --to a@example.com --body "try --help please"', True),
    ("scout google gmail send --help; " + SEND, True),
])
def test_changes_to_the_account_need_approval_and_reads_do_not(command, gated):
    assert detect_dangerous_command(command)[0] is gated


@pytest.fixture
def smart_session(monkeypatch):
    key = "test:session:account-actions"
    token = set_current_session_key(key)
    monkeypatch.setenv("SCOUT_SESSION_KEY", key)
    monkeypatch.setenv("SCOUT_INTERACTIVE", "1")
    for name in ("SCOUT_YOLO_MODE", "SCOUT_GATEWAY_SESSION", "SCOUT_EXEC_ASK", "SCOUT_CRON_SESSION"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr(approval_module, "_YOLO_MODE_FROZEN", False)
    monkeypatch.setattr(approval_module, "_permanent_approved", set())
    monkeypatch.setattr(approval_context, "_get_approval_mode", lambda: "smart")
    monkeypatch.setattr("tools.tirith_security.check_command_security",
                        lambda _: {"action": "allow", "findings": [], "summary": ""})
    consulted = []
    monkeypatch.setattr(approval_smart, "_smart_approve", lambda *args: consulted.append(args) or "approve")
    yield consulted
    approval_context._approval_session_key.reset(token)
    clear_session(key)


def test_smart_mode_still_asks_the_user_before_sending_mail(smart_session):
    asked = []

    def user(command, description, *, allow_permanent=True):
        asked.append(command)
        return "deny"

    result = check_all_command_guards(SEND, "local", approval_callback=user)

    assert result["approved"] is False and asked == [SEND]
    assert smart_session == []  # the guardian, which would have approved, is never consulted
