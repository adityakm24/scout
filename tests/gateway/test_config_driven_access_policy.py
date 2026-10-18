"""Tests for config-driven platform access policies at the gateway layer.

Background (#34515): WeCom, Weixin, Yuanbao, QQBot, and WhatsApp expose a
documented config-driven access surface (``dm_policy`` / ``group_policy`` /
``allow_from`` / ``group_allow_from`` in ``PlatformConfig.extra``) and enforce
it at intake —
a message is dropped inside the adapter and never reaches the gateway unless it
already passed that policy.

The gateway's env-based allowlist check (``_is_user_authorized``) runs *after*
the adapter. Adapters that own their access policy declare
``enforces_own_access_policy`` (a ``BasePlatformAdapter`` property, default
``False``) so the gateway can honor a config-only ``dm_policy: allowlist`` /
``allow_from`` (which the adapter already enforced) instead of double-denying it
when no ``PLATFORM_ALLOWED_USERS`` env var is set.

Crucially, the flag is NOT a blanket "already authorized" pass. These adapters
default ``dm_policy`` / ``group_policy`` to ``"open"``, which forwards *every*
sender, so the gateway trusts the adapter only when its effective policy for the
chat type is an actual ``"allowlist"`` restriction. Trusting ``"open"`` here
admitted the whole external network with no operator-configured allowlist — the
fail-open SECURITY.md §2.6 forbids for network-exposed adapters ("an allowlist
is required for every enabled network-exposed adapter ... code paths that fail
open when no allowlist is configured are code bugs"). Open access requires an
explicit ``{PLATFORM}_ALLOW_ALL_USERS`` / ``GATEWAY_ALLOW_ALL_USERS`` opt-in.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from gateway.config import GatewayConfig, Platform, PlatformConfig
from gateway.session import SessionSource


# Platforms whose adapters own their access policy at intake.
_OWN_POLICY_PLATFORMS = [
    Platform.HOMEASSISTANT,
    Platform.HOMEASSISTANT,
    Platform.HOMEASSISTANT,
    Platform.HOMEASSISTANT,
    Platform.HOMEASSISTANT,
]


def _clear_auth_env(monkeypatch) -> None:
    for key in (
        "WECOM_ALLOWED_USERS",
        "WEIXIN_ALLOWED_USERS",
        "YUANBAO_ALLOWED_USERS",
        "QQ_ALLOWED_USERS",
        "QQ_GROUP_ALLOWED_USERS",
        "WHATSAPP_ALLOWED_USERS",
        "TELEGRAM_ALLOWED_USERS",
        "GATEWAY_ALLOWED_USERS",
        "GATEWAY_ALLOW_ALL_USERS",
        "WECOM_ALLOW_ALL_USERS",
        "WEIXIN_ALLOW_ALL_USERS",
        "YUANBAO_ALLOW_ALL_USERS",
        "QQ_ALLOW_ALL_USERS",
        "WHATSAPP_ALLOW_ALL_USERS",
    ):
        monkeypatch.delenv(key, raising=False)


def _make_runner(platform: Platform, config: GatewayConfig, *, enforces: bool):
    """Build a bare GatewayRunner with one adapter for *platform*.

    ``enforces`` controls whether the adapter declares
    ``enforces_own_access_policy`` — i.e. whether it owns its access gate.
    """
    from gateway.run import GatewayRunner

    runner = object.__new__(GatewayRunner)
    runner.config = config
    adapter = SimpleNamespace(send=AsyncMock(), enforces_own_access_policy=enforces)
    runner.adapters = {platform: adapter}
    runner.pairing_store = MagicMock()
    runner.pairing_store.is_approved.return_value = False
    runner.pairing_store._is_rate_limited.return_value = False
    return runner, adapter


def _source(platform: Platform, *, chat_type: str = "dm") -> SessionSource:
    return SessionSource(
        platform=platform,
        user_id="some-user",
        chat_id="some-chat",
        user_name="tester",
        chat_type=chat_type,
    )


# ---------------------------------------------------------------------------
# Layer 1: the base-class contract and per-adapter overrides
# ---------------------------------------------------------------------------


def test_base_adapter_defaults_to_not_owning_access_policy():
    """Adapters that don't override the property delegate to the gateway."""
    from gateway.platforms.base import BasePlatformAdapter

    # The default lives on the base property descriptor.
    assert BasePlatformAdapter.enforces_own_access_policy.fget(object()) is False


# ---------------------------------------------------------------------------
# Layer 2: gateway trusts the adapter-enforced flag
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("platform", _OWN_POLICY_PLATFORMS)
def test_own_policy_allowlist_authorized_without_env_allowlist(monkeypatch, platform):
    """A config-only ``dm_policy: allowlist`` is trusted without an env allowlist.

    The adapter only forwards an allowlisted sender under ``allowlist`` policy,
    so a message reaching the gateway *was* authorized for this specific sender.
    The gateway must honor that instead of double-denying (the #34515 case).
    """
    _clear_auth_env(monkeypatch)
    config = GatewayConfig(
        platforms={platform: PlatformConfig(enabled=True, extra={"dm_policy": "allowlist"})}
    )
    runner, _adapter = _make_runner(platform, config, enforces=True)

    assert runner._is_user_authorized(_source(platform)) is True




@pytest.mark.parametrize("platform", _OWN_POLICY_PLATFORMS)
def test_own_policy_open_dm_authorized_with_gateway_allow_all(monkeypatch, platform):
    """Explicit ``GATEWAY_ALLOW_ALL_USERS`` unlocks ``dm_policy: open``."""
    _clear_auth_env(monkeypatch)
    monkeypatch.setenv("GATEWAY_ALLOW_ALL_USERS", "true")
    config = GatewayConfig(
        platforms={platform: PlatformConfig(enabled=True, extra={"dm_policy": "open"})}
    )
    runner, _adapter = _make_runner(platform, config, enforces=True)

    assert runner._is_user_authorized(_source(platform)) is True






@pytest.mark.parametrize("platform", _OWN_POLICY_PLATFORMS)
def test_own_policy_allowlist_authorized_for_group_chat(monkeypatch, platform):
    """A config-only ``group_policy: allowlist`` is trusted for group traffic."""
    _clear_auth_env(monkeypatch)
    config = GatewayConfig(
        platforms={platform: PlatformConfig(enabled=True, extra={"group_policy": "allowlist"})}
    )
    runner, _adapter = _make_runner(platform, config, enforces=True)

    assert runner._is_user_authorized(_source(platform, chat_type="group")) is True






def test_wecom_open_group_with_per_group_sender_allowlist_is_authorized(monkeypatch):
    """WeCom ``groups.<id>.allow_from`` is an adapter-enforced restriction.

    The top-level group policy is still ``open`` for the chat ID, but the
    adapter has already checked the sender allowlist before dispatching to the
    gateway. That is not the fail-open case and must not be double-denied.
    """
    _clear_auth_env(monkeypatch)
    config = GatewayConfig(
        platforms={
            Platform.HOMEASSISTANT: PlatformConfig(
                enabled=True,
                extra={
                    "group_policy": "open",
                    "groups": {"some-chat": {"allow_from": ["some-user"]}},
                },
            )
        }
    )
    runner, _adapter = _make_runner(Platform.HOMEASSISTANT, config, enforces=True)

    assert runner._is_user_authorized(_source(Platform.HOMEASSISTANT, chat_type="group")) is True


# ---------------------------------------------------------------------------
# Layer 2b: `dm_policy: pairing` is NOT blanket-trusted
# ---------------------------------------------------------------------------
#
# Regression: WeCom/Weixin document ``dm_policy: pairing`` and declare
# ``enforces_own_access_policy=True``, but their intake helper only special-cases
# ``disabled`` / ``allowlist`` — ``pairing`` falls through and forwards the DM so
# the gateway can run its pairing handshake. With no env allowlist, the
# adapter-trust shortcut above then authorized *every* unpaired sender, silently
# degrading pairing mode to open access. The shortcut must skip pairing-mode DMs
# so an unpaired sender falls through to default-deny (and gets a pairing code).


# ---------------------------------------------------------------------------
# Layer 3: unauthorized-DM behavior reads config dm_policy
# ---------------------------------------------------------------------------




