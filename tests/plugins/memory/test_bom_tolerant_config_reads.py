
import json
from pathlib import Path

import pytest


def _write_bom_json(path: Path, payload: dict) -> Path:
    path.write_text(json.dumps(payload), encoding="utf-8-sig")
    assert path.read_bytes().startswith(b"\xef\xbb\xbf")  # the BOM must really be on disk
    return path


def test_qwen_cli_tokens_tolerate_bom(tmp_path, monkeypatch):
    import scout_backend.auth as auth_mod

    creds = _write_bom_json(tmp_path / "oauth_creds.json", {"access_token": "tok", "expiry_date": 4102444800000})
    monkeypatch.setattr(auth_mod, "_qwen_cli_auth_path", lambda: creds)
    assert auth_mod._read_qwen_cli_tokens()["access_token"] == "tok"
