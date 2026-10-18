"""Regression coverage for #71643 — stale streamed finalize suppression.

A *successful* Telegram finalize edit can carry only the last streamed
preview snapshot: deltas generated between the last preview edit and stream
completion never reach any Bot API call, yet ``final_response_sent`` /
``final_content_delivered`` are set from the call's success and suppress the
gateway's normal final send. The missing tail is then lost with no retry.

These tests exercise the real gateway boundary (``GatewayRunner._run_agent``
with a live ``GatewayStreamConsumer``), per the review guidance on #71643:

1. fake agent emits a visible prefix through ``stream_delta_callback``;
2. the consumer successfully finalizes that prefix;
3. the agent returns a longer ``final_response`` containing a missing tail;
4. the result must NOT silently suppress — the complete final response must
   reach the platform (reconciliation edit or normal final send);
5. control: when the streamed text exactly equals the final text, the
   suppression still occurs (no duplicate delivery).

Plus unit coverage for ``GatewayStreamConsumer.delivered_final_matches``.
"""

import asyncio
import importlib
import sys
import types
from types import SimpleNamespace

import pytest

from gateway.config import Platform, PlatformConfig, StreamingConfig
from gateway.platforms.base import BasePlatformAdapter, SendResult
from gateway.session import SessionSource
from gateway.stream_consumer import GatewayStreamConsumer, StreamConsumerConfig


# ---------------------------------------------------------------------------
# Boundary-test fakes
# ---------------------------------------------------------------------------


class FinalizeCaptureAdapter(BasePlatformAdapter):
    """Adapter that records every send/edit with its finalize flag."""

    def __init__(self, platform=Platform.HOMEASSISTANT):
        super().__init__(PlatformConfig(enabled=True, token="***"), platform)
        self.sent = []
        self.edits = []
        self._next_id = 0

    async def connect(self, *, is_reconnect: bool = False) -> bool:
        return True

    async def disconnect(self) -> None:
        return None

    def _mint_id(self) -> str:
        self._next_id += 1
        return f"m-{self._next_id}"

    async def send(self, chat_id, content, reply_to=None, metadata=None) -> SendResult:
        self.sent.append({"chat_id": chat_id, "content": content, "metadata": metadata})
        return SendResult(success=True, message_id=self._mint_id())

    async def edit_message(
        self, chat_id, message_id, content, *, finalize: bool = False, metadata=None
    ) -> SendResult:
        self.edits.append(
            {
                "chat_id": chat_id,
                "message_id": message_id,
                "content": content,
                "finalize": finalize,
            }
        )
        return SendResult(success=True, message_id=message_id)

    async def send_typing(self, chat_id, metadata=None) -> None:
        return None

    async def stop_typing(self, chat_id) -> None:
        return None

    async def get_chat_info(self, chat_id: str):
        return {"id": chat_id}


STREAMED_PREFIX = "The photo shows a dog on a beach"
MISSING_TAIL = " with a red frisbee in its mouth, mid-leap over the surf."
FULL_RESPONSE = STREAMED_PREFIX + MISSING_TAIL


class StalePrefixAgent:
    """Streams only a prefix; the completed response carries a longer tail.

    Models the #71643 incident shape: the tail generated between the last
    preview edit and stream completion never reaches the stream callback, so
    the consumer's successful finalize edit carries stale preview text while
    ``final_response`` holds the complete answer.
    """

    def __init__(self, **kwargs):
        self.stream_delta_callback = kwargs.get("stream_delta_callback")
        self.tools = []

    def run_conversation(self, message, conversation_history=None, task_id=None):
        if self.stream_delta_callback:
            self.stream_delta_callback(STREAMED_PREFIX)
        return {
            "final_response": FULL_RESPONSE,
            "response_previewed": False,
            "messages": [],
            "api_calls": 1,
        }


class CompleteStreamAgent:
    """Control: the streamed text exactly equals the final response."""

    def __init__(self, **kwargs):
        self.stream_delta_callback = kwargs.get("stream_delta_callback")
        self.tools = []

    def run_conversation(self, message, conversation_history=None, task_id=None):
        if self.stream_delta_callback:
            self.stream_delta_callback(FULL_RESPONSE)
        return {
            "final_response": FULL_RESPONSE,
            "response_previewed": False,
            "messages": [],
            "api_calls": 1,
        }


def _make_runner(adapter):
    gateway_run = importlib.import_module("gateway.run")
    runner = object.__new__(gateway_run.GatewayRunner)
    runner.adapters = {adapter.platform: adapter}
    runner._voice_mode = {}
    runner._prefill_messages = []
    runner._ephemeral_system_prompt = ""
    runner._reasoning_config = None
    runner._provider_routing = {}
    runner._fallback_model = None
    runner._session_db = None
    runner._running_agents = {}
    runner._session_run_generation = {}
    runner.session_store = SimpleNamespace(_entries={}, _save=lambda: None)
    runner.hooks = SimpleNamespace(loaded_hooks=False)
    runner.config = SimpleNamespace(
        thread_sessions_per_user=False,
        group_sessions_per_user=False,
        stt_enabled=False,
        streaming=StreamingConfig.from_dict(
            {"enabled": True, "edit_interval": 0.01, "buffer_threshold": 1}
        ),
    )
    return runner


async def _run_streaming_turn(monkeypatch, tmp_path, agent_cls, session_id):
    import scout_yaml as yaml

    (tmp_path / "config.yaml").write_text(
        yaml.safe_dump(
            {
                "display": {"tool_progress": "off", "interim_assistant_messages": False},
                "streaming": {
                    "enabled": True,
                    "edit_interval": 0.01,
                    "buffer_threshold": 1,
                },
            }
        ),
        encoding="utf-8",
    )

    fake_dotenv = types.ModuleType("dotenv")
    fake_dotenv.load_dotenv = lambda *args, **kwargs: None
    monkeypatch.setitem(sys.modules, "dotenv", fake_dotenv)

    fake_run_agent = types.ModuleType("run_agent")
    fake_run_agent.AIAgent = agent_cls
    monkeypatch.setitem(sys.modules, "run_agent", fake_run_agent)

    adapter = FinalizeCaptureAdapter()
    runner = _make_runner(adapter)
    gateway_run = importlib.import_module("gateway.run")
    monkeypatch.setattr(gateway_run, "_scout_home", tmp_path)
    monkeypatch.setattr(
        gateway_run, "_resolve_runtime_agent_kwargs", lambda: {"api_key": "***"}
    )

    source = SessionSource(
        platform=Platform.HOMEASSISTANT,
        chat_id="-1001",
        chat_type="group",
    )
    result = await runner._run_agent(
        message="describe this photo",
        context_prompt="",
        history=[],
        source=source,
        session_id=session_id,
        session_key="agent:main:telegram:group:-1001",
    )
    return adapter, result


# ---------------------------------------------------------------------------
# Gateway-boundary regression (#71643)
# ---------------------------------------------------------------------------






class _PayloadLessSplitConsumer(GatewayStreamConsumer):
    """Force the #78541 shape after a normal stream drain.

    Claims final delivery via the multi-message split path but leaves no
    recorded payload — the pre-fix gateway treated matcher ``None`` as
    legacy trust and swallowed the complete ``final_response``.
    """

    async def run(self):
        await super().run()
        self._final_response_sent = True
        self._final_content_delivered = True
        self._turn_split_delivery = True
        self._delivered_final_text = None
        self._stream_ledger = ""




# ---------------------------------------------------------------------------
# Consumer unit coverage: delivered_final_matches tri-state
# ---------------------------------------------------------------------------


def _consumer():
    adapter = FinalizeCaptureAdapter()
    return GatewayStreamConsumer(
        adapter, "chat-1", StreamConsumerConfig(cursor=" ▉")
    )


class TestDeliveredFinalMatches:
    def test_no_record_no_visible_text_returns_false(self):
        """#95382 tightening: a record-less consumer with no visible match
        for the final text is a demonstrable non-delivery, not legacy trust."""
        consumer = _consumer()
        assert consumer.delivered_final_matches("anything") is False

    def test_no_record_but_visible_final_returns_true(self):
        """Ambiguous-dedup control: visible text equals the final answer."""
        consumer = _consumer()
        consumer._already_sent = True
        consumer._last_sent_text = FULL_RESPONSE
        assert consumer.delivered_final_matches(FULL_RESPONSE) is True

    def test_no_record_ambiguous_timeout_returns_none(self):
        """The explicitly-marked ambiguous timeout keeps legacy trust."""
        consumer = _consumer()
        consumer._delivery_ambiguous = True
        assert consumer.delivered_final_matches("anything") is None

    def test_matching_record_returns_true(self):
        consumer = _consumer()
        consumer._record_turn_final_payload(FULL_RESPONSE)
        assert consumer.delivered_final_matches(FULL_RESPONSE) is True

    def test_stale_prefix_record_returns_false(self):
        consumer = _consumer()
        consumer._record_turn_final_payload(STREAMED_PREFIX)
        assert consumer.delivered_final_matches(FULL_RESPONSE) is False

    def test_payload_less_split_delivery_returns_false(self):
        """#78541 — payload-less split must not inherit legacy trust."""
        consumer = _consumer()
        consumer._turn_split_delivery = True
        consumer._delivered_final_text = None
        assert consumer.delivered_final_matches(FULL_RESPONSE) is False

    def test_split_delivery_with_matching_ledger_returns_true(self):
        """Complete overflow split that recorded its ledger still suppresses."""
        consumer = _consumer()
        consumer._turn_split_delivery = True
        consumer._stream_ledger = FULL_RESPONSE
        consumer._record_turn_final_payload(STREAMED_PREFIX)  # tail only; ledger wins
        assert consumer.delivered_final_matches(FULL_RESPONSE) is True

    def test_split_delivery_with_stale_ledger_returns_false(self):
        consumer = _consumer()
        consumer._turn_split_delivery = True
        consumer._stream_ledger = STREAMED_PREFIX
        consumer._record_turn_final_payload(STREAMED_PREFIX)
        assert consumer.delivered_final_matches(FULL_RESPONSE) is False

    def test_empty_final_text_returns_none(self):
        consumer = _consumer()
        consumer._record_turn_final_payload(STREAMED_PREFIX)
        assert consumer.delivered_final_matches("") is None

    def test_segment_delivered_text_still_matches(self):
        consumer = _consumer()
        consumer._record_turn_final_payload(STREAMED_PREFIX)
        # A prior segment delivered the exact final text.
        consumer._delivered_segment_texts.append(FULL_RESPONSE)
        assert consumer.delivered_final_matches(FULL_RESPONSE) is True

    def test_reset_segment_state_clears_record(self):
        consumer = _consumer()
        consumer._record_turn_final_payload(STREAMED_PREFIX)
        consumer._reset_segment_state()
        assert consumer._delivered_final_text is None
        assert consumer._turn_split_delivery is False
        assert consumer._stream_ledger == ""


# ---------------------------------------------------------------------------
# End-to-end split delivery: drive the real overflow-split loop (no hand-set
# private flags) and assert the no-duplicate / no-swallow contract on both
# sides.  These are the shapes that #78541's boundary fix has to not regress:
# a genuine complete split must still suppress, and an incomplete one must not.
# ---------------------------------------------------------------------------


class _SplittingAdapter(FinalizeCaptureAdapter):
    """Small message cap so real prose trips the consumer's overflow split.

    Also records deletions and can be told to fail edits, so the fresh-final
    and flood-control paths can be driven without patching internals.
    """

    MAX_MESSAGE_LENGTH = 220

    def __init__(self, platform=Platform.HOMEASSISTANT):
        super().__init__(platform)
        self.deleted = []
        self.fail_edits = False

    async def edit_message(
        self, chat_id, message_id, content, *, finalize: bool = False, metadata=None
    ) -> SendResult:
        if self.fail_edits:
            return SendResult(
                success=False, error="Flood control exceeded. Retry in 12 seconds"
            )
        return await super().edit_message(
            chat_id, message_id, content, finalize=finalize, metadata=metadata
        )

    async def delete_message(self, chat_id, message_id) -> bool:
        self.deleted.append(message_id)
        return True

    def truncate_message(self, text, limit, len_fn=len):
        chunks, rest = [], text
        while len_fn(rest) > limit:
            cut = rest.rfind("\n", 0, limit)
            if cut < limit // 2:
                cut = limit
            chunks.append(rest[:cut])
            rest = rest[cut:].lstrip("\n")
        chunks.append(rest)
        return chunks


def _split_consumer():
    adapter = _SplittingAdapter()
    consumer = GatewayStreamConsumer(
        adapter,
        "chat-split",
        StreamConsumerConfig(
            edit_interval=0.0, buffer_threshold=1, cursor="",
            fresh_final_after_seconds=0.0,
        ),
    )
    return adapter, consumer


async def _drain_split_turn(consumer, lines):
    task = asyncio.create_task(consumer.run())
    for line in lines:
        consumer.on_delta(line + "\n")
        await asyncio.sleep(0.005)
    consumer.finish()
    await asyncio.wait_for(task, timeout=10)












@pytest.mark.asyncio
async def test_flood_retry_never_resends_full_payload_after_partial_split_delivery(monkeypatch):
    """A short-wait flood result that carries ``partial_overflow`` means the head of a split
    payload is already on screen: the fallback flood retry must NOT sleep and re-send the whole
    content (that duplicates the head); it returns the partial failure to the caller."""
    consumer = _consumer()
    calls: list[str] = []

    async def partial_flood_send(chat_id, content, reply_to=None, metadata=None):
        calls.append(content)
        return SendResult(
            success=False, error="Flood control exceeded. Retry after 2 seconds",
            raw_response={"partial_overflow": True, "delivered_chunks": 1, "total_chunks": 3},
        )

    monkeypatch.setattr(consumer.adapter, "send", partial_flood_send)
    monkeypatch.setattr(consumer, "_fallback_flood_retry_delay", lambda result: 0.0)
    slept: list[float] = []

    async def fake_sleep(delay):
        slept.append(delay)

    monkeypatch.setattr(asyncio, "sleep", fake_sleep)

    result = await consumer._send_with_flood_retry(content="HEAD TAIL", retry_log="retry %.1fs")

    assert result.success is False and result.raw_response["partial_overflow"] is True
    assert calls == ["HEAD TAIL"], f"full payload re-sent after partial delivery: {calls}"
    assert slept == []
