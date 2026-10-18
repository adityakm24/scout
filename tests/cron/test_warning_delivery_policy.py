"""Failure classification survives durable delivery and drain-time policy changes."""
from unittest.mock import patch

import pytest

from cron import delivery_queue, scheduler
from cron.scheduler_delivery import _deliver_result


@pytest.fixture(autouse=True)
def configured_transport():
    from gateway.config import GatewayConfig, Platform, PlatformConfig
    config = GatewayConfig()
    config.platforms[Platform.HOMEASSISTANT] = PlatformConfig(enabled=True)
    with patch("gateway.config.load_gateway_config", return_value=config):
        yield


@pytest.mark.parametrize("suppress", [False, True])
def test_failure_queue_settles_without_claiming_a_suppressed_send(tmp_path, monkeypatch, suppress):
    monkeypatch.setenv("SCOUT_HOME", str(tmp_path))
    monkeypatch.setattr(delivery_queue, "DELIVERY_DB", tmp_path / "queue.db")
    (tmp_path / "config.yaml").write_text("display: {suppress_warning_notifications: false}\n")
    job = {"id": "fixture", "name": "fixture", "deliver": "homeassistant:chat", "execution_id": "run"}
    delivery_queue.enqueue("run", job, "arbitrary diagnostic", for_failure=True)
    (tmp_path / "config.yaml").write_text(f"display: {{suppress_warning_notifications: {str(suppress).lower()}}}\n")
    with patch("cron.scheduler_delivery._deliver_standalone") as send:
        assert scheduler.drain_delivery_queue({}, None) == 1
    row = delivery_queue.get_status("run")
    assert row["status"] == ("suppressed" if suppress else "delivered")
    assert send.call_count == (0 if suppress else 1)
    assert scheduler.drain_delivery_queue({}, None) == 0




