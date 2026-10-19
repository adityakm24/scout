"""The frozen updater surface on scout_backend.main stays lazy and resolvable.

``scout_backend/update_cmd*.py`` (frozen: old installed versions call into it) reads
helpers off ``scout_backend.main`` via ``_m().<name>``. main.py resolves the ones that
live in the lazily-imported command modules through PEP 562 ``__getattr__`` so
every ``scout`` invocation (including ``scout --version``) does not pay for
update_cmd's dependency chain (jwt, click, ...) when no subcommand runs.
"""

import subprocess
import sys
import textwrap

import pytest

import scout_backend.main

def test_importing_main_does_not_import_command_modules():
    code = textwrap.dedent(
        """
        import sys
        import scout_backend.main  # noqa: F401
        loaded = [
            m
            for m in (
                "scout_backend.update_cmd",
                "scout_backend.sessions_cmd",
                "scout_backend.dashboard_procs",
            )
            if m in sys.modules
        ]
        assert not loaded, f"eagerly imported: {loaded}"
        """
    )
    result = subprocess.run(
        [sys.executable, "-c", code],
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert result.returncode == 0, result.stderr

@pytest.mark.real_concurrent_gate  # conftest autouse stub would shadow one frozen name
def test_frozen_updater_surface_resolves_to_real_objects():
    for module, names in scout_backend.main._FROZEN_UPDATER_SURFACE.items():
        mod = sys.modules[module] if module in sys.modules else __import__(module, fromlist=["_"])
        for name in names:
            got = getattr(scout_backend.main, name)
            # Identity, or the same function after another test importlib.reload()ed the module
            # (the resolved value is cached on scout_backend.main by design).
            assert got is getattr(mod, name) or (
                getattr(got, "__module__", None) == module and getattr(got, "__name__", None) == name
            ), name
