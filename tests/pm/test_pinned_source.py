"""Pinned downloads honour the user's npm registry."""
import os


def test_npm_artifacts_follow_the_users_npm_registry(tmp_path, monkeypatch):
    """#123132: lock URLs name registry.npmjs.org; ~/.npmrc or npm_config_registry picks the mirror."""
    from pm.artifact_mirror import pinned_source

    digest = "a" * 64
    lock_url = "https://registry.npmjs.org/npm/-/npm-10.9.2.tgz"
    monkeypatch.setattr("pathlib.Path.home", lambda: tmp_path)
    for key in [k for k in os.environ if k.lower().startswith("npm_config_")]:
        monkeypatch.delenv(key)
    assert pinned_source(lock_url, tmp_path / "npm.tgz", digest).url == lock_url
    (tmp_path / ".npmrc").write_text("; corp\nregistry = https://npm.corp.example/npm/\n", encoding="utf-8")
    assert pinned_source(lock_url, tmp_path / "npm.tgz", digest).url == "https://npm.corp.example/npm/npm/-/npm-10.9.2.tgz"
    monkeypatch.setenv("NPM_CONFIG_REGISTRY", "https://env.corp.example")
    assert pinned_source(lock_url, tmp_path / "npm.tgz", digest).url == "https://env.corp.example/npm/-/npm-10.9.2.tgz"
    other = "https://github.com/x/y/releases/download/v1/y.tgz"
    assert pinned_source(other, tmp_path / "y.tgz", digest).url == other
