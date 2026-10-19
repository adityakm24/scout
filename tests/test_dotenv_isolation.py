"""The checkout's own .env never reaches a test process (tests/conftest.py).

A developer's local .env put real keys back into a runner-scrubbed process and failed 11 files
that stub `dotenv`, while CI (no such file) stayed green.
"""
from pathlib import Path

CHECKOUT_ENV = Path(__file__).resolve().parents[1] / ".env"


def test_the_checkout_env_is_not_loaded_even_when_present(monkeypatch, tmp_path):
    from scout_backend import env_loader

    loaded = []
    monkeypatch.setattr(env_loader, "_load_dotenv_with_fallback", lambda path, **_: loaded.append(Path(path)))
    monkeypatch.setattr(env_loader, "_sanitize_env_file_if_needed", lambda _: None)
    real_exists = Path.exists
    monkeypatch.setattr(Path, "exists", lambda self, **kw: self == CHECKOUT_ENV or real_exists(self, **kw))

    env_loader.load_scout_dotenv(project_env=CHECKOUT_ENV, load_external_secrets=False)
    assert CHECKOUT_ENV not in loaded

    # A loader test's own project .env still loads.
    own = tmp_path / ".env"
    own.write_text("X=1\n")
    env_loader.load_scout_dotenv(project_env=own, load_external_secrets=False)
    assert own in loaded
