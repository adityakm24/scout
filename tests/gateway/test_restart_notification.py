"""Tests for /restart notification — the gateway notifies the requester on comeback."""

import json
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

import gateway.run as gateway_run
from gateway.config import HomeChannel, Platform, PlatformConfig
from gateway.platforms.base import SendResult
from gateway.platforms.event import MessageEvent, MessageType
from gateway.session import build_session_key
from tests.gateway.restart_test_helpers import (
    make_restart_runner,
    make_restart_source,
)


# ── restart marker helpers ───────────────────────────────────────────────


def test_planned_restart_notification_pending_roundtrip(tmp_path, monkeypatch):
    monkeypatch.setattr(gateway_run, "_scout_home", tmp_path)
    marker = tmp_path / ".restart_pending.json"

    assert gateway_run._planned_restart_notification_pending() is False
    marker.write_text("{}")
    assert gateway_run._planned_restart_notification_pending() is True

    gateway_run._planned_restart_notification_path().unlink()

    assert gateway_run._planned_restart_notification_pending() is False


# ── _handle_restart_command writes .restart_notify.json ──────────────────










# ── home-channel startup notifications ─────────────────────────────────────






# ── _send_restart_notification ───────────────────────────────────────────














