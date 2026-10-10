"""Shared platform registry for Scout Agent."""

from collections import OrderedDict
from typing import NamedTuple


class PlatformInfo(NamedTuple):
    """Metadata for a single platform entry."""
    label: str
    default_toolset: str


# Ordered so that TUI menus are deterministic.
PLATFORMS: OrderedDict[str, PlatformInfo] = OrderedDict([
    ("cli",            PlatformInfo(label="🖥️  CLI",            default_toolset="scout-cli")),
    ("telegram",       PlatformInfo(label="📱 Telegram",        default_toolset="scout-telegram")),
    ("discord",        PlatformInfo(label="💬 Discord",         default_toolset="scout-discord")),
    ("slack",          PlatformInfo(label="💼 Slack",           default_toolset="scout-slack")),
    ("whatsapp",       PlatformInfo(label="📱 WhatsApp",        default_toolset="scout-whatsapp")),
    ("whatsapp_cloud", PlatformInfo(label="📱 WhatsApp Business (Cloud)", default_toolset="scout-whatsapp")),
    ("signal",         PlatformInfo(label="📡 Signal",          default_toolset="scout-signal")),
    ("bluebubbles",    PlatformInfo(label="💙 BlueBubbles",     default_toolset="scout-bluebubbles")),
    ("email",          PlatformInfo(label="📧 Email",           default_toolset="scout-email")),
    ("homeassistant",  PlatformInfo(label="🏠 Home Assistant",  default_toolset="scout-homeassistant")),
    ("mattermost",     PlatformInfo(label="💬 Mattermost",      default_toolset="scout-mattermost")),
    ("matrix",         PlatformInfo(label="💬 Matrix",          default_toolset="scout-matrix")),
    ("dingtalk",       PlatformInfo(label="💬 DingTalk",        default_toolset="scout-dingtalk")),
    ("feishu",         PlatformInfo(label="🪽 Feishu",          default_toolset="scout-feishu")),
    ("wecom",          PlatformInfo(label="💬 WeCom",           default_toolset="scout-wecom")),
    ("wecom_callback", PlatformInfo(label="💬 WeCom Callback",  default_toolset="scout-wecom-callback")),
    ("weixin",         PlatformInfo(label="💬 Weixin",          default_toolset="scout-weixin")),
    ("qqbot",          PlatformInfo(label="💬 QQBot",           default_toolset="scout-qqbot")),
    ("yuanbao",        PlatformInfo(label="🤖 Yuanbao",         default_toolset="scout-yuanbao")),
    ("webhook",        PlatformInfo(label="🔗 Webhook",         default_toolset="scout-webhook")),
    ("api_server",     PlatformInfo(label="🌐 API Server",      default_toolset="scout-api-server")),
    ("cron",           PlatformInfo(label="⏰ Cron",            default_toolset="scout-cron")),
])


def _plugin_label(entry) -> str:
    return f"{entry.emoji}  {entry.label}" if entry.emoji else entry.label


def platform_label(key: str, default: str = "") -> str:
    """Return the display label for a platform key (builtin, then plugin registry), or *default*."""
    info = PLATFORMS.get(key)
    if info is not None:
        return info.label
    try:
        from gateway.platform_registry import platform_registry
        entry = platform_registry.get(key)
        if entry:
            return _plugin_label(entry)
    except Exception:
        pass
    return default


def get_all_platforms() -> "OrderedDict[str, PlatformInfo]":
    """PLATFORMS plus plugin-registered platforms (appended after builtins) — use for menus."""
    merged = OrderedDict(PLATFORMS)
    try:
        from gateway.platform_registry import platform_registry
        for entry in platform_registry.plugin_entries():
            if entry.name not in merged:
                merged[entry.name] = PlatformInfo(_plugin_label(entry), f"scout-{entry.name}")
    except Exception:
        pass
    return merged
