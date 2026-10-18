"""Gateway ``/model <m> --reasoning <level>``: the effort rides with the pick through the same
applier ``/reasoning`` uses (session override by default, ``agent.reasoning_effort`` on --global)."""

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from gateway.config import Platform
from gateway.slash_commands_model import _ModelSwitchContext


def _runner():
    from gateway.run import GatewayRunner

    runner = object.__new__(GatewayRunner)
    calls = {}
    runner._switch_cached_agent_model = lambda *_a, **_k: None
    runner._record_model_switch = AsyncMock(return_value=None)  # None = config write succeeded
    runner._model_switch_confirmation = AsyncMock(return_value="switched")
    runner._apply_reasoning_selection = (
        lambda session_key, platform_key, value, persist_global=False:
        calls.setdefault("applied", (session_key, platform_key, value, persist_global)) and "effort set")
    return runner, calls




@pytest.mark.asyncio
async def test_no_flag_and_once_leave_reasoning_untouched():
    runner, calls = _runner()
    source = SimpleNamespace(platform=Platform.HOMEASSISTANT)
    result = SimpleNamespace(new_model="m", target_provider="fixtureco")
    await runner._commit_model_switch(
        result, _ModelSwitchContext(session_key="k", source=None, config_path=None, persist_global=False),
        source=source)
    await runner._commit_model_switch(
        result, _ModelSwitchContext(session_key="k", source=None, config_path=None, persist_global=False,
                                    one_turn=True, reasoning_effort="high"),
        source=source)
    assert "applied" not in calls
