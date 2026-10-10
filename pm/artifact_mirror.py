"""Download sources for pinned, hash-verified binary inputs.

The module name is part of the old-updater compat surface (tests/compat/old_updater_surface.json):
an already-running ``scout update`` imports ``pinned_source`` from the new tree."""
from __future__ import annotations

import os
from pathlib import Path

from pm.downloader import Source
from pm.index_config import npm_registry_url


def pinned_source(url: str, dest: Path, sha256: str) -> Source:
    # The lock records registry.npmjs.org; a user's npm mirror serves the same pinned bytes (#123132).
    return Source(npm_registry_url(url, os.environ), dest, sha256)
