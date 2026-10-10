"""Regression tests for ``close_interrupted_tool_sequence`` (#48879 follow-up).

#48879 closed the tool-call sequence on interrupt inside ``finalize_turn``,
but the retry/backoff/error interrupt aborts in ``conversation_loop`` ``return``
early and never reach it — so they persisted a raw ``tool`` tail. The next user
message then lands as ``... tool → user``, the role-alternation violation that
makes strict providers (Gemini, Claude) hallucinate a continuation and ignore
prior context (what the user perceives as "lost context").

The fix routes every interrupt abort through this one shared helper. These tests
pin the helper's contract and prove the post-interrupt + next-user-message
transcript is alternation-safe.
"""

from agent.message_sanitization import close_interrupted_tool_sequence


def _tool_tail():
    return [
        {"role": "user", "content": "edit the file"},
        {
            "role": "assistant",
            "content": "",
            "tool_calls": [{"id": "c1", "function": {"name": "patch", "arguments": "{}"}}],
        },
        {"role": "tool", "tool_call_id": "c1", "content": "ok edited"},
    ]


def _assert_no_tool_then_user(messages):
    for i in range(len(messages) - 1):
        if messages[i].get("role") == "tool":
            assert messages[i + 1].get("role") != "user", (
                f"role-alternation violation: tool → user at index {i}"
            )








def test_closing_makes_next_user_message_alternation_safe():
    """The whole point: appending a user turn after the close must not
    produce the ``tool → user`` shape strict providers choke on."""
    messages = _tool_tail()
    close_interrupted_tool_sequence(messages, None)
    assert isinstance(messages[-1]["timestamp"], float)
    follow_on = messages + [{"role": "user", "content": "they do! increase the timing"}]
    _assert_no_tool_then_user(follow_on)


def test_interrupt_reason_is_replayed_but_never_painted():
    """A stopped turn's reason ("Operation interrupted: waiting for model response (1.2s
    elapsed).") reached the reopened chat as the agent's reply. The model still sees it; the
    transcript does not."""
    from tui_gateway.server import _history_to_messages  # server.py-bound

    reason = "Operation interrupted: waiting for model response (1.2s elapsed)."
    messages = _tool_tail()
    close_interrupted_tool_sequence(messages, reason, reason_only=True)

    assert messages[-1]["api_content"] == reason
    painted = [m.get("text") or m.get("content") for m in _history_to_messages(messages)]
    assert not any(reason in str(text) for text in painted)
    # Rows persisted before the reason was hidden are not painted either, on either history read.
    from scout_cli.web_routers.sessions import _project_for_display

    legacy = _tool_tail() + [{"role": "assistant", "content": reason}]
    assert not any(reason in str(m) for m in _history_to_messages(legacy))
    assert _project_for_display(legacy)[-1]["display_kind"] == "hidden"
    # A reply that merely mentions an interruption is still a reply.
    reply = {"role": "assistant", "content": "Operation interrupted earlier, so I re-ran it.\nAll done."}
    assert not _project_for_display([reply])[-1].get("display_kind")


def test_assistant_tail_is_left_untouched():
    messages = [
        {"role": "user", "content": "hi"},
        {"role": "assistant", "content": "partial reply"},
    ]
    before = [dict(m) for m in messages]
    assert close_interrupted_tool_sequence(messages, "interrupted") is False
    assert messages == before


def test_user_tail_is_left_untouched():
    messages = [{"role": "user", "content": "hi"}]
    assert close_interrupted_tool_sequence(messages, None) is False
    assert len(messages) == 1

