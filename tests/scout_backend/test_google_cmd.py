"""``scout google`` runs the google-workspace skill's scripts without the agent writing a path.

A small model rewrote ``python $SCOUT_HOME/skills/.../google_api.py`` into a path that did not exist
and told the user the skill was not installed."""

import argparse
import subprocess
import sys
from types import SimpleNamespace

import pytest

from scout_backend.subcommands import google


@pytest.mark.parametrize(("rest", "script", "passed"), [
    (["gmail", "search", "from:dbs", "--max", "1"], "google_api.py", ["gmail", "search", "from:dbs", "--max", "1"]),
    (["status"], "setup.py", ["--check"]),
    (["setup", "--auth-url"], "setup.py", ["--auth-url"]),
])
def test_runs_the_bundled_skill_script(monkeypatch, rest, script, passed):
    seen = {}
    monkeypatch.setattr(subprocess, "run", lambda argv, check: seen.setdefault("argv", argv) and SimpleNamespace(returncode=0))
    parser = argparse.ArgumentParser()
    google.build_google_parser(parser.add_subparsers())

    with pytest.raises(SystemExit) as exit_info:
        args = parser.parse_args(["google", *rest])
        args.func(args)

    assert exit_info.value.code == 0
    argv = seen["argv"]
    assert argv[0] == sys.executable and argv[1].endswith(f"google-workspace/scripts/{script}")
    assert argv[2:] == passed
