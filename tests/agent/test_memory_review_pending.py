"""A memory review that comes due is not lost.

The review fired only on the exact turn the counter reached ``memory.nudge_interval``: if that turn
ended interrupted or without a reply, or another review was still running, the review was dropped
and the counter restarted — so a user's MEMORY.md / USER.md stayed empty for good.
"""
from types import SimpleNamespace

from agent.turn_context import _tick_memory_nudge


def _agent():
    return SimpleNamespace(_memory_nudge_interval=3, valid_tool_names={"memory"}, _memory_store=object(),
                           _turns_since_memory=0, _memory_review_pending=False)


def test_a_due_review_stays_due_until_one_starts():
    agent = _agent()
    assert [_tick_memory_nudge(agent) for _ in range(3)] == [False, False, True]
    # The turn it came due on didn't spawn a review (interrupted, no reply, another review busy).
    assert _tick_memory_nudge(agent) is True
    agent._memory_review_pending = False  # what starting the review does
    assert [_tick_memory_nudge(agent) for _ in range(3)] == [False, False, True]


def test_no_review_when_memory_is_unavailable():
    agent = _agent()
    agent.valid_tool_names = set()
    assert not any(_tick_memory_nudge(agent) for _ in range(5))


def test_a_message_worth_remembering_makes_the_review_due_at_once():
    agent = _agent()
    assert _tick_memory_nudge(agent, "what's the weather like?") is False
    assert _tick_memory_nudge(agent, "I'm vegetarian, and from now on keep replies short") is True
    # Multimodal messages carry their text in parts.
    agent._memory_review_pending = False
    assert _tick_memory_nudge(agent, [{"type": "text", "text": "my sister lives in Pune"}]) is True
