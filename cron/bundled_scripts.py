"""Scripts Scout ships for its own job templates (``cron/scripts/``).

A cron job may only run a script from its profile's ``<home>/scripts`` (``scheduler_script``), so
a template that needs one installs it there first. An older installed copy is refreshed so a fixed
template script reaches existing users; a user's own file of another name is never touched.
"""

from __future__ import annotations

import os
from pathlib import Path

BUNDLED_SCRIPTS_DIR = Path(__file__).resolve().parent / "scripts"


def install_bundled_script(name: str, home: Path) -> str:
    """Copy ``cron/scripts/<name>`` into ``<home>/scripts`` and return the name a job references."""
    source = BUNDLED_SCRIPTS_DIR / name
    if source.parent != BUNDLED_SCRIPTS_DIR or not source.is_file():
        raise ValueError(f"no bundled cron script named {name!r}")
    target_dir = Path(home) / "scripts"
    target_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    target = target_dir / name
    payload = source.read_bytes()
    if not target.is_file() or target.read_bytes() != payload:
        tmp = target.with_name(f".{name}.tmp")
        tmp.write_bytes(payload)
        os.chmod(tmp, 0o700)
        os.replace(tmp, target)
    return name
