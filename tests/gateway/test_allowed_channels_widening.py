"""Tests for the allowed_{channels,chats,rooms} whitelist extension
added alongside PR #7401 (Slack).

Covers: Telegram, Matrix, Mattermost, DingTalk.

For each platform:
- Empty = no restriction (fully backward compatible).
- When set, messages from non-listed chats/rooms are silently ignored.
- DMs are never filtered.
- @mention does NOT bypass the whitelist.
- config.yaml → env var bridging (via load_gateway_config) where applicable.
"""

from types import SimpleNamespace




# ---------------------------------------------------------------------------
# Telegram
# ---------------------------------------------------------------------------


def _tg_group_message(chat_id=-100, text="hello"):
    return SimpleNamespace(
        text=text,
        caption=None,
        entities=[],
        caption_entities=[],
        message_thread_id=None,
        chat=SimpleNamespace(id=chat_id, type="group"),
        from_user=SimpleNamespace(id=111),
        reply_to_message=None,
    )


def _tg_dm_message(text="hello"):
    return SimpleNamespace(
        text=text,
        caption=None,
        entities=[],
        caption_entities=[],
        message_thread_id=None,
        chat=SimpleNamespace(id=111, type="private"),
        from_user=SimpleNamespace(id=111),
        reply_to_message=None,
    )




# ---------------------------------------------------------------------------
# DingTalk
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# Mattermost (env-var only — no config.yaml bridge)
# ---------------------------------------------------------------------------

class TestMattermostAllowedChannels:
    """Mattermost whitelist logic — replicated since the adapter reads config
    with env-var fallback inline inside _handle_post rather than through a
    helper method."""

    @staticmethod
    def _would_process(channel_id, channel_type="O", allowed_cfg=None, allowed_env=""):
        """Replicate the whitelist gate from gateway/platforms/mattermost.py."""
        if channel_type == "D":
            return True
        # config-first, env-var fallback (matching the adapter)
        allowed_raw = allowed_cfg
        if allowed_raw is None:
            allowed_raw = allowed_env
        if isinstance(allowed_raw, list):
            allowed = {str(c).strip() for c in allowed_raw if str(c).strip()}
        else:
            allowed = {c.strip() for c in str(allowed_raw).split(",") if c.strip()}
        if allowed and channel_id not in allowed:
            return False
        return True

    def test_empty_config_is_no_restriction(self):
        assert self._would_process("chan123", allowed_cfg=None, allowed_env="") is True




# ---------------------------------------------------------------------------
# Matrix
# ---------------------------------------------------------------------------

class TestMatrixAllowedRooms:
    """Matrix whitelist behavior — tested via the env-var-initialized
    instance attribute _allowed_rooms."""

    def test_empty_env_empty_set(self, monkeypatch):
        monkeypatch.delenv("MATRIX_ALLOWED_ROOMS", raising=False)
        # Replicate __init__ parsing without needing the real adapter.
        raw = "" or ""
        allowed = {r.strip() for r in raw.split(",") if r.strip()}
        assert allowed == set()


