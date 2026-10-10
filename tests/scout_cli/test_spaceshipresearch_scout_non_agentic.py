"""Tests for the SpaceshipResearch-Scout-3/4 non-agentic warning detector.

Prior to this check, the warning fired on any model whose name contained
``"scout"`` anywhere (case-insensitive). That false-positived on unrelated
local Modelfiles such as ``scout-brain:qwen3-14b-ctx16k`` — a tool-capable
Qwen3 wrapper that happens to live under the "scout" tag namespace.

``is_spaceshipresearch_scout_non_agentic`` should only match the actual SpaceshipResearch
Scout-3 / Scout-4 chat family.
"""

from __future__ import annotations

import pytest

from scout_cli.model_switch import (
    _SCOUT_MODEL_WARNING,
    _check_scout_model_warning,
    is_spaceshipresearch_scout_non_agentic,
)


@pytest.mark.parametrize(
    "model_name",
    [
        "SpaceshipResearch/Scout-3-Llama-3.1-70B",
        "SpaceshipResearch/Scout-3-Llama-3.1-405B",
        "scout-3",
        "Scout-3",
        "scout-4",
        "scout-4-405b",
        "scout_4_70b",
        "openrouter/scout3:70b",
        "openrouter/spaceshipresearch/scout-4-405b",
        "SpaceshipResearch/Scout3",
        "scout-3.1",
    ],
)
def test_matches_real_spaceshipresearch_scout_chat_models(model_name: str) -> None:
    assert is_spaceshipresearch_scout_non_agentic(model_name), (
        f"expected {model_name!r} to be flagged as SpaceshipResearch Scout 3/4"
    )
    assert _check_scout_model_warning(model_name) == _SCOUT_MODEL_WARNING


