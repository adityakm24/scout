"""Contract: a skill gated on a connector names a connector that ships in the MCP catalog.

A connector's tools register under the toolset ``mcp-<server name>``, and a skill declaring
``requires_toolsets: [mcp-<name>]`` is listed only while those tools are loaded. A typo, or a
connector renamed or dropped from ``optional-mcps/``, would hide the skill forever without
any error.
"""
from pathlib import Path

import scout_yaml as yaml

REPO = Path(__file__).resolve().parents[2]


def _connector_gates():
    for skill in sorted(REPO.glob("skills/**/SKILL.md")):
        text = skill.read_text(encoding="utf-8")
        frontmatter = yaml.safe_load(text.split("---", 2)[1]) or {}
        scout = (frontmatter.get("metadata") or {}).get("scout") or {}
        for toolset in scout.get("requires_toolsets") or []:
            if str(toolset).startswith("mcp-"):
                yield skill.parent.name, str(toolset)[len("mcp-"):]


def test_connector_gated_skills_name_a_catalog_connector():
    gates = list(_connector_gates())
    assert gates, "expected at least one connector-gated skill"
    missing = [
        f"{skill} -> mcp-{server}"
        for skill, server in gates
        if not (REPO / "optional-mcps" / server / "manifest.yaml").exists()
    ]
    assert not missing, "skills gated on connectors that are not in optional-mcps/:\n" + "\n".join(missing)
