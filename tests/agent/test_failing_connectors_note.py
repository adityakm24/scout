"""A connector the user set up that fails to connect is named in the prompt with its reason.

A signed-in Gmail whose server refused access left the model with no email tools and no idea why,
so it answered "I don't have access to your emails" instead of the actual fix.
"""
from types import SimpleNamespace

import pytest

from agent import system_prompt


@pytest.fixture
def status(monkeypatch):
    rows = []
    monkeypatch.setattr("tools.mcp_tool_discovery.get_mcp_status", lambda *a, **k: rows)
    return rows


def _guidance():
    return system_prompt._tool_guidance_block(SimpleNamespace(valid_tool_names=set())) or ""


def test_failed_connector_is_named_with_its_reason(status):
    status += [{"name": "gmail", "status": "failed", "error": "refused access; enable gmailmcp.googleapis.com"},
               {"name": "zepto", "status": "connected"}]

    text = _guidance()

    assert "gmail: refused access; enable gmailmcp.googleapis.com" in text
    assert "zepto" not in text


def test_nothing_is_added_when_every_connector_works(status):
    status.append({"name": "zepto", "status": "connected"})

    assert "set up but failed" not in _guidance()


def test_a_connected_google_account_is_stated_with_its_command(status, tmp_path, monkeypatch):
    """A signed-in Google account is reached through `scout google`; a small model web-searched
    `site:mail.google.com` and told the user it had no access instead."""
    import json

    monkeypatch.setattr(system_prompt, "_agent_home", lambda agent: tmp_path)
    agent = SimpleNamespace(valid_tool_names={"terminal"})
    assert "scout google" not in (system_prompt._tool_guidance_block(agent) or "")

    (tmp_path / "google_token.json").write_text(json.dumps({"refresh_token": "rt", "account": "me@gmail.com"}))

    text = system_prompt._tool_guidance_block(agent)
    assert "me@gmail.com" in text and "scout google gmail search" in text
