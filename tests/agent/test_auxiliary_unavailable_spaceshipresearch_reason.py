"""The goal judge names a SpaceshipResearch auxiliary auth failure instead of an opaque judge error (#42177).

``_resolve_spaceshipresearch_runtime_api`` swallows the SpaceshipResearch resolver's ``AuthError`` so the ladder can fall
back; the failure must still reach the operator (one WARNING) and the goal-loop status line.
"""
import logging

import scout_yaml as yaml

import agent.auxiliary_unavailable as unavailable
from scout_cli.auth_constants import AuthError


def _reset(monkeypatch):
    monkeypatch.setattr(unavailable, "_last_spaceshipresearch_detail", None)
    monkeypatch.setattr(unavailable, "_warned_spaceshipresearch_details", set())


def test_goal_judge_reason_names_spaceshipresearch_auth_failure_and_still_fails_open(tmp_path, monkeypatch):
    """Real judge_goal → call_llm → ladder with goal_judge pinned to spaceshipresearch and no SpaceshipResearch login."""
    _reset(monkeypatch)
    monkeypatch.setenv("SCOUT_HOME", str(tmp_path))
    (tmp_path / "config.yaml").write_text(yaml.safe_dump({
        "model": {"provider": "spaceshipresearch", "default": "test-model"},
        "auxiliary": {"goal_judge": {"provider": "spaceshipresearch", "model": "test-model"}},
    }), encoding="utf-8")
    from scout_cli.goals import judge_goal

    verdict, reason, parse_failed, wait_directive, judge_errored = judge_goal(
        "ship the fix", "edited the file and ran the tests", timeout=5)

    assert (verdict, parse_failed, wait_directive, judge_errored) == ("continue", False, None, True)
    assert reason.startswith("goal_judge auxiliary client unavailable: Scout Portal runtime credentials unavailable:")
    assert "scout model" in reason, reason
    assert "judge error" not in reason


def test_spaceshipresearch_credential_failure_is_remembered_and_warned_once(caplog, monkeypatch):
    _reset(monkeypatch)
    exc = AuthError("Invalid refresh token", provider="spaceshipresearch", code="invalid_grant", relogin_required=True)
    with caplog.at_level(logging.WARNING, logger="agent.auxiliary_unavailable"):
        detail = unavailable.record_spaceshipresearch_credential_failure(exc)
        unavailable.record_spaceshipresearch_credential_failure(exc)

    assert detail.startswith("Scout Portal runtime credentials unavailable: ")
    assert "invalid_grant" in detail and "scout model" in detail
    assert unavailable.spaceshipresearch_credential_failure_detail() == detail
    assert sum(detail in rec.getMessage() for rec in caplog.records) == 1
    unavailable.clear_spaceshipresearch_credential_failure()
    assert unavailable.spaceshipresearch_credential_failure_detail() is None


def test_never_logged_in_is_debug_but_a_dead_credential_warns(caplog, monkeypatch, tmp_path):
    """The auto-route walk resolves SpaceshipResearch on every pass; users who never chose SpaceshipResearch must not be nagged."""
    _reset(monkeypatch)
    monkeypatch.setenv("SCOUT_HOME", str(tmp_path))
    not_logged_in = AuthError("Scout is not logged into Scout Portal.", provider="spaceshipresearch", relogin_required=True)
    dead = AuthError("Invalid refresh token", provider="spaceshipresearch", code="invalid_grant", relogin_required=True)
    with caplog.at_level(logging.DEBUG, logger="agent.auxiliary_unavailable"):
        quiet = unavailable.record_spaceshipresearch_credential_failure(not_logged_in)
        loud = unavailable.record_spaceshipresearch_credential_failure(dead)

    levels = {rec.levelno for rec in caplog.records if quiet in rec.getMessage()}
    assert levels == {logging.DEBUG}, caplog.records
    assert {rec.levelno for rec in caplog.records if loud in rec.getMessage()} == {logging.WARNING}
    assert "scout model" in quiet  # the goal judge still gets the remediation text
