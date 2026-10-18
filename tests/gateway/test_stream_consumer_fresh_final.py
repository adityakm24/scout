"""Regression tests for the fresh-final-for-long-lived-previews path.

Ported from openclaw/openclaw#72038.  When a streamed preview has been
visible long enough that the platform's edit timestamp would be
noticeably stale by completion time, the stream consumer delivers the
final reply as a brand-new message and best-effort deletes the old
preview.  This makes Telegram's visible timestamp reflect completion
time instead of first-token time.
"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from gateway.stream_consumer import GatewayStreamConsumer, StreamConsumerConfig

def _make_adapter(*, supports_delete: bool = True) -> MagicMock:
    """Build a minimal MagicMock adapter wired for send/edit/delete."""
    adapter = MagicMock()
    adapter.REQUIRES_EDIT_FINALIZE = False
    adapter.MAX_MESSAGE_LENGTH = 4096
    adapter.send = AsyncMock(return_value=SimpleNamespace(
        success=True, message_id="initial_preview",
    ))
    adapter.edit_message = AsyncMock(return_value=SimpleNamespace(
        success=True, message_id="initial_preview",
    ))
    if supports_delete:
        adapter.delete_message = AsyncMock(return_value=True)
    else:
        # Adapter without the optional delete_message method — fresh-final
        # should still work, it just leaves the stale preview in place.
        del adapter.delete_message  # type: ignore[attr-defined]
    return adapter




class TestGotDoneOverflowSplitNotRefinalized:
    """A got_done finalize edit that split-and-delivered across continuation
    messages must not be followed by the redundant requires-finalize edit.

    After a split, the consumer adopts the last continuation as the live
    message and the redundant finalize edit re-submits the FULL accumulated
    text against it; the adapter pre-flights that into another overflow
    split, editing chunk 1 over the continuation and re-sending the rest,
    so the user sees duplicated chunks. The finalize signal was already
    carried by the split edit itself.
    """

    def _consumer(self, adapter):
        # High interval/threshold so the only edit is the got_done finalize.
        return GatewayStreamConsumer(
            adapter=adapter,
            chat_id="chat",
            config=StreamConsumerConfig(
                edit_interval=10.0, buffer_threshold=10_000, cursor=" ▉",
            ),
        )

    @pytest.mark.asyncio
    async def test_non_split_finalize_edit_still_gets_explicit_refinalize(self):
        """The narrow fix must not regress the requires-finalize contract:
        a normal (non-split) got_done edit is still followed by the
        explicit finalize edit (#25010 semantics unchanged)."""
        adapter = _make_adapter()
        adapter.REQUIRES_EDIT_FINALIZE = True
        adapter.edit_message = AsyncMock(return_value=SimpleNamespace(
            success=True, message_id="initial_preview",
        ))
        consumer = self._consumer(adapter)
        consumer.on_delta("short final reply")
        task = asyncio.create_task(consumer.run())
        await asyncio.sleep(0.05)
        consumer.finish()
        await task

        finalize_edits = [
            c for c in adapter.edit_message.call_args_list
            if c.kwargs.get("finalize")
        ]
        assert len(finalize_edits) == 2
        assert consumer.final_response_sent is True

class TestFinalCleanupEditFloodControl:
    """Regression for duplicate final sends when the cursor-strip edit fails."""

    @pytest.mark.asyncio
    async def test_failed_final_cleanup_edit_marks_visible_content_delivered(self):
        adapter = _make_adapter()
        adapter.edit_message = AsyncMock(return_value=SimpleNamespace(
            success=False,
            error="Flood control exceeded. Retry in 12 seconds",
        ))
        consumer = GatewayStreamConsumer(
            adapter=adapter,
            chat_id="chat",
            config=StreamConsumerConfig(
                edit_interval=0.01, buffer_threshold=5, cursor=" ▉",
            ),
        )

        final_text = "The complete answer is already visible before cleanup."
        consumer.on_delta(final_text)
        task = asyncio.create_task(consumer.run())
        await asyncio.sleep(0.05)  # streaming preview lands with cursor
        assert consumer._last_sent_text == f"{final_text} ▉"

        consumer.finish()
        await task

        # The final cosmetic edit failed, so final_response_sent stays false;
        # the important signal is that content_delivered suppresses the
        # gateway's normal full final send and prevents a duplicate answer.
        assert consumer.final_response_sent is False
        assert consumer.final_content_delivered is True
        assert adapter.send.call_count == 1
        assert adapter.edit_message.call_count >= 1

