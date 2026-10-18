"""Tests for text message batching across all gateway adapters.

When a user sends a long message, the messaging client splits it at the
platform's character limit.  Each adapter should buffer rapid successive
text messages from the same session and aggregate them before dispatching.

Covers: Discord, Matrix, WeCom, and the adaptive delay logic for
Telegram and Feishu.
"""



from gateway.config import Platform
from gateway.platforms.base import SessionSource
from gateway.platforms.event import MessageEvent, MessageType


# =====================================================================
# Helpers
# =====================================================================

def _make_event(
    text: str,
    platform: Platform,
    chat_id: str = "12345",
    msg_type: MessageType = MessageType.TEXT,
) -> MessageEvent:
    return MessageEvent(
        text=text,
        message_type=msg_type,
        source=SessionSource(platform=platform, chat_id=chat_id, chat_type="dm"),
    )


# =====================================================================
# Discord text batching
# =====================================================================


# =====================================================================
# Matrix text batching
# =====================================================================


# =====================================================================
# WeCom text batching
# =====================================================================


