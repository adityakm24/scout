"""Resolve SCOUT_HOME for standalone skill scripts.

Skill scripts may run outside the Scout process (system Python, nix env,
CI) where ``scout_constants`` is not importable.  This module provides the
same ``get_scout_home()`` contract without requiring it on ``sys.path``.

When ``scout_constants`` IS available it is used directly so profile
resolution and any future enhancements are picked up automatically.
"""

from __future__ import annotations

import os
from pathlib import Path

try:
    from scout_constants import get_scout_home as get_scout_home
except (ModuleNotFoundError, ImportError):

    def get_scout_home() -> Path:
        """Return the Scout home directory (default: ``~/.scout``)."""
        val = os.environ.get("SCOUT_HOME", "").strip()
        return Path(val) if val else Path.home() / ".scout"
