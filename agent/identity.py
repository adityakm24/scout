"""The agent's user-chosen name: one source (the profile's ``display_name`` in profile.yaml),
two deliveries. A session's system prompt states the name it was built with; a rename while
that session is open reaches the model as a one-time note on the next user message, so the
system prompt stays byte-stable (prompt caching) and the model still learns the new name."""

from __future__ import annotations

from pathlib import Path
from typing import Optional


def profile_display_name(home: Optional[Path]) -> str:
    """The name the user gave the agent of the profile at ``home``, or ``""`` when unset."""
    if home is None:
        return ""
    from scout_cli.profiles import read_profile_meta
    try:
        return read_profile_meta(Path(home)).get("display_name") or ""
    except Exception:
        return ""


def identity_name_line(name: str) -> str:
    """System-prompt line that names the agent; ``""`` when no name is set."""
    if not name:
        return ""
    return (f"Your name is {name}. Use it when you introduce yourself or are asked who you are; "
            "it replaces any other name for you above.")


def rename_note(previous: Optional[str], current: str) -> str:
    """One-time note for the next user message after a rename, or ``""`` when nothing changed.
    ``previous`` is the name the model last heard (``None`` = unknown, e.g. a session whose system
    prompt was replayed from storage), in which case a set name is restated once."""
    if previous == current or (previous is None and not current):
        return ""
    if current and previous is None:
        return f"[Your name is {current}.]"
    if current:
        return f"[The user renamed you: your name is now {current}. Use this name from now on.]"
    return "[The user removed your custom name. Go back to the name your persona gives you.]"


def take_rename_note(agent) -> str:
    """The rename note owed to ``agent``'s next user message, or ``""``. Records the new name as
    heard, so each rename is announced exactly once. Before the session's system prompt exists
    the note is moot: that prompt is built this turn and states the current name itself."""
    if getattr(agent, "_cached_system_prompt", None) is None:
        return ""
    from agent.system_prompt import _agent_home
    from scout_constants import get_scout_home
    current = profile_display_name(_agent_home(agent) or get_scout_home())
    note = rename_note(getattr(agent, "_identity_name", None), current)
    if note:
        agent._identity_name = current
    return note
