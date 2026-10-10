"""Memory saved during a chat reaches that chat on its next message.

The system prompt carries MEMORY.md / USER.md as they were when the chat began (prompt caching);
an entry the background review or the desktop panel saves afterwards rides in once as a note.
"""
from types import SimpleNamespace

from agent.memory_note import take_memory_update_note
from tools import memory_tool
from tools.memory_tool_store import MemoryStore


def test_a_memory_saved_mid_chat_is_told_once(tmp_path, monkeypatch):
    monkeypatch.setattr(memory_tool, "get_memory_dir", lambda: tmp_path)
    (tmp_path / "USER.md").write_text("Prefers short replies.")
    store = MemoryStore()
    store.load_from_disk()
    agent = SimpleNamespace(_memory_store=store, _cached_system_prompt="built",
                            _memory_enabled=True, _user_profile_enabled=True)

    assert take_memory_update_note(agent) == ""  # nothing changed since the prompt was built

    MemoryStore._write_file(tmp_path / "USER.md", ["Prefers short replies.", "Shops on Zepto."])
    note = take_memory_update_note(agent)
    assert "Shops on Zepto." in note and "Prefers short replies." in note
    assert take_memory_update_note(agent) == ""  # told once


def test_no_note_before_the_prompt_exists(tmp_path, monkeypatch):
    monkeypatch.setattr(memory_tool, "get_memory_dir", lambda: tmp_path)
    store = MemoryStore()
    store.load_from_disk()
    MemoryStore._write_file(tmp_path / "MEMORY.md", ["Project Scout lives in ~/Documents."])
    agent = SimpleNamespace(_memory_store=store, _cached_system_prompt=None,
                            _memory_enabled=True, _user_profile_enabled=True)
    assert take_memory_update_note(agent) == ""
