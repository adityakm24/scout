"""A clarify card that cannot render is retried as plain text, and a card that fails late does
not pass for user inactivity (#112684).

Real ``TurnRunner._clarify_callback_sync`` + real ``tools.clarify_gateway`` + a real gateway loop
thread; the adapter is Telegram-shaped (``SendResult`` shapes from
``plugins/platforms/telegram/adapter.py::_send_prompt``) with a native ``send_clarify`` override.
"""

import asyncio
import json
import threading
import time
from types import SimpleNamespace

import pytest

from gateway.platforms.base import BasePlatformAdapter, SendResult
from tools import clarify_gateway as cm

UNDELIVERED = "[clarify prompt could not be delivered"  # prefix shared by every delivery notice


class _CardAdapter(BasePlatformAdapter):
    """Native card override; ``card`` is the coroutine function the card send runs."""

    def __init__(self, card):
        self.card = card
        self.sent_text: list[str] = []
        self.cards = 0
        self.on_text_sent = None

    def pause_typing_for_chat(self, chat_id):
        return None

    def resume_typing_for_chat(self, chat_id):
        return None

    async def send_clarify(self, **kwargs):
        self.cards += 1
        return await self.card()

    async def send(self, chat_id, content, reply_to=None, metadata=None):
        self.sent_text.append(content)
        if self.on_text_sent is not None:
            callback, self.on_text_sent = self.on_text_sent, None
            callback()
        return SendResult(success=True, message_id="t1")

    async def retire_clarify_card(self, clarify_id, notice):
        return None

    async def connect(self):
        return True

    async def disconnect(self):
        return None

    async def get_chat_info(self, chat_id):
        return {}


@pytest.fixture
def loop():
    loop = asyncio.new_event_loop()
    thread = threading.Thread(target=loop.run_forever, daemon=True)
    thread.start()
    yield loop
    loop.call_soon_threadsafe(loop.stop)
    thread.join(timeout=5)


def _runner(adapter, loop, monkeypatch, timeout=5):
    from gateway.run_turn_runner import TurnRunner

    runner = object.__new__(TurnRunner)
    runner._ctx = SimpleNamespace(
        _status_adapter=adapter, _status_chat_id="42", _status_thread_metadata=None,
        session_key="sk-fallback", stream_consumer_holder=[None], _loop_for_step=loop)
    runner._close_native_stream_boundary = lambda *a, **k: None
    monkeypatch.setattr(cm, "get_clarify_timeout", lambda: timeout)
    return runner


def _answer_once_text_prompt_is_seen(adapter, text):
    """Answer causally from the adapter's plain-text send, never from a timing poll."""
    adapter.on_text_sent = lambda: cm.resolve_text_response_for_session("sk-fallback", text)


# --- Atom: the platform rejects the native card -> plain-text question instead of a sentinel ---


def test_rejected_card_is_reasked_as_plain_text_and_the_typed_answer_counts(loop, monkeypatch):
    async def rejected():
        return SendResult(success=False, error="Bad Request: BUTTON_TYPE_INVALID")

    adapter = _CardAdapter(rejected)
    _answer_once_text_prompt_is_seen(adapter, "2")
    response = _runner(adapter, loop, monkeypatch)._clarify_callback_sync("Pick?", ["alpha", "beta"])
    assert response == "beta"  # the numbered text prompt maps "2" back to the choice
    assert adapter.cards == 1
    assert len(adapter.sent_text) == 1 and "1. alpha" in adapter.sent_text[0]




# --- Atom: the card send outruns the ack window, then fails -------------------------------


def test_card_failing_after_the_ack_window_falls_back_to_text_instead_of_waiting(loop, monkeypatch):
    from gateway import run_turn_runner_clarify_delivery as delivery

    monkeypatch.setattr(delivery, "SEND_ACK_WINDOW", 0.2)

    async def late_failure():
        await asyncio.sleep(0.6)
        return SendResult(success=False, error="Timed out: pool timeout")

    adapter = _CardAdapter(late_failure)
    _answer_once_text_prompt_is_seen(adapter, "beta")
    started = time.monotonic()
    response = _runner(adapter, loop, monkeypatch, timeout=30)._clarify_callback_sync("Pick?", ["alpha", "beta"])
    elapsed = time.monotonic() - started
    assert response == "beta"
    assert len(adapter.sent_text) == 1  # the plain-text prompt was actually sent, once
    assert elapsed < 0.2 + 2  # released right after the ack window + late failure, never clarify_timeout




def test_card_and_text_both_failing_late_release_the_wait_with_the_delivery_notice(loop, monkeypatch):
    """Before: a card whose send failed after the window left the agent blocked for the whole
    clarify_timeout and then reported ``[user did not respond within Nm]`` for a question the user
    never saw."""
    from gateway import run_turn_runner_clarify_delivery as delivery

    monkeypatch.setattr(delivery, "SEND_ACK_WINDOW", 0.2)

    async def late_failure():
        await asyncio.sleep(0.6)
        return SendResult(success=False, error="Timed out: pool timeout")

    class _NoTextEither(_CardAdapter):
        async def send(self, chat_id, content, reply_to=None, metadata=None):
            self.sent_text.append(content)
            return SendResult(success=False, error="Timed out")

    adapter = _NoTextEither(late_failure)
    started = time.monotonic()
    response, answered = _runner(adapter, loop, monkeypatch, timeout=30)._ask_clarify_question(
        "Pick?", ["alpha", "beta"], False)
    assert (response, answered) == (UNDELIVERED + "]", False)
    assert time.monotonic() - started < 10
    assert len(adapter.sent_text) == 1  # the text fallback was tried exactly once




# --- Atom: no chat surface at all -----------------------------------------------------------


def test_no_status_adapter_reports_the_missing_surface_not_inactivity(loop, monkeypatch):
    runner = _runner(None, loop, monkeypatch)
    payload = json.loads(runner._clarify_callback_sync(
        "", None, questions=[{"qid": "q0", "question": "One?", "choices": ["a"]}]))
    assert payload["timed_out"] is True
    assert payload["notice"].startswith(UNDELIVERED)
    assert runner._clarify_callback_sync("One?", ["a"]).startswith(UNDELIVERED)
