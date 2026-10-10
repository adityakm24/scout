"""An entry that mostly repeats one already saved is refused with a pointer to merge it.

Small models re-saved known preferences alongside each new fact, so USER.md filled with
near-copies ("Name: X. Prefers concise replies, ...") of the entry before it."""

import pytest

from tools.memory_tool import MemoryStore

KNOWN = ("User prefers concise replies. Prefers Zepto and Swiggy Instamart for grocery orders. "
         "Ignore bank transaction alerts in email updates.")
RESTATED = ("User's full name: Aditya Krishnan Mohan. Prefers concise replies, uses Zepto and "
            "Swiggy Instamart for grocery orders, and ignores bank transaction alerts in email updates.")


@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setattr("tools.memory_tool.get_memory_dir", lambda: tmp_path)
    s = MemoryStore()
    s.load_from_disk()
    s.reset_consolidation_failures()
    assert s.add("user", KNOWN)["success"]
    return s


@pytest.mark.parametrize("save", [
    lambda s: s.add("user", RESTATED),
    lambda s: s.apply_batch("user", [{"action": "add", "content": RESTATED}]),
], ids=["add", "batch"])
def test_restating_a_saved_entry_is_refused_and_names_it(store, save):
    result = save(store)

    assert result["success"] is False
    assert KNOWN in result["error"]
    assert store.user_entries == [KNOWN]


def test_a_new_fact_beside_a_saved_one_is_still_added(store):
    assert store.add("user", "User's full name: Aditya Krishnan Mohan.")["success"]
    assert store.add("user", "Orders groceries from Zepto every Sunday morning.")["success"]
    assert len(store.user_entries) == 3


def test_restating_a_profile_entry_in_the_other_store_is_refused_and_routed(store):
    result = store.add("memory", "User prefers concise replies. Prefers Zepto and Swiggy Instamart "
                                 "for grocery orders. Lives in Bangalore.")

    assert result["success"] is False
    assert "USER.md" in result["error"] and KNOWN in result["error"]
    assert store.memory_entries == []


@pytest.mark.parametrize("content, repeated", [
    ("Vegetarian by preference; Zepto is the go-to for grocery orders.", "Zepto is the go-to for grocery orders"),
    ("User is vegetarian and prefers Zepto for grocery orders.", "prefers Zepto for grocery orders"),
])
def test_a_new_fact_carrying_a_repeated_clause_is_refused_naming_that_clause(store, content, repeated):
    result = store.add("user", content)

    assert result["success"] is False
    assert repeated in result["error"]
    assert store.add("user", "Vegetarian.")["success"]
