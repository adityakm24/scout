"""User-authorization mixin for ``GatewayRunner``: may this user/chat talk to the agent,
the per-adapter DM policy, the unauthorized-DM behavior, and the bot loop guard.

``gateway.run`` is never imported at module import time (cycle).
"""

from __future__ import annotations

import contextlib
import logging
import threading
from pathlib import Path
from typing import Optional

from gateway.bot_loop_guard import BotLoopGuard
from gateway.config import Platform
from gateway.session import SessionSource

_GROUP_CHAT_TYPES = frozenset({"group", "forum", "channel"})
_TRUTHY = frozenset({"true", "1", "yes"})
_BOT_LOOP_GUARD_INIT_LOCK = threading.Lock()
logger = logging.getLogger(__name__)


# Gate reads use the shared per-profile isolated reader (allowlist leak under multiplex, #72348).
from gateway.platforms._shared import decode_json_list_literal as _decode_json_list_literal  # noqa: E402
from gateway.platforms._shared import platform_gate_env as _auth_env  # noqa: E402


def _env_truthy(name: str) -> bool:
    return _auth_env(name).lower() in _TRUTHY


def _registry_entry(platform):
    """Platform-registry entry for a (plugin) platform, or None."""
    if platform is None:
        return None
    with contextlib.suppress(Exception):
        from gateway.platform_registry import platform_registry

        return platform_registry.get(platform.value)
    return None


def _coerce_allow_set(raw) -> set[str]:
    """Parse an allowlist (YAML list, JSON list literal string, or comma-separated scalar) into a set of strings."""
    if raw is None:
        return set()
    raw = _decode_json_list_literal(raw)
    if isinstance(raw, list):
        return {str(part).strip() for part in raw if str(part).strip()}
    return {part.strip() for part in str(raw).split(",") if part.strip()}


def _allows(allowed: set[str], candidate: Optional[str]) -> bool:
    return "*" in allowed or candidate in allowed


def _adapter_config_extra(adapter) -> dict:
    return getattr(getattr(adapter, "config", None), "extra", None) or {}


class GatewayAuthorizationMixin:
    """User/chat authorization methods for ``GatewayRunner``."""

    # ``getattr(self, ...)`` throughout: test helpers build bare runners via ``object.__new__``
    # without ``adapters`` / ``config``.

    def _primary_adapters(self) -> dict:
        return getattr(self, "adapters", None) or {}

    def _profile_adapters_map(self) -> dict:
        return getattr(self, "_profile_adapters", None) or {}

    def _authorization_adapter(self, platform: Optional[Platform], profile: Optional[str] = None):
        """Live adapter whose intake policy gates authorization (``_adapters_for_profile`` for the
        profile rule). ``None`` when the profile has no adapter for *platform*.
        """
        if not platform:
            return None
        return self._adapters_for_profile(profile).get(platform)

    def _adapters_for_profile(self, profile: Optional[str]) -> dict:
        """The live adapter map *profile* may deliver through: ``_profile_adapters[p]`` for a
        secondary, ``self.adapters`` only for the primary/default. ``_profile_adapters`` is consulted
        BEFORE the active profile name: multiplex turns override ``SCOUT_HOME`` so
        ``_active_profile_name()`` reports the secondary profile mid-turn, and treating it as primary
        would hand it the default bot. A named profile with no map gets ``{}`` — fail closed: a
        secondary whose adapter failed to connect must NOT fall back to the default profile's adapter
        (replies, tool sends, marker-file notices out the wrong bot)."""
        profile_name = (profile or "").strip() or None
        if not profile_name or profile_name == "default":
            return self._primary_adapters()
        profile_adapters = self._profile_adapters_map()
        if profile_name in profile_adapters:
            adapters = profile_adapters[profile_name]
            if adapters or not self._is_shared_bot_satellite(profile_name):
                return adapters
            return self._primary_adapters()
        # Identity captured at construction, not the per-turn SCOUT_HOME-derived name.
        primary_profile = getattr(self, "_primary_profile_name", None)
        if not primary_profile:
            with contextlib.suppress(Exception):
                primary_profile = self._active_profile_name()
        return self._primary_adapters() if profile_name == primary_profile else {}

    def _is_shared_bot_satellite(self, profile_name: str) -> bool:
        """A served profile with NO adapter of its own that a ``profile_routes`` entry targets through the
        default profile's bot: it drains through the primary's adapters (gateway/AGENTS.md). Its
        ``_profile_adapters`` entry is the ``{}`` startup placeholder; a secondary connected on ANY
        platform is its own credential boundary and never borrows the primary. Restored/cached sources
        carry no transport ref, so this is what keeps heartbeats, completions and goal notices for such a
        profile deliverable after a restart (the same rule ``kanban_watchers_notifier`` and cron apply)."""
        config = getattr(self, "config", None)
        if not getattr(config, "multiplex_profiles", False):
            return False
        # A bot that failed to connect is queued for reconnect: that profile owns a credential.
        if (getattr(self, "_profile_failed_platforms", None) or {}).get(profile_name):
            return False
        routes = getattr(config, "profile_routes", None) or []
        if not any(r.enabled and r.profile == profile_name and r.bot_profile is None for r in routes):
            return False
        from gateway.run import _multiplex_profile_homes
        try:
            return profile_name in {name for name, _home in _multiplex_profile_homes(config)}
        except Exception:
            return False

    def _intake_adapter_for(self, source: Optional[SessionSource]):
        """The adapter that RECEIVED *source*'s event — the only one whose intake policy (ignored
        channels, re-dispatch of a still-live event) may act on it.

        Live provenance only: the registered transport that built the source, or the receiving bot
        named by a pinned ``RoutingIdentity`` (``transport_profile``) when its adapter reconnected. A source with none
        of these (restored row, hand-built) fails closed under multiplexing — nothing can say which
        bot admitted it, and guessing the runtime profile's bot is exactly the shared-bot /
        route-override confusion the identity exists to end. A standalone gateway owns one adapter
        per platform, so that adapter is the receiver by construction.
        """
        if source is None:
            return None
        owner = self._transport_owner(source)
        if owner is not None:
            return owner[0]
        platform = getattr(source, "platform", None)
        from gateway.session_identity import identity_of
        identity = identity_of(source)
        if identity is not None and identity.multiplexed:
            return self._adapters_for_profile(identity.transport_profile).get(platform) if platform else None
        if not getattr(getattr(self, "config", None), "multiplex_profiles", False):
            return self._primary_adapters().get(platform) if platform else None
        return None

    def _delivery_adapter_for(self, source: Optional[SessionSource]):
        """The adapter that ANSWERS *source*: sends, edits, typing, progress, pickers, pending slots.

        The receiving bot whenever it is known (:meth:`_intake_adapter_for` — a routed event replies
        through the bot that received it, whether the runtime is a shared-bot satellite or a profile
        with a bot of its own). With no live provenance the unique owner of ``(platform,
        runtime_profile)`` delivers — ``_adapters_for_profile`` holds one adapter per platform per
        profile, a shared-bot satellite drains through the primary, and a disconnected secondary
        fails closed to ``{}`` rather than borrowing the default bot. Restored sessions, cron,
        kanban and completion notices all rely on this row. Matrix: gateway/AGENTS.md § Profile scope.
        """
        if source is None:
            return None
        adapter = self._intake_adapter_for(source)
        if adapter is not None:
            return adapter
        # A pinned identity NAMES the receiving bot (live or restored from ``transport_profile``).
        # If that bot has no adapter right now it is offline: fail closed rather than fall through to
        # the runtime profile's bot — that fallthrough is the "restored lane answers from the wrong
        # bot" row the identity exists to close. Only an identity-less source (legacy row, bare
        # fixture) uses the unique-owner heuristic below.
        from gateway.session_identity import identity_of
        identity = identity_of(source)
        if identity is not None and identity.multiplexed and not identity.transport_inferred:
            return None
        # No identity, or one whose transport was only inferred (hand-built source, pre-column row):
        # the unique owner of ``(platform, runtime_profile)`` delivers.
        # ``getattr``: test fixtures build bare SimpleNamespace sources without ``profile``.
        return self._authorization_adapter(getattr(source, "platform", None), getattr(source, "profile", None))

    def _owning_profile(self, adapter, platform):
        """Return (registered, profile) for a live adapter: profile is None for primary."""
        if adapter is self._primary_adapters().get(platform):
            return True, None
        for profile, profile_adapters in self._profile_adapters_map().items():
            if adapter is profile_adapters.get(platform):
                return True, profile
        return False, None

    def _transport_owner(self, source: SessionSource):
        """``(adapter, profile)`` of the registered adapter that created *source*, if retained; else None.

        ``source.profile`` may differ from the adapter profile when one shared credential serves
        several routed runtimes; ``build_source`` keeps the receiving adapter as provenance so replies
        stay on that transport. Restored/hand-built sources fall back (fail-closed) to profile lookup.
        """
        adapter_ref = getattr(source, "_transport_adapter_ref", None)
        adapter = adapter_ref() if callable(adapter_ref) else None
        platform = getattr(source, "platform", None)
        if adapter is None or platform is None:
            return None
        registered, profile = self._owning_profile(adapter, platform)
        return (adapter, profile) if registered else None

    def _authorization_home_for_source(self, source: SessionSource):
        """SCOUT_HOME whose allowlist admits *source*: the identity's transport home (or the
        ingress-stamped one), else the home of the profile owning the adapter that delivers it.
        ``None`` = authorize in the ambient scope (multiplex off, or no live adapter — the check then
        fails closed on its own).

        Inside a routed satellite's turn the ambient scope is the satellite's, whose ``.env`` has no
        token/allowlist; every authorization decision made mid-turn (``/topic``, sibling ``/stop``, plugin
        injection, voice, auto-resume) must read the admitting bot's allowlist instead."""
        from gateway.session_identity import identity_of
        identity = identity_of(source)
        if identity is not None:
            return identity.authorization_home if identity.multiplexed else None
        stamped = getattr(source, "_authorization_profile_home", None)
        if stamped is not None:
            return Path(stamped)
        if not getattr(getattr(self, "config", None), "multiplex_profiles", False):
            return None
        # A restored/hand-built source is admitted by the bot that will answer it (auto-resume,
        # plugin injection) — the same unique-owner row delivery uses.
        adapter = self._delivery_adapter_for(source)
        if adapter is None:
            return None
        _registered, profile = self._owning_profile(adapter, getattr(source, "platform", None))
        if profile is None:
            from scout_constants import get_process_scout_home
            return get_process_scout_home()  # the primary bot's home, never the per-turn override
        from scout_backend.profiles import get_profile_dir
        return get_profile_dir(profile)

    def _adapter_profile_for_source(self, source: SessionSource) -> Optional[str]:
        """Resolve the transport-owning profile for adapter policy lookups."""
        owner = self._transport_owner(source)
        if owner is not None:
            return owner[1]
        from gateway.session_identity import identity_of
        identity = identity_of(source)
        if identity is not None and identity.multiplexed:
            return None if identity.transport_profile == "default" else identity.transport_profile
        return getattr(source, "profile", None)

    def _restored_source(self, entry) -> Optional[SessionSource]:
        """``entry.origin`` with its identity re-pinned from the routing entry's persisted
        ``transport_profile`` (no live adapter: the restored row of the transport matrix). Every path
        that revives a session from durable state — auto-resume, heartbeat restore, plugin injection,
        background-process events — reads the origin through here, so the receiving bot decides
        delivery and authorization after a restart, not the runtime profile's heuristics."""
        source = getattr(entry, "origin", None)
        if source is None:
            return None
        from gateway.session_identity import restore_identity
        restore_identity(source, runner=self, transport_profile=getattr(entry, "transport_profile", None))
        return source

    def _adapter_flag(self, platform, name: str, profile) -> bool:
        """Adapter-declared boolean, False when unknown. ``authorization_is_upstream`` (A2A: a trusted
        authenticated upstream decides) is honored directly; ``enforces_own_access_policy`` (adapters
        that gate at intake) is NOT "already authorized" — such adapters may default to ``open``, so
        ``_is_user_authorized`` only trusts them under an actual ``allowlist`` policy."""
        if not platform:
            return False
        adapter = self._authorization_adapter(platform, profile)
        return adapter is not None and bool(getattr(adapter, name, False))

    def _config_extra(self, platform) -> dict:
        """``config.platforms[platform].extra`` as a dict ({} when absent)."""
        platforms = getattr(getattr(self, "config", None), "platforms", None)
        extra = getattr(platforms.get(platform), "extra", None) if platforms is not None else None
        return extra if isinstance(extra, dict) else {}

    def _adapter_setting(self, platform, attr: str, extra_key: str, profile):
        """Live adapter's resolved ``attr`` (folds in the ``<PLATFORM>_*`` env override),
        else ``config.extra[extra_key]`` for bare runners with no adapter."""
        adapter = self._authorization_adapter(platform, profile)
        value = getattr(adapter, attr, None) if adapter is not None else None
        if value is None:
            value = self._config_extra(platform).get(extra_key)
        return value

    def _adapter_policy(self, platform, kind: str, profile) -> str:
        """Lowercased effective ``dm_policy`` (open/allowlist/disabled/pairing) or ``group_policy``
        (open/allowlist/disabled) for *kind* in {"dm", "group"}; ``""`` if unknown."""
        if not platform:
            return ""
        return str(self._adapter_setting(platform, f"_{kind}_policy", f"{kind}_policy", profile) or "").strip().lower()

    def _adapter_extra_for_source(self, source) -> dict:
        return _adapter_config_extra(self._delivery_adapter_for(source))

    def _own_policy_authorizes(self, source, user_id, is_group, adapter_profile) -> Optional[bool]:
        """Own-policy adapter verdict when no env allowlist exists; None = no verdict.

        Trusted only when the effective policy for THIS chat type is ``allowlist``: ``open`` forwards
        EVERY sender (the fail-open SECURITY.md §2.6 forbids) and ``disabled`` never forwards.
        Anything else → default-deny.
        """
        if self._adapter_policy(source.platform, "group" if is_group else "dm", adapter_profile) != "allowlist":
            return None
        # Re-check DMs via the live adapter's ``_is_dm_allowed`` when present, so a revoked entry
        # stops authorizing without a restart.
        if not is_group:
            adapter = self._authorization_adapter(source.platform, profile=adapter_profile)
            dm_check = getattr(adapter, "_is_dm_allowed", None) if adapter is not None else None
            if callable(dm_check):
                return bool(dm_check(user_id))
        return True

    def _adapter_extra_allowlist_authorizes(self, source, user_id, is_group) -> bool:
        """Adapters that gate via config.extra.allow_from / group_allow_from without setting
        enforces_own_access_policy."""
        adapter = self._delivery_adapter_for(source)
        if adapter is None:
            return False
        extra = _adapter_config_extra(adapter)
        adapter_allow = extra.get("group_allow_from" if is_group else "allow_from")
        if not adapter_allow:
            # Plugin platforms spell their env allowlist as ``extra.allowed_users``; under multiplex
            # only the default profile's list reaches the env (first-writer-wins bridge), so read the
            # live adapter's (#82871, #98738).
            entry = _registry_entry(source.platform)
            if entry and entry.allowed_users_env:
                adapter_allow = extra.get("allowed_users")
        if not adapter_allow:
            return False
        allowed = _coerce_allow_set(adapter_allow)
        normalize = getattr(adapter, "normalize_user_id", None)
        if callable(normalize):
            # Ids and entries may spell the same principal differently.
            allowed = {normalize(entry) or entry for entry in allowed}
        return _allows(allowed, user_id)

    def _chat_scoped_grant(self, source, adapter_profile, is_group: bool, allow_adapter_delegation: bool) -> bool:
        """Grants that need no ``user_id`` (checked before the no-user-id guard)."""
        # Trusted-upstream delegation: an adapter declaring ``authorization_is_upstream`` (A2A)
        # authenticates its peer before delivering. ``is True``-style flag read: a MagicMock stand-in
        # must not auto-truthy into authz.
        if allow_adapter_delegation and self._adapter_flag(
                source.platform, "authorization_is_upstream", adapter_profile):
            return True
        # Chat-scoped group allowlist (``extra.group_allowed_chats``) must work with ``user_id is
        # None`` (anonymous posts, channel broadcasts).
        if is_group and source.chat_id:
            with contextlib.suppress(Exception):
                adapter_group_allowed = self._adapter_extra_for_source(source).get("group_allowed_chats")
                if adapter_group_allowed and _allows(_coerce_allow_set(adapter_group_allowed), source.chat_id):
                    return True
        return False

    def _bot_loop_guard_instance(self) -> BotLoopGuard:
        guard = getattr(self, "_bot_loop_guard", None)
        if guard is None:
            with _BOT_LOOP_GUARD_INIT_LOCK:
                guard = getattr(self, "_bot_loop_guard", None)
                if guard is None:
                    guard = self._bot_loop_guard = BotLoopGuard()
        return guard

    def _bot_loop_guard_conversation(self, source: SessionSource) -> tuple:
        # One budget per conversation, not per sender pair: a per-pair key would hand N bots N budgets.
        platform = source.platform.value if source.platform else ""
        return (self._adapter_profile_for_source(source) or "", platform, str(source.chat_id or ""))

    def _admit_bot_message(self, source: SessionSource) -> bool:
        """Count one authorized bot-authored inbound message. False when it trips the budget or the chat is cooling down.
        The inbound handler calls this once per message; ``_is_user_authorized`` only peeks because it is asked several times."""
        if not getattr(source, "is_bot", False):
            return True
        allowed, state = self._bot_loop_guard_instance().admit(self._bot_loop_guard_conversation(source))
        if state == "tripped":
            logger.warning(
                "Bot loop guard is dropping bot messages in %s chat %s: bot %s sent one message too many "
                "for the window, cooling down (gateway.bot_loop_guard in config.yaml).",
                source.platform.value if source.platform else "", source.chat_id, source.user_id,
            )
        return allowed

    def _is_user_authorized(self, source: SessionSource, *, allow_adapter_delegation: bool = True) -> bool:
        """Whether a user may use the bot.

        Order: trusted-upstream delegation, chat-scoped group allowlists, ``{PLATFORM}_ALLOW_BOTS``,
        per-platform allow-all, adapter role auth, pairing store, env/config allowlists,
        ``GATEWAY_ALLOW_ALL_USERS``, default deny. A bot-authored message that any of these admits
        is still refused while its chat's loop guard is cooling down.
        """
        if not self._principal_authorized(source, allow_adapter_delegation=allow_adapter_delegation):
            return False
        if not getattr(source, "is_bot", False):
            return True
        # The guard judges the final verdict: a chat allowlist admits a bot before the ALLOW_BOTS block runs.
        return not self._bot_loop_guard_instance().blocked(self._bot_loop_guard_conversation(source))

    def _principal_authorized(self, source: SessionSource, *, allow_adapter_delegation: bool) -> bool:
        """The allowlist verdict alone, before the bot loop guard."""
        # HA events are system-generated (HASS_TOKEN); webhook events are HMAC-verified.
        if source.platform in {Platform.HOMEASSISTANT, Platform.WEBHOOK}:
            return True

        adapter_profile = self._adapter_profile_for_source(source)
        is_group = source.chat_type in _GROUP_CHAT_TYPES
        if self._chat_scoped_grant(source, adapter_profile, is_group, allow_adapter_delegation):
            return True
        user_id = source.user_id
        if not user_id:
            return False

        entry = _registry_entry(source.platform)
        platform_allow_env = getattr(entry, "allowed_users_env", "") or ""
        platform_allow_all_var = getattr(entry, "allow_all_env", "") or ""
        if platform_allow_all_var and _env_truthy(platform_allow_all_var):
            return True

        platform_allowlist = _auth_env(platform_allow_env) if platform_allow_env else ""
        global_allowlist = _auth_env("GATEWAY_ALLOWED_USERS")
        if not (platform_allowlist or global_allowlist):
            # No env allowlist: own-policy adapters gate at intake (see _own_policy_authorizes).
            if allow_adapter_delegation and self._adapter_flag(source.platform, "enforces_own_access_policy", adapter_profile):
                verdict = self._own_policy_authorizes(source, user_id, is_group, adapter_profile)
                if verdict is not None:
                    return verdict
            if self._adapter_extra_allowlist_authorizes(source, user_id, is_group):
                return True
            return _env_truthy("GATEWAY_ALLOW_ALL_USERS")

        allowed_ids = _coerce_allow_set(platform_allowlist) | _coerce_allow_set(global_allowlist)
        return _allows(allowed_ids, user_id)
