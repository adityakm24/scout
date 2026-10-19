"""Tests for `chat -c <title>` failing loudly (stderr) and `--create-if-missing`.

Regression for #86794: a background/quiet `scout chat -c "<title>" -q "..."`
against a not-yet-existing titled session silently no-oped — the error message
was written to stdout (which quiet/programmatic callers treat as the "final
response" channel) instead of stderr, and there was no way to create the
titled session from the same invocation.

Two behaviors are fixed here:

1. **fail loudly on stderr** — when no session matches `-c <title>`, the error
   goes to stderr (exit 1), so programmatic callers always see it.
2. **--create-if-missing** — same invocation with the flag creates a fresh
   session carrying the title and proceeds, giving plugins/scripts a
   deterministic "send to this named thread, making it if needed" primitive.
"""

import pytest


@pytest.fixture
def isolated_home(tmp_path, monkeypatch):
    """Point SCOUT_HOME at a temp dir so session creation stays isolated."""
    home = tmp_path / "scout_home"
    home.mkdir()
    monkeypatch.setenv("SCOUT_HOME", str(home))
    return home


def _create_titled_session(title):
    from scout_backend.main import _create_titled_session as fn

    return fn(title)


class TestCreateIfMissingFlagParsing:
    def test_flag_parses_on_chat_subparser(self):
        """--create-if-missing is accepted by the real chat parser."""
        from scout_backend._parser import build_top_level_parser

        parser, _subparsers, _chat_parser = build_top_level_parser()
        args = parser.parse_args(
            ["chat", "-c", "Bot Chat", "--create-if-missing", "-q", "hi"]
        )
        assert args.continue_last == "Bot Chat"
        assert getattr(args, "create_if_missing", False) is True

    def test_flag_absent_means_false(self):
        """Without the flag, create_if_missing stays unset (SUPPRESS default)."""
        from scout_backend._parser import build_top_level_parser

        parser, _subparsers, _chat_parser = build_top_level_parser()
        args = parser.parse_args(["chat", "-c", "Bot Chat", "-q", "hi"])
        # SUPPRESS default: attribute absent, and cmd_chat's getattr(..., False)
        # must treat it as False.
        assert getattr(args, "create_if_missing", False) is False


class TestCreateTitledSession:
    def test_creates_session_with_title(self, isolated_home):
        sid = _create_titled_session("Bot Chat")
        assert sid, "should return a session id"

        from scout_state import SessionDB

        db = SessionDB()
        try:
            session = db.get_session(sid)
            assert session is not None
            assert db.get_session_title(sid) == "Bot Chat"
        finally:
            db.close()

    def test_created_session_resolvable_by_title(self, isolated_home):
        """After creation, resolve_session_by_title finds it (idempotent sends)."""
        sid = _create_titled_session("Bot Chat")
        assert sid

        from scout_state import SessionDB

        db = SessionDB()
        try:
            resolved = db.resolve_session_by_title("Bot Chat")
            assert resolved == sid
        finally:
            db.close()


