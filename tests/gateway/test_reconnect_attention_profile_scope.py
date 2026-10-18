"""``agent.reconnect_attention_after`` is read from the profile whose scope is bound at call time.

Regression for #115635: the threshold was a module constant frozen from ``os.environ`` at import,
so a multiplexed secondary escalated at the LAUNCH profile's value and a live config edit needed a
gateway restart. Two homes, A -> B -> A, per AGENTS.md § "One process may serve many profiles".
"""
import asyncio
import time

import pytest
import scout_yaml as yaml

import gateway.run as gateway_run
from gateway.config import Platform
from gateway.run import GatewayRunner


def _home_with_threshold(root, name, seconds):
    home = root / name
    home.mkdir()
    (home / "config.yaml").write_text(
        yaml.safe_dump({"agent": {"reconnect_attention_after": seconds}}), encoding="utf-8")
    return home


def test_threshold_follows_bound_profile_scope_a_b_a(tmp_path, monkeypatch):
    home_a = _home_with_threshold(tmp_path, "a", 10)
    home_b = _home_with_threshold(tmp_path, "b", 100000)
    monkeypatch.setenv("SCOUT_HOME", str(home_a))
    now = time.monotonic()
    queued_20s_ago = {"queued_at": now - 20}

    assert gateway_run._reconnect_needs_attention(dict(queued_20s_ago), now) is True
    with gateway_run._profile_runtime_scope(home_b, hydrate_secrets=False):
        assert gateway_run._reconnect_needs_attention(dict(queued_20s_ago), now) is False
    assert gateway_run._reconnect_needs_attention(dict(queued_20s_ago), now) is True

    # Live edit of the bound profile's config takes effect on the next call, no restart.
    (home_a / "config.yaml").write_text(
        yaml.safe_dump({"agent": {"reconnect_attention_after": 100000}}), encoding="utf-8")
    assert gateway_run._reconnect_needs_attention(dict(queued_20s_ago), now) is False


