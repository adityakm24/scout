"""Tests for /update gateway slash command.

Tests both the _handle_update_command handler (spawns update process) and
the _send_update_notification startup hook (sends results after restart).
"""

import json
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import patch, MagicMock, AsyncMock

import pytest

from gateway.config import Platform
from gateway.platforms.event import MessageEvent
from gateway.session import SessionSource


def _make_event(text="/update", platform=Platform.HOMEASSISTANT,
                user_id="12345", chat_id="67890", thread_id=None):
    """Build a MessageEvent for testing."""
    source = SessionSource(
        platform=platform,
        user_id=user_id,
        chat_id=chat_id,
        user_name="testuser",
        thread_id=thread_id,
    )
    return MessageEvent(text=text, source=source)


def _make_runner():
    """Create a bare GatewayRunner without calling __init__."""
    from gateway.run import GatewayRunner
    runner = object.__new__(GatewayRunner)
    runner.adapters = {}
    runner._voice_mode = {}
    runner._update_prompt_pending = {}
    return runner


# ---------------------------------------------------------------------------
# _handle_update_command
# ---------------------------------------------------------------------------


class TestHandleUpdateCommand:
    """Tests for GatewayRunner._handle_update_command."""



    @pytest.mark.asyncio
    async def test_resolve_scout_bin_module_argv(self):
        """_resolve_scout_bin uses the running interpreter's module argv when scout_cli is
        importable, even when PATH also offers a ``scout`` binary (#111569: a PATH-first
        lookup would re-exec an attacker-planted executable on /update and /restart)."""
        import sys
        from gateway.run import _resolve_scout_bin

        fake_spec = MagicMock()
        with patch("shutil.which", return_value="/tmp/attacker/scout"), \
             patch("importlib.util.find_spec", return_value=fake_spec):
            result = _resolve_scout_bin()

        assert result == [sys.executable, "-m", "scout_cli.main"]

    @pytest.mark.asyncio
    async def test_resolve_scout_bin_falls_back_to_path_then_none(self):
        """Without an importable scout_cli the argv degrades to PATH, then to None — never a
        bare ``scout`` string that a hostile PATH entry could shadow."""
        from gateway.run import _resolve_scout_bin

        with patch("shutil.which", return_value="/usr/local/bin/scout"), \
             patch("importlib.util.find_spec", return_value=None):
            assert _resolve_scout_bin() == ["/usr/local/bin/scout"]

        with patch("shutil.which", return_value=None), \
             patch("importlib.util.find_spec", side_effect=ImportError):
            assert _resolve_scout_bin() is None




    @pytest.mark.asyncio
    @pytest.mark.platforms("linux")
    async def test_fallback_when_no_setsid(self, tmp_path):
        """Falls back to start_new_session=True when setsid is not available."""
        runner = _make_runner()
        event = _make_event()

        fake_root = tmp_path / "project"
        fake_root.mkdir()
        (fake_root / ".git").mkdir()
        (fake_root / "gateway").mkdir()
        (fake_root / "gateway" / "run.py").touch()
        fake_file = str(fake_root / "gateway" / "run.py")
        scout_home = tmp_path / "scout"
        scout_home.mkdir()

        mock_popen = MagicMock()

        def which_no_setsid(x):
            if x == "scout":
                return "/usr/bin/scout"
            if x == "setsid":
                return None
            return None

        with patch("gateway.run._scout_home", scout_home), \
             patch("gateway.run.__file__", fake_file), \
             patch("scout_cli.config.detect_install_method", return_value="git"), \
             patch("shutil.which", side_effect=which_no_setsid), \
             patch("subprocess.Popen", mock_popen):
            await runner._handle_update_command(event)

        # Verify plain bash -c fallback (no nohup, no setsid)
        call_args = mock_popen.call_args[0][0]
        assert call_args[0] == "bash"
        assert "nohup" not in call_args[2]
        assert ".update_exit_code" in call_args[2]
        # start_new_session=True should be in kwargs
        call_kwargs = mock_popen.call_args[1]
        assert call_kwargs.get("start_new_session") is True


# ---------------------------------------------------------------------------
# Platform allowlist gate
# ---------------------------------------------------------------------------


class TestUpdateCommandPlatformGate:
    """Tests for the platform-allowlist gate at the top of
    ``_handle_update_command``.  Built-in messaging platforms are listed in
    ``_UPDATE_ALLOWED_PLATFORMS``; plugin-migrated platforms (discord,
    mattermost, teams, …) are NOT in the frozenset and rely on the
    registry's ``allow_update_command=True`` fallback.  Programmatic
    interfaces (ACP, API server, webhooks) must be blocked.
    """


    @pytest.mark.asyncio
    async def test_allows_plugin_platform_via_registry_fallback(self, monkeypatch):
        """A plugin-migrated platform (DISCORD) is no longer in
        ``_UPDATE_ALLOWED_PLATFORMS`` but must still pass the gate via
        the registry's ``allow_update_command=True`` flag.

        This test is the empirical guarantee that removing DISCORD from
        the hardcoded frozenset does not regress the /update command for
        Discord users.
        """

        # Make sure the plugin registry is populated so the fallback fires.
        from scout_cli.plugins import PluginManager
        PluginManager().discover_and_load(force=True)
        from gateway.platform_registry import platform_registry
        discord_entry = platform_registry.get("homeassistant")
        assert discord_entry is not None
        assert discord_entry.allow_update_command is True

        runner = _make_runner()
        event = _make_event(platform=Platform.HOMEASSISTANT)
        monkeypatch.setenv("SCOUT_MANAGED", "")

        with patch("subprocess.Popen"):
            result = await runner._handle_update_command(event)

        # The gate must NOT have rejected us — anything other than the
        # ``platform_not_messaging`` rejection string is acceptable here.
        # Later steps may legitimately return success ("Starting Scout
        # update…") or fail for environment reasons.
        assert "only available from messaging platforms" not in result




# ---------------------------------------------------------------------------
# _send_update_notification
# ---------------------------------------------------------------------------


class TestSendUpdateNotification:
    """Tests for GatewayRunner._send_update_notification."""


    @pytest.mark.asyncio
    async def test_defers_notification_while_update_still_running(self, tmp_path):
        """Returns False and keeps marker files when the update has not exited yet."""
        runner = _make_runner()
        scout_home = tmp_path / "scout"
        scout_home.mkdir()

        pending_path = scout_home / ".update_pending.json"
        pending_path.write_text(json.dumps({
            "platform": "homeassistant", "chat_id": "67890", "user_id": "12345",
        }))
        (scout_home / ".update_output.txt").write_text("still running")

        mock_adapter = AsyncMock()
        runner.adapters = {Platform.HOMEASSISTANT: mock_adapter}

        with patch("gateway.run._scout_home", scout_home):
            result = await runner._send_update_notification()

        assert result is False
        mock_adapter.send.assert_not_called()
        assert pending_path.exists()

    @pytest.mark.asyncio
    async def test_recovers_from_claimed_pending_file(self, tmp_path):
        """A claimed pending file from a crashed notifier is still deliverable."""
        runner = _make_runner()
        scout_home = tmp_path / "scout"
        scout_home.mkdir()

        claimed_path = scout_home / ".update_pending.claimed.json"
        claimed_path.write_text(json.dumps({
            "platform": "homeassistant", "chat_id": "67890", "user_id": "12345",
        }))
        (scout_home / ".update_output.txt").write_text("done")
        (scout_home / ".update_exit_code").write_text("0")

        mock_adapter = AsyncMock()
        runner.adapters = {Platform.HOMEASSISTANT: mock_adapter}

        with patch("gateway.run._scout_home", scout_home):
            result = await runner._send_update_notification()

        assert result is True
        mock_adapter.send.assert_called_once()
        assert not claimed_path.exists()

    @pytest.mark.asyncio
    async def test_sends_notification_with_output(self, tmp_path):
        """Sends update output to the correct platform and chat."""
        runner = _make_runner()
        scout_home = tmp_path / "scout"
        scout_home.mkdir()

        # Write pending marker
        pending = {
            "platform": "homeassistant",
            "chat_id": "67890",
            "user_id": "12345",
            "timestamp": "2026-03-04T21:00:00",
        }
        (scout_home / ".update_pending.json").write_text(json.dumps(pending))
        (scout_home / ".update_output.txt").write_text(
            "→ Found 3 new commit(s)\n✓ Code updated!\n✓ Update complete!"
        )
        (scout_home / ".update_exit_code").write_text("0")

        # Mock the adapter
        mock_adapter = AsyncMock()
        mock_adapter.send = AsyncMock()
        runner.adapters = {Platform.HOMEASSISTANT: mock_adapter}

        with patch("gateway.run._scout_home", scout_home):
            await runner._send_update_notification()

        mock_adapter.send.assert_called_once()
        call_args = mock_adapter.send.call_args
        assert call_args[0][0] == "67890"  # chat_id
        assert "Update complete" in call_args[0][1] or "update finished" in call_args[0][1].lower()


    @pytest.mark.asyncio
    async def test_drops_stale_marker_when_the_platform_never_connects(self, tmp_path, caplog):
        """A marker past the wait cap is abandoned instead of deferred forever.

        Regression: an update notice addressed to a platform that has no adapter —
        and never will, because the platform is not configured at all — kept its
        markers on disk and re-logged a deferred line on every poll. The startup
        path reschedules the watcher for as long as the markers exist, so the
        notice outlived every restart, in every process.
        """
        runner = _make_runner()
        scout_home = tmp_path / "scout"
        scout_home.mkdir()

        pending_path = scout_home / ".update_pending.json"
        pending_path.write_text(json.dumps({
            "platform": "homeassistant",
            "chat_id": "67890",
            "user_id": "12345",
            "timestamp": (datetime.now() - timedelta(hours=2)).isoformat(),
        }))
        (scout_home / ".update_exit_code").write_text("0")
        # runner.adapters stays empty: no adapter for the target platform, ever.

        with patch("gateway.run._scout_home", scout_home):
            result = await runner._send_update_notification()

        # True is the definitive answer the startup caller keys off to stop rescheduling.
        assert result is True
        assert not pending_path.exists()
        assert not (scout_home / ".update_pending.claimed.json").exists()
        assert not (scout_home / ".update_output.txt").exists()
        assert not (scout_home / ".update_exit_code").exists()
        assert any("adapter never connected" in r.getMessage() for r in caplog.records)

    @pytest.mark.asyncio
    async def test_keeps_waiting_for_a_recent_marker(self, tmp_path):
        """A recent marker is still held: the cap must not swallow its own notice.

        Right after the update's restart the adapter is legitimately absent for a
        while, which is the case the defer path exists to cover.
        """
        runner = _make_runner()
        scout_home = tmp_path / "scout"
        scout_home.mkdir()

        pending_path = scout_home / ".update_pending.json"
        pending_path.write_text(json.dumps({
            "platform": "homeassistant",
            "chat_id": "67890",
            "user_id": "12345",
            "timestamp": (datetime.now() - timedelta(minutes=5)).isoformat(),
        }))
        (scout_home / ".update_exit_code").write_text("0")

        with patch("gateway.run._scout_home", scout_home):
            result = await runner._send_update_notification()

        assert result is False
        assert pending_path.exists(), "marker kept so a later poll can still deliver it"


    @pytest.mark.asyncio
    async def test_cleans_up_on_error(self, tmp_path):
        """Files are cleaned up even if notification fails."""
        runner = _make_runner()
        scout_home = tmp_path / "scout"
        scout_home.mkdir()

        pending_path = scout_home / ".update_pending.json"
        output_path = scout_home / ".update_output.txt"
        exit_code_path = scout_home / ".update_exit_code"
        pending_path.write_text(json.dumps({
            "platform": "homeassistant", "chat_id": "111", "user_id": "222",
        }))
        output_path.write_text("✓ Done")
        exit_code_path.write_text("0")

        # Adapter send raises
        mock_adapter = AsyncMock()
        mock_adapter.send.side_effect = RuntimeError("network error")
        runner.adapters = {Platform.HOMEASSISTANT: mock_adapter}

        with patch("gateway.run._scout_home", scout_home):
            await runner._send_update_notification()

        # Files should still be cleaned up (finally block)
        assert not pending_path.exists()
        assert not output_path.exists()
        assert not exit_code_path.exists()



    @pytest.mark.asyncio
    async def test_deferred_notification_delivers_after_reconnect(self, tmp_path):
        """A deferred completion is delivered once the platform reconnects.

        Regression for the late-reconnect /update bug: the update finishes while
        the target platform is offline, the markers survive the deferral, and
        the next call (after the adapter is registered) delivers the result and
        cleans up — exactly once.
        """
        runner = _make_runner()
        scout_home = tmp_path / "scout"
        scout_home.mkdir()

        pending = {"platform": "homeassistant", "chat_id": "111", "user_id": "222"}
        pending_path = scout_home / ".update_pending.json"
        output_path = scout_home / ".update_output.txt"
        exit_code_path = scout_home / ".update_exit_code"
        pending_path.write_text(json.dumps(pending))
        output_path.write_text("✓ Update complete!")
        exit_code_path.write_text("0")

        # First pass: target platform (discord) is still offline → defer.
        with patch("gateway.run._scout_home", scout_home):
            first = await runner._send_update_notification()

        assert first is False
        assert pending_path.exists()

        # Platform reconnects: the reconnect watcher adds the adapter back.
        mock_adapter = AsyncMock()
        runner.adapters = {Platform.HOMEASSISTANT: mock_adapter}

        with patch("gateway.run._scout_home", scout_home):
            second = await runner._send_update_notification()

        assert second is True
        mock_adapter.send.assert_called_once()
        sent_text = mock_adapter.send.call_args[0][1]
        assert "Update complete" in sent_text
        # Now everything is cleaned up — no duplicate deliveries possible.
        assert not pending_path.exists()
        assert not output_path.exists()
        assert not exit_code_path.exists()
        assert not (scout_home / ".update_pending.claimed.json").exists()

    @pytest.mark.asyncio
    async def test_completion_notification_tolerates_invalid_utf8_output(self, tmp_path):
        """Completion-only update notifications must not crash on bad bytes."""
        runner = _make_runner()
        scout_home = tmp_path / "scout"
        scout_home.mkdir()

        pending = {"platform": "homeassistant", "chat_id": "111", "user_id": "222"}
        pending_path = scout_home / ".update_pending.json"
        output_path = scout_home / ".update_output.txt"
        exit_code_path = scout_home / ".update_exit_code"
        pending_path.write_text(json.dumps(pending))
        output_path.write_bytes(b"ok before\ninvalid byte: \x96\ncontinued after\n")
        exit_code_path.write_text("0")

        mock_adapter = AsyncMock()
        runner.adapters = {Platform.HOMEASSISTANT: mock_adapter}

        with patch("gateway.run._scout_home", scout_home):
            delivered = await runner._send_update_notification()

        assert delivered is True
        mock_adapter.send.assert_called_once()
        sent_text = mock_adapter.send.call_args[0][1]
        assert "ok before" in sent_text
        assert "invalid byte" in sent_text
        assert "continued after" in sent_text
        assert "Scout update finished" in sent_text
        assert not pending_path.exists()
        assert not output_path.exists()
        assert not exit_code_path.exists()


    @pytest.mark.asyncio
    async def test_failed_update_notice_says_still_running_and_trims_log(self, tmp_path):
        """A failed update must tell the chat the old version still runs and where to see the
        full error; the raw log is quoted only as a short tail, never the whole 3500-char dump."""
        runner = _make_runner()
        scout_home = tmp_path / "scout"
        scout_home.mkdir()
        (scout_home / ".update_pending.json").write_text(
            json.dumps({"platform": "homeassistant", "chat_id": "111", "user_id": "222"}))
        (scout_home / ".update_output.txt").write_text("x" * 3000 + "\nERROR: pip failed\n")
        (scout_home / ".update_exit_code").write_text("1")
        mock_adapter = AsyncMock()
        runner.adapters = {Platform.HOMEASSISTANT: mock_adapter}

        with patch("gateway.run._scout_home", scout_home):
            await runner._send_update_notification()

        sent_text = mock_adapter.send.call_args[0][1]
        assert "ERROR: pip failed" in sent_text
        assert len(sent_text) < 1200


# ---------------------------------------------------------------------------
# /update in help and known_commands
# ---------------------------------------------------------------------------



class TestWatchUpdateProgress:
    @pytest.mark.asyncio
    async def test_invalid_utf8_update_output_does_not_crash_watcher(self, tmp_path):
        runner = _make_runner()
        scout_home = tmp_path / "scout"
        scout_home.mkdir()

        (scout_home / ".update_pending.json").write_text(json.dumps({
            "platform": "homeassistant",
            "chat_id": "67890",
            "user_id": "12345",
        }))
        (scout_home / ".update_output.txt").write_bytes(
            b"ok before\n\xe2\x9c invalid-continuation: \x96\ncontinued after\n"
        )
        (scout_home / ".update_exit_code").write_text("0")

        mock_adapter = AsyncMock()
        runner.adapters = {Platform.HOMEASSISTANT: mock_adapter}

        with patch("gateway.run._scout_home", scout_home):
            await runner._watch_update_progress(poll_interval=0.01, stream_interval=0.01, timeout=1.0)

        sent = "\n".join(call.args[1] for call in mock_adapter.send.call_args_list)
        assert "ok before" in sent
        assert "continued after" in sent
        assert "Scout update finished" in sent
        assert not (scout_home / ".update_pending.json").exists()
# ---------------------------------------------------------------------------
# Install-method refusal gate
# ---------------------------------------------------------------------------


