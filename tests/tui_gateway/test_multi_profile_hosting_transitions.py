"""Serve / dashboard profile scopes stay authoritative across the first-secondary transition.

Three edges of the fail-closed multi-profile host (review of #111620):

* ``send`` under a routed profile's scope must keep the composed scope (user ``.env`` then external
  secret sources) authoritative — replaying raw ``.env`` reversed that precedence for the request;
* a launch-profile body that enters while the process is still single-profile must keep resolving
  its own credential after a concurrent first secondary flips ``get_secret`` to fail closed
  (``_MULTIPLEX_ACTIVE`` is consulted on every read; the scope decision is made once at entry);
* releasing a runtime scope is per-reset best-effort: a failing terminal reset must not leave the
  previous profile's secrets / SCOUT_HOME installed for the next body in that context.
"""

from __future__ import annotations

import threading
from pathlib import Path

import pytest

import tui_gateway.server as server
from tui_gateway import launch_profile_policy as lpp

A_VAL = "a-only-secret-0001"
B_VAL = "b-only-secret-0002"
ENV_VAL = "systemd-injected-0003"


@pytest.fixture
def two_homes(tmp_path, monkeypatch):
    root = tmp_path / "scout_home"
    b = root / "profiles" / "b"
    b.mkdir(parents=True)
    (root / ".env").write_text(f"A_ONLY_TOKEN={A_VAL}\n", encoding="utf-8")
    (b / ".env").write_text(f"B_ONLY_TOKEN={B_VAL}\nSHARED_TOKEN=b-dotenv-stale\n", encoding="utf-8")
    monkeypatch.setenv("SCOUT_HOME", str(root))
    monkeypatch.setenv("A_ONLY_TOKEN", A_VAL)
    monkeypatch.setenv("INJECTED_TOKEN", ENV_VAL)  # systemd / op run credential injection, no file
    monkeypatch.setattr(server, "_scout_home", root)
    monkeypatch.setattr(server, "_served_profile_homes", set())
    monkeypatch.setattr(lpp, "_snapshot", None)
    monkeypatch.setattr("agent.secret_scope._MULTIPLEX_ACTIVE", False)
    return root, b


def test_launch_body_survives_first_secondary_activation(two_homes):
    """Barrier: the launch RPC enters single-profile, B activates on another thread, the launch RPC
    resumes and still resolves its env-injected credential instead of raising."""
    from agent.secret_scope import get_secret, is_multiplex_active

    root, b = two_homes
    entered, activated = threading.Event(), threading.Event()
    seen: dict = {}

    def launch_body():
        with server._session_profile_runtime_scope({"profile_home": None}):
            seen["before"] = get_secret("INJECTED_TOKEN")
            entered.set()
            assert activated.wait(10)
            seen["multiplex_now"] = is_multiplex_active()
            seen["after"] = get_secret("INJECTED_TOKEN")
            seen["b_leak"] = get_secret("B_ONLY_TOKEN")

    t = threading.Thread(target=launch_body)
    t.start()
    assert entered.wait(10)
    assert server._profile_home("b") == b  # first secondary: freezes the launch env, flips fail-closed
    activated.set()
    t.join(10)
    assert seen == {"before": ENV_VAL, "multiplex_now": True, "after": ENV_VAL, "b_leak": None}


def test_launch_body_survives_first_secondary_activation_on_the_dashboard(two_homes, monkeypatch):
    pytest.importorskip("fastapi")
    from agent.secret_scope import get_secret
    from scout_backend import web_server_profiles as wsp

    root, b = two_homes
    monkeypatch.setattr(wsp, "_resolve_profile_dir", lambda name: b)
    entered, activated = threading.Event(), threading.Event()
    seen: dict = {}

    def launch_request():
        with wsp._config_profile_scope(None):
            seen["before"] = get_secret("INJECTED_TOKEN")
            entered.set()
            assert activated.wait(10)
            seen["after"] = get_secret("INJECTED_TOKEN")

    t = threading.Thread(target=launch_request)
    t.start()
    assert entered.wait(10)
    with wsp._config_profile_scope("b") as scoped:
        assert scoped == b and get_secret("B_ONLY_TOKEN") == B_VAL
    activated.set()
    t.join(10)
    assert seen == {"before": ENV_VAL, "after": ENV_VAL}


def test_release_resets_every_scope_when_one_reset_fails(two_homes, monkeypatch):
    from agent.secret_scope import current_secret_scope
    from scout_constants import get_scout_home_override
    from tools import terminal_scope

    root, b = two_homes
    scopes = server._profile_runtime_scope_tokens(str(b))
    assert current_secret_scope() is not None and get_scout_home_override() == str(b)

    real_reset = terminal_scope.reset_terminal_scope

    def exploding(_token):
        raise RuntimeError("terminal reset blew up")

    monkeypatch.setattr(terminal_scope, "reset_terminal_scope", exploding)
    server._release_build_profile_scopes(scopes)  # suppresses the re-raised failure
    # The exploding reset left the terminal ContextVar bound to B's scope on this thread. The
    # scenario is proven here; unbind it, or every later test in the process inherits B's scope.
    real_reset(scopes.terminal)
    assert terminal_scope.get_terminal_scope() is None
    assert current_secret_scope() is None
    assert get_scout_home_override() is None
    assert Path(server._scout_home) == root
