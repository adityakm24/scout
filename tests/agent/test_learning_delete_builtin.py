"""A built-in skill the user deletes stays deleted; an essential one cannot be deleted.

Deleting from the desktop/dashboard (``delete_node``) is the user's own request, so it may prune a
built-in without ``curator.prune_builtins`` — and the next bundled-skill sync must not bring it back.
"""

from __future__ import annotations

from pathlib import Path

import pytest


@pytest.fixture
def seeded_home(tmp_path, monkeypatch):
    home = tmp_path / ".scout"
    home.mkdir()
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    monkeypatch.setenv("SCOUT_HOME", str(home))

    bundled = tmp_path / "bundled"
    for category, name in [("autonomous-ai-agents", "scout-agent"), ("productivity", "maps")]:
        skill = bundled / category / name
        skill.mkdir(parents=True)
        (skill / "SKILL.md").write_text(f"---\nname: {name}\ndescription: x\n---\nbody\n", encoding="utf-8")

    import tools.skill_usage as usage
    import tools.skills_sync as sync

    monkeypatch.setattr(sync, "_get_bundled_dir", lambda: bundled)
    monkeypatch.setattr(sync, "_build_external_skill_index", lambda: set())
    monkeypatch.setattr(usage, "_prune_builtins_enabled", lambda: False)
    sync.sync_skills(quiet=True)
    return home, sync


def _active(home: Path, name: str) -> bool:
    return any(p.parent.name == name for p in (home / "skills").rglob("SKILL.md") if ".archive" not in p.parts)


def test_a_deleted_builtin_is_not_reseeded(seeded_home):
    from agent.learning_mutations import delete_node

    home, sync = seeded_home
    assert _active(home, "maps")

    assert delete_node("maps")["ok"] is True
    sync.sync_skills(quiet=True)

    assert not _active(home, "maps")


def test_a_deleted_builtin_can_be_restored_by_the_user(seeded_home):
    from agent.learning_mutations import delete_node
    from tools.skill_usage import restore_skill

    home, sync = seeded_home
    delete_node("maps")

    assert restore_skill("maps", by_user=True)[0] is True
    sync.sync_skills(quiet=True)

    assert _active(home, "maps")


def test_an_essential_skill_cannot_be_deleted(seeded_home):
    from agent.learning_mutations import delete_node

    home, _sync = seeded_home

    assert delete_node("scout-agent")["ok"] is False
    assert _active(home, "scout-agent")
