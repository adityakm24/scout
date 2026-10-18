"""Cross-writer invariant: every private-credential file is 0600 from the moment its temp file exists.

The credential writers (auth.json, MCP OAuth tokens, secret-source cache, iron-proxy state, the
exchanged-JWT store, the Photon sidecar record, pairing data, the vault blob, the third-party
credential file, the spawn ledger, the meet-node token) all funnel through ``utils.atomic_json_write`` / ``atomic_write_text`` /
``atomic_write_bytes`` with ``mode=0o600``. The contract under test: the *temp* file is created
with mode 0600 (``O_EXCL``) BEFORE any byte lands and the final file carries 0600 — never
"open at umask, then chmod" (the #19673 window). POSIX-only: mode bits are not enforced on Windows.
"""

from __future__ import annotations

import json
import os
import stat

import pytest

pytestmark = pytest.mark.platforms("posix")  # POSIX mode bits not enforced on Windows

_PRIVATE = stat.S_IRUSR | stat.S_IWUSR


@pytest.fixture
def opens_spy(monkeypatch):
    """Record every ``os.open`` create (path, flags, mode) issued through ``utils``."""
    import utils

    observed: list[tuple[str, int, int]] = []
    real_open = os.open

    def spying(path, flags, mode=0o777, *args, **kwargs):
        if flags & os.O_CREAT:
            observed.append((os.fspath(path), flags, mode))
        return real_open(path, flags, mode, *args, **kwargs)

    # mkstemp resolves ``os.open`` at call time from the ``tempfile`` module namespace.
    monkeypatch.setattr(utils.tempfile._os, "open", spying)
    return observed


def test_canonical_private_writers_round_trip_json_text_and_bytes(tmp_path):
    from utils import atomic_json_write, atomic_write_bytes, atomic_write_text

    target = tmp_path / "nested" / "creds.json"
    payload = {"token": "sk-\u00e9\u2603", "n": [1, 2]}
    atomic_json_write(target, payload, mode=0o600, fsync_dir=True)
    assert json.loads(target.read_text(encoding="utf-8")) == payload
    assert stat.S_IMODE(target.stat().st_mode) == 0o600

    atomic_write_text(target, "plain\n", mode=0o600)
    assert target.read_text(encoding="utf-8") == "plain\n"

    blob = bytes(range(256)) * 3
    atomic_write_bytes(target, blob, mode=0o600, fsync_dir=True)
    assert target.read_bytes() == blob
    assert stat.S_IMODE(target.stat().st_mode) == 0o600
    assert [p.name for p in target.parent.iterdir()] == ["creds.json"], "temp files must not survive"
