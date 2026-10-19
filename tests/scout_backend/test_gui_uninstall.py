"""Tests for scout_backend.gui_uninstall — GUI-only uninstall + install discovery.

Covers the cross-platform artifact discovery, the agent/GUI detection the
desktop UI gates options on, and that ``uninstall_gui`` removes only GUI
artifacts (built renderer/release/node_modules, packaged bundle, Electron
userData) while leaving the Python agent + config/sessions/.env intact.
"""

import sys
from pathlib import Path

import pytest

import scout_backend.gui_uninstall as gu


def _make_agent(scout_home: Path) -> Path:
    """Create a fake agent install: source package + venv."""
    agent_root = scout_home / "scout-agent"
    (agent_root / "scout_backend").mkdir(parents=True)
    (agent_root / "scout_backend" / "__init__.py").write_text("")
    (agent_root / "venv" / "bin").mkdir(parents=True)
    return agent_root


def _make_gui_build(scout_home: Path) -> None:
    """Create the source-built GUI artifacts a `scout desktop` run produces."""
    desktop = scout_home / "scout-agent" / "apps" / "desktop"
    (desktop / "dist").mkdir(parents=True)
    (desktop / "dist" / "index.html").write_text("<html>")
    (desktop / "release" / "linux-unpacked").mkdir(parents=True)
    (desktop / "node_modules").mkdir(parents=True)
    (scout_home / "scout-agent" / "node_modules").mkdir(parents=True)
    (scout_home / "desktop-build-stamp.json").write_text("{}")


def test_gui_install_summary_shape(tmp_path, monkeypatch):
    scout_home = tmp_path / ".scout"
    _make_agent(scout_home)
    _make_gui_build(scout_home)
    monkeypatch.setattr(gu, "packaged_gui_app_paths", lambda: [])
    monkeypatch.setattr(gu, "desktop_userdata_dir", lambda: tmp_path / "none")

    summary = gu.gui_install_summary(scout_home)
    # JSON-serializable primitives the desktop UI gates on.
    assert summary["agent_installed"] is True
    assert summary["gui_installed"] is True
    assert isinstance(summary["source_built_artifacts"], list)
    assert all(isinstance(p, str) for p in summary["source_built_artifacts"])
    assert summary["scout_home"] == str(scout_home)
    assert summary["platform"] == sys.platform


@pytest.mark.platforms("linux")
def test_uninstall_removes_launcher_entry_and_refreshes_cache(tmp_path, monkeypatch):
    monkeypatch.setenv("XDG_DATA_HOME", str(tmp_path / "xdg"))

    from scout_backend import linux_desktop_entry as lde

    entry = lde.desktop_entry_path()
    entry.parent.mkdir(parents=True, exist_ok=True)
    entry.write_text("x", encoding="utf-8")
    # The pre-rename entry lives on as a hidden alias of the app-id entry (#124492);
    # a GUI uninstall must take it with the real one.
    legacy_alias = entry.with_name(lde.LEGACY_DESKTOP_ENTRY_NAME)
    legacy_alias.write_text("x", encoding="utf-8")

    refreshed: list[Path] = []
    monkeypatch.setattr(
        lde, "refresh_desktop_databases", lambda d: refreshed.append(d) or ["kbuildsycoca6"]
    )

    scout_home = tmp_path / ".scout"
    _make_agent(scout_home)
    icon = lde.icon_path(scout_home / "scout-agent")
    icon.parent.mkdir(parents=True, exist_ok=True)
    icon.write_bytes(b"\x89PNG")
    monkeypatch.setattr(gu, "desktop_userdata_dir", lambda: tmp_path / "none")

    removed = gu.uninstall_gui(scout_home)

    assert entry in removed and not entry.exists()
    assert legacy_alias in removed and not legacy_alias.exists()
    assert refreshed == [entry.parent]
    # The icon lives in the checkout. A GUI uninstall must not delete it.
    assert lde.icon_path(scout_home / "scout-agent").exists()
    # The agent itself survives a GUI uninstall.
    assert (scout_home / "scout-agent" / "scout_backend").is_dir()


@pytest.mark.platforms("posix")  # POSIX symlink semantics
def test_remove_path_handles_symlink(tmp_path):
    target = tmp_path / "real"
    target.mkdir()
    link = tmp_path / "link"
    link.symlink_to(target)
    assert gu._remove_path(link) is True
    assert not link.exists()
    # The symlink is gone but its target is untouched.
    assert target.exists()


def test_uninstall_args_namespace_mode_mapping():
    """_UninstallArgs maps mode → the gui/full flags run_uninstall reads."""
    import scout_backend.uninstall as uninstall

    gui = uninstall._UninstallArgs(mode="gui")
    assert gui.gui is True and gui.full is False and gui.yes is True

    lite = uninstall._UninstallArgs(mode="lite")
    assert lite.gui is False and lite.full is False and lite.yes is True

    full = uninstall._UninstallArgs(mode="full")
    assert full.gui is False and full.full is True and full.yes is True

