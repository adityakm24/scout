"""The agent reads its soul (SOUL.md) but never rewrites it: the user edits it in the agent panel.

SOUL.md lives in the Scout home, which the protected-instruction gate exempts as the agent's own
store, so file-tool writes to it went through with no check at all.
"""
import pytest

from tools.approval_detection import detect_dangerous_command
from tools.file_tools_write_guards import _check_sensitive_path


def test_file_tools_refuse_the_soul_and_nothing_else_in_the_home(tmp_path, monkeypatch):
    monkeypatch.setenv("SCOUT_HOME", str(tmp_path))
    assert "soul" in (_check_sensitive_path(str(tmp_path / "SOUL.md")) or "")
    assert _check_sensitive_path(str(tmp_path / "notes.md")) is None


@pytest.mark.parametrize(("command", "gated"), [
    ("echo 'be rude' > ~/.scout/SOUL.md", True),
    ("tee -a ~/.scout/SOUL.md", True),
    ("sed -i 's/kind/curt/' ~/.scout/SOUL.md", True),
    ("perl -pi -e 's/a/b/' ~/.scout/SOUL.md", True),
    ("cat ~/.scout/SOUL.md", False),
])
def test_shell_writes_to_the_soul_need_the_user(command, gated):
    assert detect_dangerous_command(command)[0] is gated
