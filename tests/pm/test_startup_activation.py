"""Startup consumes one real PM verdict; activation never serves a partial toolchain."""

import importlib
import os
import sys
from pathlib import Path

import pytest

import pm
from pm import paths, registry
from pm.lock import Lockfile
from pm.packages import BinaryPackage
from tests.pm._fixtures import make_tar, served as served


@pytest.fixture
def checked_store(tmp_path, monkeypatch, served):
    engine = importlib.import_module("pm.install")
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    monkeypatch.setenv("SCOUT_HOME", str(tmp_path / "home"))
    monkeypatch.setenv("SCOUT_RUNTIME_DIR", str(tmp_path / "store"))
    monkeypatch.setattr(paths, "repo_root", lambda: tmp_path / "repo")
    monkeypatch.setattr(paths, "lockfile_path", lambda: tmp_path / "lock.json")
    monkeypatch.setattr(registry, "_packages", {})
    docroot, url = served
    lock = Lockfile(paths.lockfile_path())
    binaries = []
    for name in ("first", "second", "third"):
        package = BinaryPackage()
        package.name = name
        package.probe_version = False
        package.binary_rel = {"posix": f"bin/{name}", "win32": f"bin/{name}"}
        registry._packages[name] = package
        archive, digest = make_tar(docroot, f"{name}.tar.gz", {f"bin/{name}": "fixture tool"})
        lock.set_pin(name, "1.0", {"any": {"url": f"{url}/{archive}", "sha256": digest}})
        lock.save()
        engine.ensure(name, explicit=True)
        installed = pm.installed_package(name)
        assert installed is not None and installed.binary is not None
        binaries.append(installed.binary)

    checks = []
    real_check = engine.check

    def counted_check(**kwargs):
        problems = real_check(**kwargs)
        checks.append(problems)
        return problems

    monkeypatch.setattr(engine, "check", counted_check)
    monkeypatch.setattr(pm, "check", counted_check)
    return binaries, checks


def test_activate_moves_store_dirs_ahead_of_user_dirs(checked_store, monkeypatch):
    binaries, checks = checked_store
    store = [str(binary.parent) for binary in binaries]
    user_dir = os.path.join(os.sep, "user", "bin")
    # A store dir already on PATH behind a user dir must still end up in front of it.
    monkeypatch.setenv("PATH", os.pathsep.join([user_dir, store[1]]))

    assert pm.activate() == []
    assert checks == [[]]
    assert os.environ["PATH"].split(os.pathsep) == [*store, user_dir]


def test_drift_activates_intact_chains_and_reports_the_live_verdict(checked_store, monkeypatch):
    binaries, checks = checked_store
    user_dir = os.path.join(os.sep, "user", "bin")
    monkeypatch.setattr(registry._packages["third"], "deps", ("second",))
    assert pm.activate() == []

    # A second invocation must observe fresh damage, even after healthy activation.
    monkeypatch.setenv("PATH", user_dir)
    binaries[1].unlink()
    problems = pm.activate()
    assert problems == ["second: not installed or outdated"]
    assert checks == [[], problems]
    # Intact first stays ahead of the user's copies; damaged second and third, which
    # depends on it, stay off PATH so no toolchain is served half from the store.
    assert os.environ["PATH"].split(os.pathsep) == [str(binaries[0].parent), user_dir]


