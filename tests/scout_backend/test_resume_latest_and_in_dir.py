"""Tests for `--resume latest` and `--in DIR` launch sugar.

`scout --tui --resume latest --in ./dir` (and the classic-CLI equivalents)
resolve "latest" through the same workspace-scoped MRU lookup as `-c`, with
`--in` re-homing the process before any session resolution happens.
"""

from __future__ import annotations

from argparse import Namespace

import pytest


def _args(**overrides):
    base = {
        "cli": False,
        "continue_last": None,
        "in_dir": None,
        "model": None,
        "no_restore_cwd": False,
        "provider": None,
        "query": None,
        "resume": None,
        "safe_mode": False,
        "toolsets": None,
        "tui": True,
        "tui_dev": False,
        "worktree": False,
    }
    base.update(overrides)
    return Namespace(**base)


@pytest.fixture
def main_mod(monkeypatch):
    import scout_backend.main as mod

    monkeypatch.setattr(mod, "_has_any_provider_configured", lambda: True)
    monkeypatch.setattr(mod, "_sync_bundled_skills_for_startup", lambda: False)
    monkeypatch.setattr(mod, "_pin_kanban_board_env", lambda: None)
    return mod


@pytest.fixture
def launched(main_mod, monkeypatch):
    """Capture the _launch_tui call instead of exec'ing Node."""
    captured = {}

    def fake_launch(resume_session_id=None, **kwargs):
        captured["resume"] = resume_session_id
        captured.update(kwargs)
        raise SystemExit(0)

    monkeypatch.setattr(main_mod, "_launch_tui", fake_launch)
    return captured


# ---------------------------------------------------------------------------
# argparse surface
# ---------------------------------------------------------------------------




def test_chat_subparser_accepts_in_flag():
    from scout_backend._parser import build_top_level_parser

    parser, _subparsers, _chat = build_top_level_parser()
    args = parser.parse_args(["chat", "--in", "/tmp", "--resume", "latest"])
    assert args.in_dir == "/tmp"
    assert args.resume == "latest"


def test_top_level_in_value_not_mistaken_for_subcommand(monkeypatch):
    # `scout --in chat` — "chat" is the flag's value, not the subcommand.
    import sys

    import scout_backend.main as mod

    monkeypatch.setattr(sys, "argv", ["scout", "--in", "chat", "--resume", "latest"])
    assert mod._first_positional_argv() is None


# ---------------------------------------------------------------------------
# --resume latest resolution
# ---------------------------------------------------------------------------












# ---------------------------------------------------------------------------
# --in DIR
# ---------------------------------------------------------------------------








@pytest.mark.platforms("linux")
def test_in_dir_expands_user_home(main_mod, launched, monkeypatch, tmp_path):
    import os

    home = tmp_path / "home"
    (home / "proj").mkdir(parents=True)
    monkeypatch.setenv("HOME", str(home))
    start = os.getcwd()

    try:
        with pytest.raises(SystemExit):
            main_mod.cmd_chat(_args(in_dir="~/proj"))
        assert os.getcwd() == str((home / "proj").resolve())
    finally:
        os.chdir(start)


# ---------------------------------------------------------------------------
# --in must win over an inherited TERMINAL_CWD (#106220)
# ---------------------------------------------------------------------------


def test_in_dir_replaces_inherited_terminal_cwd(main_mod, monkeypatch, tmp_path):
    """A parent Scout surface, the shell or .env can export TERMINAL_CWD before
    the CLI starts. Every cwd consumer prefers that variable over the process
    cwd, so a bare chdir left the Codex app-server thread, the terminal tool and
    context-file discovery in the inherited directory."""
    import os
    from pathlib import Path

    from agent.runtime_cwd import resolve_agent_cwd

    inherited = tmp_path / "inherited"
    target = tmp_path / "target"
    inherited.mkdir()
    target.mkdir()
    monkeypatch.chdir(inherited)
    monkeypatch.setenv("TERMINAL_CWD", str(inherited))

    args = _args(in_dir=str(target))
    main_mod._apply_in_dir(args)

    assert Path.cwd().resolve() == target.resolve()
    assert Path(os.environ["TERMINAL_CWD"]).resolve() == target.resolve()
    assert resolve_agent_cwd().resolve() == target.resolve()
    assert args.no_restore_cwd is True


def test_in_dir_leaves_unset_terminal_cwd_unset(main_mod, monkeypatch, tmp_path):
    """Without an inherited value the backends already derive from the process
    cwd (local exports os.getcwd() at cli import, docker mounts it, the TUI
    child inherits the chdir). Pre-seeding a host path here would leak it into
    ssh/container backends that must keep their own default."""
    import os

    target = tmp_path / "target"
    target.mkdir()
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("TERMINAL_CWD", raising=False)

    main_mod._apply_in_dir(_args(in_dir=str(target)))

    assert "TERMINAL_CWD" not in os.environ
