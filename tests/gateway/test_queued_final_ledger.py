"""A queued-lane final is ledger-bracketed like the normal final send.

When a follow-up is queued behind a turn (a message typed while the agent worked, a
subagent batch reporting back), the first response is delivered by the queued lane in
``run_turn.py`` before the follow-up runs. That lane called ``adapter.send`` bare and
discarded the result: no delivery-ledger row was recorded, so a final refused there
(flood control, a transport that had just died) was lost for good. Neither the boot
sweep nor the runtime redelivery could see it, and the follow-up ran as if the answer
had landed. On 5 Sep 2026 two long replies were lost this way within an hour, both
refused by Telegram flood control while a delegation batch arrived the same second.

Now the queued lane runs the same bracket as the normal lane: the obligation is
recorded before the send, the send goes through the adapter's retrying transport, and
the result finalizes the row. The obligation id is keyed on the raw inbound message id
exactly as the normal lane keys it; the reply anchor is only the reply target and is
None wherever replies are not used (Telegram forum topics), so it cannot identify the
turn. The reply is marked notify-worthy like every other final. The reconcile-by-edit
path is unchanged. Adapters without the base contract and sends without a session key
keep the plain send.
"""

from __future__ import annotations

import os
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from gateway import delivery_ledger as dl
from gateway.config import Platform
from gateway.platforms.base import BasePlatformAdapter, SendResult

SESSION_KEY = "agent:main:telegram:dm:5230977008"
TOPIC_SESSION_KEY = "agent:main:telegram:group:-1001:topic:7"
CHAT = "5230977008"
INBOUND_ID = "5301"
TEXT = "**Yes.** I would make room for one island trip and one Balkan trip."


@pytest.fixture(autouse=True)
def _fresh_db(tmp_path, monkeypatch):
    home = tmp_path / ".scout"
    home.mkdir()
    monkeypatch.setattr(dl, "_db_path", lambda: home / "state.db")
    monkeypatch.setattr(dl, "_owner_stamp", lambda: (os.getpid(), 202))
    monkeypatch.setattr(dl, "ledger_enabled", lambda config=None: True)
    yield


_COLUMNS = ("obligation_id", "session_key", "state", "attempts", "last_error", "content", "chat_id",
            "platform")


def _rows():
    with dl._connect() as conn:
        cur = conn.execute(f"SELECT {', '.join(_COLUMNS)} FROM delivery_obligations")
        return [dict(zip(_COLUMNS, r)) for r in cur.fetchall()]


def _source(*, chat_id=CHAT, thread_id=None, chat_type="dm"):
    # parent_chat_id is a real SessionSource field; the queued-followup path reads it to pin the
    # channel inputs, so the stub carries it like every real source does.
    return SimpleNamespace(platform=Platform.HOMEASSISTANT, chat_id=chat_id, thread_id=thread_id,
                           chat_type=chat_type, parent_chat_id=None)


def _plain_adapter():
    """A relay-style double without the base contract: only ``send`` and the media helpers."""
    return SimpleNamespace(
        name="relay", extract_media=BasePlatformAdapter.extract_media,
        send=AsyncMock(return_value=SendResult(success=True, message_id="p1")))


def _runner():
    from gateway.run import GatewayRunner

    return object.__new__(GatewayRunner)


async def _deliver(adapter, *, session_key=SESSION_KEY, stream_consumer=None, metadata=None,
                   text=TEXT, source=None, anchor=INBOUND_ID, inbound_id=INBOUND_ID):
    from gateway.run import GatewayRunner

    await GatewayRunner._deliver_queued_first_response(
        _runner(), text, source=source or _source(), adapter=adapter, metadata=metadata,
        event_message_id=anchor, text_already_delivered=False, deliver_media=False,
        stream_consumer=stream_consumer, session_key=session_key, inbound_message_id=inbound_id)


# ---------------------------------------------------------------------------
# The bracket: record before the send, finalize from the result.
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# What is unchanged: reconcile-by-edit, plain adapters, no session key.
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_an_adapter_without_the_base_contract_keeps_the_plain_send():
    adapter = _plain_adapter()

    await _deliver(adapter, metadata={"thread_id": "t"})

    adapter.send.assert_awaited_once_with(CHAT, TEXT, metadata={"thread_id": "t"})
    assert _rows() == []


# ---------------------------------------------------------------------------
# The call site hands the session key and the raw inbound id over.
# ---------------------------------------------------------------------------

def _chain_runner_and_ctx(followup_return):
    """A runner whose recursive ``_run_agent`` returns ``followup_return``, plus a topic turn."""
    from gateway.run import GatewayRunner

    runner = _runner()
    runner._MAX_INTERRUPT_DEPTH = 8
    runner._run_agent = AsyncMock(return_value=followup_return)
    runner._run_agent_deliver_first_response = AsyncMock()
    runner._is_goal_continuation_event = MagicMock(return_value=False)
    runner._session_key_for_source = MagicMock(return_value=TOPIC_SESSION_KEY)
    runner._prepare_profile_scoped_inbound_message_text = AsyncMock(return_value="the follow-up")
    runner._reply_anchor_for_event = MagicMock(return_value=None)
    runner._delivery_adapter_for = MagicMock(return_value=None)
    runner._refresh_agent_cache_message_count = AsyncMock()
    topic = _source(chat_id="-1001", thread_id="7", chat_type="supergroup")
    turn_ctx = SimpleNamespace(
        source=topic, session_id="sid", session_key=TOPIC_SESSION_KEY, run_generation=1,
        _interrupt_depth=0, history=[], _status_thread_metadata={"thread_id": "7"},
        context_prompt=None, result_holder=[None])
    pending_event = SimpleNamespace(
        source=topic, message_id="6002", channel_prompt=None, message_type=None,
        internal=False, metadata={}, reply_expected=None)
    return GatewayRunner, runner, turn_ctx, pending_event


@pytest.mark.asyncio
async def test_a_chained_queued_turn_carries_its_own_inbound_id():
    """A queued follow-up that itself queues another follow-up (recursive _run_agent) must pass the
    inbound id on, or the chained turn's own queued final would key on None in a forum topic and
    collide with a sibling. The recursive call carries pending_event's raw message id."""
    from gateway.run import GatewayRunner

    runner = _runner()
    runner._MAX_INTERRUPT_DEPTH = 8
    runner._run_agent = AsyncMock(return_value={"final_response": "done", "messages": []})
    runner._run_agent_deliver_first_response = AsyncMock()
    runner._is_goal_continuation_event = MagicMock(return_value=False)
    runner._session_key_for_source = MagicMock(return_value=TOPIC_SESSION_KEY)
    runner._prepare_profile_scoped_inbound_message_text = AsyncMock(return_value="the follow-up")
    runner._reply_anchor_for_event = MagicMock(return_value=None)   # forum topic: no anchor
    runner._delivery_adapter_for = MagicMock(return_value=None)
    runner._refresh_agent_cache_message_count = AsyncMock()
    topic = _source(chat_id="-1001", thread_id="7", chat_type="supergroup")
    turn_ctx = SimpleNamespace(
        source=topic, session_id="sid", session_key=TOPIC_SESSION_KEY, run_generation=1,
        _interrupt_depth=0, history=[], _status_thread_metadata={"thread_id": "7"},
        context_prompt=None, result_holder=[None])
    pending_event = SimpleNamespace(
        source=topic, message_id="6002", channel_prompt=None, message_type=None,
        internal=False, metadata={}, reply_expected=None)

    await GatewayRunner._run_agent_queued_followup(
        runner, turn_ctx, adapter=None, pending="hi again", pending_event=pending_event,
        response="resp", result={"interrupted": True, "messages": []}, stream_task=None)

    runner._run_agent.assert_awaited_once()
    assert runner._run_agent.await_args.kwargs["inbound_message_id"] == "6002"
    assert runner._run_agent.await_args.kwargs["event_message_id"] is None


# ---------------------------------------------------------------------------
# A chain's terminal reply must not overwrite an earlier turn's row.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_a_deeper_chain_keeps_the_innermost_inbound_id():
    """Chained follow-ups nest, and the LAST message answered owns the ledger identity, so an id
    already set by a deeper recursion must not be overwritten on the way out."""
    GatewayRunner, runner, turn_ctx, pending_event = _chain_runner_and_ctx(
        {"final_response": "done", "messages": [], "queued_terminal_inbound_id": "6003"})

    merged = await GatewayRunner._run_agent_queued_followup(
        runner, turn_ctx, adapter=None, pending="hi again", pending_event=pending_event,
        response="resp", result={"interrupted": True, "messages": []}, stream_task=None)

    assert merged["queued_terminal_inbound_id"] == "6003"


# ---------------------------------------------------------------------------
# The adapter that sent the final owns its message id: the ephemeral delete goes there.
# ---------------------------------------------------------------------------

