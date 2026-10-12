"""Tests for agent.conversation_scope — the ambient conversation/affinity scope."""

from __future__ import annotations


# ── Ambient conversation context (ContextVar) ────────────────────────────────


def test_ambient_context_set_none_clears():
    """set_conversation_context(None) publishes no conversation (and coerces '')."""
    from agent.conversation_scope import (
        get_conversation_context,
        reset_conversation_context,
        set_conversation_context,
    )

    for empty in (None, ""):
        token = set_conversation_context(empty)
        try:
            assert get_conversation_context() is None
        finally:
            reset_conversation_context(token)


def test_ambient_context_isolated_between_contexts():
    """Two copied Contexts (≈ two concurrent agents) don't leak into each other."""
    import contextvars

    from agent.conversation_scope import get_conversation_context, set_conversation_context

    def _in_conversation(cid):
        set_conversation_context(cid)
        return get_conversation_context()

    assert contextvars.copy_context().run(_in_conversation, "agent-a") == "agent-a"
    assert contextvars.copy_context().run(_in_conversation, "agent-b") == "agent-b"
    # The outer (test) context stays clean.
    assert get_conversation_context() is None


def test_ambient_context_propagates_via_thread_context_helper():
    """propagate_context_to_thread carries the conversation onto executor workers (MoA path)."""
    from concurrent.futures import ThreadPoolExecutor

    from agent.conversation_scope import (
        get_conversation_context,
        reset_conversation_context,
        set_conversation_context,
    )
    from tools.thread_context import propagate_context_to_thread

    token = set_conversation_context("moa-root")
    try:
        with ThreadPoolExecutor(max_workers=1) as ex:
            plain = ex.submit(get_conversation_context).result()
            propagated = ex.submit(propagate_context_to_thread(get_conversation_context)).result()
    finally:
        reset_conversation_context(token)

    # Bare submit loses the ContextVar; the propagation wrapper keeps it.
    assert plain is None
    assert propagated == "moa-root"


def test_compress_context_preserves_ambient_context(monkeypatch):
    """In-turn compaction inherits the turn's root and restores it untouched."""
    import agent.conversation_compression as cc
    from agent.conversation_scope import (
        get_conversation_context,
        reset_conversation_context,
        set_conversation_context,
    )
    from run_agent import AIAgent

    seen = {}

    def _fake_compress(agent, messages, system_message, **kwargs):
        seen["conversation"] = get_conversation_context()
        return ([], "")

    monkeypatch.setattr(cc, "compress_context", _fake_compress)

    class _Agent:
        def _conversation_root_id(self):
            # A rotated segment id must never win over the ambient root.
            return "segment-after-compaction"

    token = set_conversation_context("outer-root")
    try:
        AIAgent._compress_context(_Agent(), [], "sys")
        assert seen["conversation"] == "outer-root"
        assert get_conversation_context() == "outer-root"
    finally:
        reset_conversation_context(token)
