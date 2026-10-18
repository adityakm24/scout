"""Live-adapter delivery confirmation for cron (#77763).

A ``no_agent`` job fired, the scheduler logged
``delivered to telegram:<chat> via live adapter``, and the user received
nothing — no message row, no delivery obligation. The log line was not
evidence of a send:

* the silence-narration filter returns ``{"success": True, "delivered": False}``
  (a successful *drop*), and the normalization block read only ``success``;
* an empty payload skipped the send entirely and still fell into the
  "delivered" branch;
* the log line named the chat but not the lane, so a wrong-thread delivery and
  a phantom one look identical after the fact.

These tests pin the confirmation contract: positive evidence, honest logging,
and fail-closed on nothing-to-send.
"""

import asyncio
import logging
import time
from concurrent.futures import Future
from unittest.mock import MagicMock, patch

import pytest

from cron import scheduler_delivery as sched_delivery
from cron.scheduler import _deliver_result
from cron.scheduler_delivery import _confirm_adapter_delivery
from gateway.config import Platform, PlatformConfig


# ---------------------------------------------------------------------------
# _confirm_adapter_delivery: the contract in isolation
# ---------------------------------------------------------------------------

class _SendResult:
    """Minimal stand-in for an adapter SendResult."""

    def __init__(self, success=True, message_id=None, raw_response=None, **extra):
        self.success = success
        self.message_id = message_id
        self.raw_response = raw_response
        for key, value in extra.items():
            setattr(self, key, value)


class TestConfirmAdapterDelivery:
    def test_none_is_not_delivered(self):
        assert _confirm_adapter_delivery(None, "j1") is False

    def test_missing_success_is_not_delivered(self):
        assert _confirm_adapter_delivery(object(), "j1") is False
        assert _confirm_adapter_delivery({"message_id": 7}, "j1") is False

    def test_explicit_failure_is_not_delivered(self):
        assert _confirm_adapter_delivery(_SendResult(success=False), "j1") is False
        assert _confirm_adapter_delivery({"success": False}, "j1") is False

    def test_filtered_dict_is_not_delivered(self):
        """The exact silence-filter shape: a successful DROP is not a delivery."""
        filtered = {"success": True, "filtered": "silence_narration", "delivered": False}
        assert _confirm_adapter_delivery(filtered, "j1") is False


    def test_positive_evidence_is_delivered_without_warning(self, caplog):
        with caplog.at_level(logging.WARNING, logger="cron.scheduler"):
            assert _confirm_adapter_delivery(_SendResult(message_id=1234), "j1") is True
        assert "UNVERIFIED" not in caplog.text

    def test_raw_response_alone_counts_as_evidence(self, caplog):
        with caplog.at_level(logging.WARNING, logger="cron.scheduler"):
            result = _SendResult(raw_response={"ok": True})
            assert _confirm_adapter_delivery(result, "j1") is True
        assert "UNVERIFIED" not in caplog.text

    def test_evidence_free_success_is_accepted_but_warned(self, caplog):
        """Not proof of failure either — accept it, but say so in the log."""
        with caplog.at_level(logging.WARNING, logger="cron.scheduler"):
            assert _confirm_adapter_delivery(_SendResult(), "92e639af907f") is True
        assert "UNVERIFIED" in caplog.text
        assert "92e639af907f" in caplog.text



# ---------------------------------------------------------------------------
# _deliver_result: the live lane end to end
# ---------------------------------------------------------------------------

CHAT_ID = "-1001234567890"


def _job(thread_id=None):
    origin = {"platform": "telegram", "chat_id": CHAT_ID}
    if thread_id is not None:
        origin["thread_id"] = thread_id
    return {
        "id": "92e639af907f",
        "name": "Ghost Delivery",
        "deliver": "origin",
        "origin": origin,
    }


def _gateway_config(relay=False):
    config = MagicMock()
    platforms = {Platform.HOMEASSISTANT: PlatformConfig(enabled=True)}
    if relay:
        platforms[Platform.HOMEASSISTANT] = PlatformConfig(enabled=True)
    config.platforms = platforms
    config.get_home_channel = lambda p: None
    return config


def _adapters(relay=False):
    adapter = MagicMock()
    if relay:
        adapter.fronts_platform = lambda p: p == Platform.HOMEASSISTANT
        return {Platform.HOMEASSISTANT: adapter}
    return {Platform.HOMEASSISTANT: adapter}


RECORDED_VERIFICATION = []


def _record_verification(job, unverified_targets):
    RECORDED_VERIFICATION.append((job["id"], list(unverified_targets)))


def _run(job, content, send_result, relay=False, standalone_result=None, cron_cfg=None):
    """Drive ``_deliver_result`` over the live lane with a stubbed router.

    Returns ``(error, router_calls, standalone_calls)``. ``cron_cfg`` extends
    the ``cron:`` section handed to the scheduler (default: unwrapped output).
    """
    loop = MagicMock()
    loop.is_running.return_value = True

    def fake_run_coro(coro, _loop):
        future = Future()
        try:
            future.set_result(asyncio.run(coro))
        except BaseException as e:  # noqa: BLE001
            future.set_exception(e)
        return future

    router_calls = []
    standalone_calls = []
    RECORDED_VERIFICATION.clear()

    router = MagicMock()

    async def _deliver_to_platform(target, text, metadata, transport=None):
        router_calls.append({"target": target, "text": text, "metadata": metadata})
        return send_result

    router._deliver_to_platform = _deliver_to_platform

    async def _fake_send_to_platform(platform, pconfig, chat_id, text, **kwargs):
        standalone_calls.append({"chat_id": chat_id, "text": text, "kwargs": kwargs})
        return standalone_result if standalone_result is not None else {}

    with patch("gateway.config.load_gateway_config", return_value=_gateway_config(relay)), \
         patch("cron.scheduler.load_config",
               return_value={"cron": {"wrap_response": False, **(cron_cfg or {})}}), \
         patch("cron.scheduler_delivery._record_delivery_verification", side_effect=_record_verification), \
         patch("gateway.delivery.DeliveryRouter", return_value=router), \
         patch("tools.send_message_tool._send_to_platform", _fake_send_to_platform), \
         patch("asyncio.run_coroutine_threadsafe", side_effect=fake_run_coro):
        error = _deliver_result(job, content, adapters=_adapters(relay), loop=loop)
    return error, router_calls, standalone_calls













class TestUnverifiedDeliveryIsRecordedOnTheJob:
    """An evidence-free ack is accepted, but the state must reach the job
    record (and from there ``scout cron list`` / ``cron doctor``), not only a
    WARNING log line."""




    def test_recorder_clears_a_stale_marker(self):
        with patch("cron.jobs.update_job") as update_job:
            sched_delivery._record_delivery_verification({"id": "j1", "last_delivery_unverified": ["slack:C1"]}, [])
            update_job.assert_called_once_with("j1", {"last_delivery_unverified": None})





