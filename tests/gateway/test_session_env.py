import asyncio
import os

import pytest

from gateway.config import Platform
from gateway.run import GatewayRunner
from gateway.session import SessionContext, SessionSource
from gateway.session_context import (
    get_session_env,
    set_session_vars,
    clear_session_vars,
    reset_session_vars,
    _VAR_MAP,
    _UNSET,
)


@pytest.fixture(autouse=True)
def _reset_contextvars():
    """Reset all session contextvars to _UNSET between tests.

    In production each asyncio.Task gets a fresh context copy where the
    defaults are _UNSET.  In tests all functions share the same thread
    context, so a clear_session_vars() from test A (which sets vars to "")
    would leak into test B.  This fixture ensures each test starts clean.
    """
    yield
    for var in _VAR_MAP.values():
        # Can't use var.reset() without a token; just set back to sentinel.
        var.set(_UNSET)






def test_get_session_env_falls_back_to_os_environ(monkeypatch):
    """get_session_env should fall back to os.environ when contextvar is unset."""
    monkeypatch.setenv("SCOUT_SESSION_PLATFORM", "webhook")

    # No contextvar set — should read from os.environ
    assert get_session_env("SCOUT_SESSION_PLATFORM") == "webhook"

    # Now set a contextvar — should prefer it
    tokens = set_session_vars(platform="homeassistant")
    assert get_session_env("SCOUT_SESSION_PLATFORM") == "homeassistant"

    # After clear — should return "" (explicitly cleared), NOT fall back
    # to os.environ.  This is the fix for #10304: stale os.environ values
    # must not leak through after a gateway session is cleaned up.
    clear_session_vars(tokens)
    assert get_session_env("SCOUT_SESSION_PLATFORM") == ""


# ---------------------------------------------------------------------------
# SESSION_KEY contextvars tests
# ---------------------------------------------------------------------------


def test_session_key_falls_back_to_os_environ(monkeypatch):
    """get_session_env for SESSION_KEY should fall back to os.environ."""
    monkeypatch.setenv("SCOUT_SESSION_KEY", "env-session-123")

    # No contextvar set — should read from os.environ
    assert get_session_env("SCOUT_SESSION_KEY") == "env-session-123"

    # Set contextvar — should prefer it
    tokens = set_session_vars(session_key="ctx-session-456")
    assert get_session_env("SCOUT_SESSION_KEY") == "ctx-session-456"

    # After clear — should return "" (explicitly cleared), not os.environ (#10304)
    clear_session_vars(tokens)
    assert get_session_env("SCOUT_SESSION_KEY") == ""


def test_session_key_no_race_condition_with_contextvars(monkeypatch):
    """Prove contextvars isolates SESSION_KEY across concurrent async tasks.

    Two tasks set different session keys. With contextvars each task
    reads back its own value. With os.environ the second task would
    overwrite the first (the old bug).
    """
    monkeypatch.delenv("SCOUT_SESSION_KEY", raising=False)

    results = {}

    async def handler(key: str, delay: float):
        tokens = set_session_vars(session_key=key)
        try:
            await asyncio.sleep(delay)
            read_back = get_session_env("SCOUT_SESSION_KEY")
            results[key] = read_back
        finally:
            clear_session_vars(tokens)

    async def run():
        task_a = asyncio.create_task(handler("session-A", 0.15))
        await asyncio.sleep(0.05)
        task_b = asyncio.create_task(handler("session-B", 0.05))
        await asyncio.gather(task_a, task_b)

    asyncio.run(run())

    # Both tasks must read back their own session key
    assert results["session-A"] == "session-A", (
        f"Session A got '{results['session-A']}' instead of 'session-A' — race condition!"
    )
    assert results["session-B"] == "session-B", (
        f"Session B got '{results['session-B']}' instead of 'session-B' — race condition!"
    )


@pytest.mark.asyncio
async def test_run_in_executor_with_context_preserves_session_env(monkeypatch):
    """Gateway executor work should inherit session contextvars for tool routing."""
    runner = object.__new__(GatewayRunner)
    monkeypatch.delenv("SCOUT_SESSION_PLATFORM", raising=False)
    monkeypatch.delenv("SCOUT_SESSION_CHAT_ID", raising=False)
    monkeypatch.delenv("SCOUT_SESSION_THREAD_ID", raising=False)
    monkeypatch.delenv("SCOUT_SESSION_USER_ID", raising=False)

    source = SessionSource(
        platform=Platform.HOMEASSISTANT,
        chat_id="2144471399",
        chat_type="dm",
        user_id="123456",
        user_name="alice",
        thread_id=None,
    )
    context = SessionContext(
        source=source,
        connected_platforms=[],
        home_channels={},
        session_key="agent:main:homeassistant:dm:2144471399",
    )

    tokens = runner._set_session_env(context)
    try:
        result = await runner._run_in_executor_with_context(
            lambda: {
                "platform": get_session_env("SCOUT_SESSION_PLATFORM"),
                "chat_id": get_session_env("SCOUT_SESSION_CHAT_ID"),
                "user_id": get_session_env("SCOUT_SESSION_USER_ID"),
                "session_key": get_session_env("SCOUT_SESSION_KEY"),
            }
        )
    finally:
        runner._clear_session_env(tokens)
        runner._shutdown_executor()

    assert result == {
        "platform": "homeassistant",
        "chat_id": "2144471399",
        "user_id": "123456",
        "session_key": "agent:main:homeassistant:dm:2144471399",
    }




def test_cron_session_contextvar_preserves_legacy_env_fallback(monkeypatch):
    """Unset cron ContextVar keeps old env-only cron callers working."""
    monkeypatch.setenv("SCOUT_CRON_SESSION", "1")

    assert get_session_env("SCOUT_CRON_SESSION") == "1"


def test_cron_session_explicit_blank_masks_leaked_env(monkeypatch):
    """Non-cron session bindings must override a stale process cron env flag."""
    monkeypatch.setenv("SCOUT_CRON_SESSION", "1")

    tokens = set_session_vars(platform="api_server", cron_session="")
    try:
        assert get_session_env("SCOUT_CRON_SESSION") == ""
    finally:
        clear_session_vars(tokens)

    assert get_session_env("SCOUT_CRON_SESSION") == ""


def test_cron_session_set_clear_and_reset_tristate(monkeypatch):
    """Cron marker supports _UNSET fallback, 1 cron, and  explicit clear."""
    monkeypatch.setenv("SCOUT_CRON_SESSION", "1")

    tokens = set_session_vars(cron_session="1")
    assert get_session_env("SCOUT_CRON_SESSION") == "1"

    clear_session_vars(tokens)
    assert get_session_env("SCOUT_CRON_SESSION") == ""

    reset_session_vars()
    assert get_session_env("SCOUT_CRON_SESSION") == "1"


@pytest.mark.asyncio
async def test_plugin_slash_command_sees_session_env(monkeypatch):
    """A plugin-registered slash command handler must see the same SCOUT_SESSION_*
    contextvars an agent turn would for that event (#108698): the agent-turn path binds
    them via _set_session_env before running, but plugin command dispatch is a separate,
    earlier path that previously called the handler with nothing bound."""
    from gateway.config import GatewayConfig, PlatformConfig
    from gateway.platforms.event import MessageEvent

    monkeypatch.delenv("SCOUT_SESSION_KEY", raising=False)
    monkeypatch.delenv("SCOUT_SESSION_CHAT_ID", raising=False)

    runner = object.__new__(GatewayRunner)
    runner.config = GatewayConfig(platforms={Platform.HOMEASSISTANT: PlatformConfig(enabled=True, token="***")})
    runner._draining = False

    source = SessionSource(
        platform=Platform.HOMEASSISTANT, chat_id="c1", user_id="u1", user_name="tester", chat_type="dm",
    )
    event = MessageEvent(text="/gsd bind", source=source, message_id="m1")

    seen = {}

    def _handler(raw_args):
        seen["session_key"] = get_session_env("SCOUT_SESSION_KEY")
        seen["chat_id"] = get_session_env("SCOUT_SESSION_CHAT_ID")
        return f"Bound: {raw_args}"

    from scout_cli import plugins as _plugins_mod
    monkeypatch.setattr(_plugins_mod, "get_plugin_command_handler",
                         lambda name: _handler if name == "gsd-bind" else None)

    handled, result, command = await runner._hm_dispatch_quick_and_plugin_commands(event, source, "gsd_bind")

    assert handled is True
    assert result == "Bound: bind"
    assert seen["session_key"] == runner._session_key_for_source(source)
    assert seen["session_key"] != ""
    assert seen["chat_id"] == "c1"
    # Bound only for the handler call, not leaked past dispatch
    assert get_session_env("SCOUT_SESSION_KEY") == ""

