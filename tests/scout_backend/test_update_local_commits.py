"""A checkout carrying commits its update source lacks is never updated from a button.

The updater resets a diverged branch to origin; the dashboard/phone "Update" must not offer that
when it would take the checkout's own commits off the branch.
"""

import asyncio
import subprocess

from scout_backend.web_routers import actions


def _git(cwd, *args):
    subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True,
                   env={"GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t", "GIT_COMMITTER_NAME": "t",
                        "GIT_COMMITTER_EMAIL": "t@t", "PATH": "/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin"})


def _checkout(tmp_path, local_commits):
    origin = tmp_path / "origin"
    origin.mkdir()
    _git(origin, "init", "-q", "-b", "main")
    _git(origin, "commit", "-q", "--allow-empty", "-m", "base")
    work = tmp_path / "work"
    _git(tmp_path, "clone", "-q", str(origin), str(work))
    for n in range(local_commits):
        _git(work, "commit", "-q", "--allow-empty", "-m", f"local {n}")
    return work


def test_local_commits_block_the_update_button(tmp_path, monkeypatch):
    work = _checkout(tmp_path, local_commits=2)
    monkeypatch.setattr(actions, "_server_path", lambda name: work)
    monkeypatch.setattr(actions, "is_commit_build", lambda root: False)
    monkeypatch.setattr(actions, "_dashboard_local_update_managed_externally", lambda: False)
    monkeypatch.setattr(actions, "detect_install_method", lambda root: "git")

    check = asyncio.run(actions.check_scout_update())
    applied = asyncio.run(actions.update_scout())

    assert (check["update_available"], check["can_apply"]) == (False, False) and "2 commit" in check["message"]
    assert applied["ok"] is False and applied["error"] == "local_commits"


def test_a_checkout_matching_its_source_can_still_update(tmp_path):
    assert actions._local_commits_ahead(_checkout(tmp_path, local_commits=0)) == 0
