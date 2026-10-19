"""Setup surfaces ask only for what a platform can't start without.

The knobs in SETUP_HIDDEN_ENV_SUFFIXES are self-configuring (/sethome) or
already correct by default, so they don't belong on a setup form. They must
still be reachable everywhere else — this is a presentation change, not a
feature removal.
"""

import pytest

from scout_backend.setup_hidden_env import is_setup_hidden_env


class TestIsSetupHiddenEnv:


    def test_applies_to_plugin_platforms_nobody_enumerated(self):
        """Suffix matching is the point — IRC/SimpleX/ntfy get this for free."""
        for key in (
            "IRC_ALLOW_ALL_USERS",
            "SIMPLEX_HOME_CHANNEL",
            "NTFY_HOME_CHANNEL_NAME",
            "LINE_ALLOW_ALL_USERS",
        ):
            assert is_setup_hidden_env(key), key


class TestCliWizard:
    """`scout setup gateway` drops the same knobs. Real wizard, scripted
    stdin, real .env writes under a temp SCOUT_HOME."""

    @pytest.fixture
    def home(self, tmp_path, monkeypatch):
        monkeypatch.setenv("SCOUT_HOME", str(tmp_path))
        return tmp_path

    def _run(self, answers, monkeypatch):
        import io

        from scout_backend import gateway as gw

        platform = next(p for p in gw._PLATFORMS if p["key"] == "mattermost")
        monkeypatch.setattr("sys.stdin", io.StringIO("\n".join(answers) + "\n"))
        gw._setup_standard_platform(dict(platform))

    def _env(self, home):
        path = home / ".env"
        if not path.exists():
            return {}
        out = {}
        for line in path.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                out[k] = v
        return out

    def test_wizard_stops_asking_about_hidden_knobs(self, home, monkeypatch, capsys):
        # Only the three real answers. If the wizard still prompted for the
        # home channel it would read past them.
        self._run(
            ["https://mm.example.com", "tok-abc", "user26charid"], monkeypatch
        )

        written = self._env(home)
        assert written.get("MATTERMOST_URL") == "https://mm.example.com"
        assert written.get("MATTERMOST_TOKEN") == "tok-abc"
        assert "MATTERMOST_HOME_CHANNEL" not in written
        assert "MATTERMOST_REPLY_MODE" not in written

        out = capsys.readouterr().out
        assert "Home channel" not in out
        assert "Reply mode" not in out

    def test_required_token_still_gates_setup(self, home, monkeypatch):
        """Proves the token wasn't swept out along with the knobs."""
        self._run(["https://mm.example.com", ""], monkeypatch)

        assert "MATTERMOST_TOKEN" not in self._env(home)


