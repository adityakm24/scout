"""Memory saved during a chat reaches that chat on its next message.

MEMORY.md / USER.md enter the system prompt once, when the chat's prompt is built, and stay
byte-stable for the life of the conversation (prompt caching). Entries written afterwards — by the
background memory review, the agent itself, or the user in the desktop agent panel — would
otherwise only reach the next chat. Like a rename (``agent/identity.py``), the change rides in as a
one-time note on the next user message instead of rebuilding the prompt.
"""

from __future__ import annotations

from typing import Any

_TARGETS = (("memory", "_memory_enabled"), ("user", "_user_profile_enabled"))


def take_memory_update_note(agent: Any) -> str:
    """A note carrying the memory blocks that changed since this chat last saw them, or ``""``.

    The first comparison is against the store's load-time snapshot (what the system prompt holds);
    each note then becomes the new baseline, so every change is told exactly once. Before the
    prompt is built there is nothing to update — that build reads the files itself."""
    store = getattr(agent, "_memory_store", None)
    if store is None or getattr(agent, "_cached_system_prompt", None) is None:
        return ""
    seen = getattr(agent, "_memory_seen_blocks", None)
    if seen is None:
        seen = {target: store.format_for_system_prompt(target) or "" for target, _ in _TARGETS}
    current = dict(seen)
    for target, flag in _TARGETS:
        if getattr(agent, flag, True):
            try:
                current[target] = store.current_prompt_block(target)
            except OSError:
                pass
    agent._memory_seen_blocks = current
    changed = [target for target, _ in _TARGETS if current.get(target, "") != seen.get(target, "")]
    if not changed:
        return ""
    blocks = [current[t] or f"[{'USER PROFILE' if t == 'user' else 'MEMORY'} is now empty]" for t in changed]
    return ("[Your memory was updated during this chat. These blocks replace the ones shown at the "
            "start; use them from now on:]\n" + "\n\n".join(blocks))
