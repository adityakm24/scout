"""Cheap source-driver checks: real shells, disposable installs, no installer."""
import hashlib
import json
import os
from pathlib import Path
import runpy
import shutil
import subprocess
import sys
import sysconfig

import pytest


ASSETS = Path(__file__).resolve().parents[1] / "install/e2e-assets"


@pytest.mark.platforms("posix")
def test_shell_selects_the_installed_command_not_the_phase_or_path(tmp_path):
    root = tmp_path / "installed source"
    legacy = root / "venv/bin/scout"
    published = root / ".scout/bin/scout"
    for command, label in ((legacy, "legacy"), (published, "published")):
        command.parent.mkdir(parents=True)
        command.write_text(f'#!/bin/sh\nprintf "{label}:%s\\n" "$*"\n', encoding="utf-8")
        command.chmod(0o755)
    env = dict(os.environ, INSTALL_DIR=str(root), ASSETS=str(ASSETS), HOME=str(tmp_path))
    result = subprocess.run(["bash", "-euc", '''
source "$ASSETS/source-driver.sh"
command=$(source_scout "$INSTALL_DIR")
"$command" 'literal argument'
rm "$INSTALL_DIR/venv/bin/scout"
test "$(source_scout "$INSTALL_DIR")" = "$command"
printf '#!/bin/sh\nexit 23\n' > "$command"
"$command" || test "$?" = 23
rm "$command"
if source_scout "$INSTALL_DIR"; then exit 91; fi
printf '#!/bin/sh\nprintf legacy\n' > "$INSTALL_DIR/venv/bin/scout"
chmod +x "$INSTALL_DIR/venv/bin/scout"
"$(source_scout "$INSTALL_DIR")"
# A PM checkout cannot hide missing publication behind its old venv.
mkdir -p "$INSTALL_DIR/pm"
printf '{}' > "$INSTALL_DIR/pm/lock.json"
if source_scout "$INSTALL_DIR"; then exit 92; fi
'''], env=env, cwd=tmp_path, capture_output=True, text=True, timeout=30)
    assert result.returncode == 0, result.stdout + result.stderr
    assert result.stdout.splitlines() == ["published:literal argument", "legacy"]


@pytest.mark.platforms("posix")
def test_installer_marker_is_the_only_dirty_state_a_driver_accepts(tmp_path):
    root = tmp_path / "installed source"
    root.mkdir()
    git = ["git", "-C", str(root), "-c", "user.name=t", "-c", "user.email=t@t"]
    subprocess.run([*git, "init", "-q"], check=True)
    (root / "tracked").write_text("v1\n", encoding="utf-8")
    subprocess.run([*git, "add", "tracked"], check=True)
    subprocess.run([*git, "commit", "-qm", "base"], check=True)
    (root / ".install_method").write_text("git\n", encoding="utf-8")
    env = dict(os.environ, INSTALL_DIR=str(root), ASSETS=str(ASSETS), HOME=str(tmp_path))

    def accept():
        return subprocess.run(["bash", "-euc", 'source "$ASSETS/source-driver.sh"; accept_installer_marker "$INSTALL_DIR"'],
                              env=env, capture_output=True, text=True, timeout=30)

    assert accept().returncode == 0
    assert (root / ".install_method").read_text(encoding="utf-8") == "git\n"
    assert subprocess.run([*git, "status", "--porcelain", "--untracked-files=all"],
                          capture_output=True, text=True, check=True).stdout == ""
    (root / "tracked").write_text("edited\n", encoding="utf-8")
    refused = accept()
    assert refused.returncode != 0 and "M tracked" in refused.stderr


@pytest.mark.platforms("windows", "posix")
def test_powershell_selects_exact_exe_or_cmd_and_legacy_fallback(tmp_path):
    # These are file-selection rules, not Windows execution emulation. Run
    # them in real PowerShell on any host that supplies it (native CI included).
    path = os.pathsep.join(p for p in os.get_exec_path() if ".scout" not in Path(p).parts)
    pwsh = shutil.which("pwsh", path=path) or shutil.which("powershell", path=path)
    if not pwsh:
        if os.name == "nt":
            pytest.fail("native Windows acceptance requires PowerShell")
        pytest.skip("PowerShell is not available on this host")
    root = tmp_path / "installed source"
    root.mkdir()
    harness = tmp_path / "probe.ps1"
    harness.write_text('''$ErrorActionPreference = 'Stop'
. (Join-Path $env:ASSETS 'source-driver.ps1')
$root = $env:INSTALL_DIR
$legacy = Join-Path $root 'venv/Scripts/scout.exe'
$exe = Join-Path $root '.scout/bin/scout.exe'
$cmd = Join-Path $root '.scout/bin/scout.cmd'
New-Item -ItemType Directory -Path (Split-Path $legacy), (Split-Path $exe) -Force | Out-Null
Set-Content $legacy 'legacy'
if ((Get-SourceScout $root) -ne $legacy) { throw 'legacy fallback' }
Set-Content $cmd 'cmd'
if ((Get-SourceScout $root) -ne $cmd) { throw 'published cmd' }
Set-Content $exe 'exe'
if ((Get-SourceScout $root) -ne $exe) { throw 'exe precedence' }
Remove-Item $legacy
if ((Get-SourceScout $root) -ne $exe) { throw 'requires legacy venv' }
Remove-Item $exe, $cmd
$refused = $false
try { Get-SourceScout $root } catch { $refused = $true }
if (-not $refused) { throw 'missing command accepted' }
Set-Content $legacy 'stale legacy'
New-Item -ItemType Directory -Path (Join-Path $root 'pm') | Out-Null
Set-Content (Join-Path $root 'pm/lock.json') '{}'
$refused = $false
try { Get-SourceScout $root } catch { $refused = $true }
if (-not $refused) { throw 'missing PM launcher accepted' }
Write-Output 'selection verified'
''', encoding="utf-8")
    result = subprocess.run([pwsh, "-NoProfile", "-NonInteractive", "-File", str(harness)],
                            env=dict(os.environ, INSTALL_DIR=str(root), ASSETS=str(ASSETS), HOME=str(tmp_path)),
                            cwd=tmp_path, capture_output=True, text=True, timeout=30)
    assert result.returncode == 0, result.stdout + result.stderr
    assert result.stdout.strip() == "selection verified"


def test_observer_preserves_no_desktop_and_refuses_incomplete_app(tmp_path):
    verify = runpy.run_path(str(ASSETS / "source_driver.py"))["verify_products"]
    root = tmp_path / "source"
    root.mkdir()
    verify(root, "absent")
    assert list(root.iterdir()) == []
    with pytest.raises(RuntimeError, match="desktop"):
        verify(root, "present")
    release = root / "apps/desktop/release/linux-unpacked"
    release.mkdir(parents=True)
    (release / "scout").write_bytes(b"incomplete fixture")
    with pytest.raises(RuntimeError, match="desktop"):
        verify(root, "absent")
    with pytest.raises(RuntimeError, match="desktop"):
        verify(root, "present")
    assert (release / "scout").read_bytes() == b"incomplete fixture"


