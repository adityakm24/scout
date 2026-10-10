"""Resolve SCOUT_HOME for standalone skill scripts.

Skill scripts may run outside the Scout process (e.g. system Python,
nix env, CI) where ``scout_constants`` is not importable.  This module
provides the same ``get_scout_home()`` and ``display_scout_home()``
contracts as ``scout_constants`` without requiring it on ``sys.path``.

When ``scout_constants`` IS available it is used directly so that any
future enhancements (profile resolution, Docker detection, etc.) are
picked up automatically.  The fallback path replicates the core logic
from ``scout_constants.py`` using only the stdlib.

All scripts under ``google-workspace/scripts/`` should import from here
instead of duplicating the ``SCOUT_HOME = Path(os.getenv(...))`` pattern.
"""

from __future__ import annotations

import os
from pathlib import Path

try:
    from scout_constants import display_scout_home as display_scout_home
    from scout_constants import get_scout_home as get_scout_home
except (ModuleNotFoundError, ImportError):

    def get_scout_home() -> Path:
        """Return the Scout home directory (default: ~/.scout).

        Mirrors ``scout_constants.get_scout_home()``."""
        val = os.environ.get("SCOUT_HOME", "").strip()
        return Path(val) if val else Path.home() / ".scout"

    def display_scout_home() -> str:
        """Return a user-friendly ``~/``-shortened display string.

        Mirrors ``scout_constants.display_scout_home()``."""
        home = get_scout_home()
        try:
            return "~/" + home.relative_to(Path.home()).as_posix()
        except ValueError:
            return str(home)


def write_private(path: Path, text: str) -> None:
    """Write a credential file (OAuth client secret, tokens) readable only by this user: a plain
    ``write_text`` leaves it world-readable under the usual 022 umask."""
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    if hasattr(os, "fchmod"):  # POSIX: an existing file keeps its old mode through O_CREAT
        os.fchmod(fd, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        handle.write(text)
