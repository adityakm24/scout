"""A skill named like a built-in command is kept out of auto-registration (the 370ebf2d3 guard)
and every listing surface says so where the user looks: the ``/skills`` table, ``/help skills``
and the ``commands.catalog`` palette RPC. A non-colliding skill carries no note."""
from __future__ import annotations

import contextlib
import io

from rich.console import Console

from scout_constants import get_scout_home

NOTE = "slash command /handoff unavailable — name taken by built-in; use /skill handoff"


def _write_skill(name: str) -> None:
    skill_dir = get_scout_home() / "skills" / name
    skill_dir.mkdir(parents=True)
    (skill_dir / "SKILL.md").write_text(f"---\nname: {name}\ndescription: {name} skill.\n---\n# {name}\n", encoding="utf-8")




def test_catalog_discovery_failure_warning_outranks_the_collision_note(monkeypatch):
    """A colliding skill must not hide a real discovery failure: the failure stays in ``warning``."""
    import tools.skills_tool as skills_tool
    from tui_gateway import server

    _write_skill("handoff")
    _write_skill("tidy-notes")  # control: skills still list when a loader failed
    monkeypatch.setattr(skills_tool, "_SKILLS_CACHE", {})

    def _broken_cfg():
        raise RuntimeError("config.yaml unreadable")

    monkeypatch.setattr(server, "_load_cfg", _broken_cfg)

    catalog = server._methods["commands.catalog"](1, {})["result"]
    assert catalog["warning"] == "quick_commands discovery unavailable: config.yaml unreadable"
    assert "/tidy-notes" in catalog["skills"]
