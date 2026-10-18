"""Tests for the central command registry and autocomplete."""

from prompt_toolkit.completion import CompleteEvent
from prompt_toolkit.document import Document

from scout_cli.commands import COMMAND_REGISTRY, COMMANDS_BY_CATEGORY, CommandDef, GATEWAY_KNOWN_COMMANDS, gateway_help_lines, infer_argument_mode, resolve_command
from scout_cli.commands_completion import SlashCommandAutoSuggest, SlashCommandCompleter


def _completions(completer: SlashCommandCompleter, text: str):
    return list(
        completer.get_completions(
            Document(text=text),
            CompleteEvent(completion_requested=True),
        )
    )


# ---------------------------------------------------------------------------
# CommandDef registry tests
# ---------------------------------------------------------------------------

class TestCommandRegistry:


    def test_no_duplicate_canonical_names(self):
        names = [cmd.name for cmd in COMMAND_REGISTRY]
        assert len(names) == len(set(names)), f"Duplicate names: {[n for n in names if names.count(n) > 1]}"

    def test_no_alias_collides_with_canonical_name(self):
        """An alias must not shadow another command's canonical name."""
        canonical_names = {cmd.name for cmd in COMMAND_REGISTRY}
        for cmd in COMMAND_REGISTRY:
            for alias in cmd.aliases:
                if alias in canonical_names:
                    # reset -> new is intentional (reset IS an alias for new)
                    target = next(c for c in COMMAND_REGISTRY if c.name == alias)
                    # This should only happen if the alias points to the same entry
                    assert resolve_command(alias).name == cmd.name or alias == cmd.name, \
                        f"Alias '{alias}' of '{cmd.name}' shadows canonical '{target.name}'"


    def test_argument_mode_infers_text_from_any_args_hint(self):
        assert infer_argument_mode(CommandDef("demo", "Demo", "Session", args_hint="<prompt>")) == "text"
        assert infer_argument_mode(CommandDef("ask", "Ask", "Session", args_hint="<query>")) == "text"
        assert infer_argument_mode(CommandDef("note", "Note", "Session", args_hint="[message]")) == "text"


# ---------------------------------------------------------------------------
# resolve_command tests
# ---------------------------------------------------------------------------

class TestResolveCommandAliases:
    """One-letter aliases resolve to their command, never a longer canonical
    (exact lookup treats the alias as a full name — /s is not a /sessions prefix)."""

    def test_q_resolves_to_queue(self):
        cmd = resolve_command("q")
        assert cmd is not None and cmd.name == "queue"

    def test_s_resolves_to_steer(self):
        cmd = resolve_command("s")
        assert cmd is not None and cmd.name == "steer"

    def test_exact_names_still_win_over_the_alias(self):
        cmd = resolve_command("sessions")
        assert cmd is not None and cmd.name == "sessions"
        cmd = resolve_command("steer")
        assert cmd is not None and cmd.name == "steer"


# ---------------------------------------------------------------------------
# Derived dicts (backwards compat)
# ---------------------------------------------------------------------------

class TestDerivedDicts:


    def test_commands_by_category_covers_all_categories(self):
        registry_categories = {cmd.category for cmd in COMMAND_REGISTRY if not cmd.gateway_only}
        assert set(COMMANDS_BY_CATEGORY.keys()) == registry_categories


# ---------------------------------------------------------------------------
# Gateway helpers
# ---------------------------------------------------------------------------

class TestGatewayKnownCommands:

    def test_includes_config_gated_cli_only(self):
        """Commands with gateway_config_gate are always in GATEWAY_KNOWN_COMMANDS."""
        for cmd in COMMAND_REGISTRY:
            if cmd.gateway_config_gate:
                assert cmd.name in GATEWAY_KNOWN_COMMANDS, \
                    f"config-gated command '{cmd.name}' should be in GATEWAY_KNOWN_COMMANDS"


class TestGatewayHelpLines:

    def test_excludes_cli_only_commands_without_config_gate(self):
        import re
        lines = gateway_help_lines()
        joined = "\n".join(lines)
        for cmd in COMMAND_REGISTRY:
            if cmd.cli_only and not cmd.gateway_config_gate:
                # Word-boundary match so `/reload` doesn't match `/reload-mcp`
                pattern = rf'`/{re.escape(cmd.name)}(?![-_\w])'
                assert not re.search(pattern, joined), \
                    f"cli_only command /{cmd.name} should not be in gateway help"


# ---------------------------------------------------------------------------
# Config-gated gateway commands
# ---------------------------------------------------------------------------

class TestGatewayConfigGate:
    """Tests for the gateway_config_gate mechanism on CommandDef."""


    def test_config_gate_excluded_from_help_when_off(self, tmp_path, monkeypatch):
        """When the config gate is falsy, the command should not appear in help."""
        # Write a config with the gate off (default)
        config_file = tmp_path / "config.yaml"
        config_file.write_text("display:\n  tool_progress_command: false\n", encoding="utf-8")
        monkeypatch.setenv("SCOUT_HOME", str(tmp_path))

        lines = gateway_help_lines()
        joined = "\n".join(lines)
        assert "`/verbose" not in joined


# ---------------------------------------------------------------------------
# Autocomplete (SlashCommandCompleter)
# ---------------------------------------------------------------------------

class TestSlashCommandCompleter:
    # -- basic prefix completion -----------------------------------------


    # -- exact-match trailing space --------------------------------------


    # -- non-slash input returns nothing ---------------------------------


    # -- skill commands via provider ------------------------------------

    def test_skill_commands_are_completed_from_provider(self):
        completer = SlashCommandCompleter(
            skill_commands_provider=lambda: {
                "/gif-search": {"description": "Search for GIFs across providers"},
            }
        )

        completions = _completions(completer, "/gif")

        assert len(completions) == 1
        assert completions[0].text == "gif-search"
        assert completions[0].display_text == "/gif-search"
        assert completions[0].display_meta_text == "⚡ Search for GIFs across providers"


    def test_skill_provider_exception_is_swallowed(self):
        """A broken provider should not crash autocomplete."""
        completer = SlashCommandCompleter(
            skill_commands_provider=lambda: (_ for _ in ()).throw(RuntimeError("boom")),
        )
        # Should return builtin matches only, no crash
        completions = _completions(completer, "/he")
        texts = {item.text for item in completions}
        assert "help" in texts


# ── Stacked slash-skill completion ──────────────────────────────────────


def _stacked_completer(**extra_skills):
    skills = {
        "/skill-a": {"description": "Skill A"},
        "/skill-b": {"description": "Skill B"},
        "/skill-c": {"description": "Skill C"},
        **extra_skills,
    }
    return SlashCommandCompleter(skill_commands_provider=lambda: skills)


class TestStackedSkillCompletion:
    """Second+ leading skill tokens keep getting completions (stacked
    slash-skill invocations, Claude Code v2.1.199 port follow-up)."""


    def test_no_completions_for_instruction_text(self):
        assert _completions(_stacked_completer(), "/skill-a do the") == []
        assert _completions(_stacked_completer(), "/skill-a ") == []


    def test_cap_stops_completions(self):
        skills = {f"/stk-{i}": {"description": f"S{i}"} for i in range(8)}
        completer = SlashCommandCompleter(skill_commands_provider=lambda: skills)
        text = " ".join(f"/stk-{i}" for i in range(5)) + " /stk-"
        assert _completions(completer, text) == []


# ── SUBCOMMANDS extraction ──────────────────────────────────────────────


# ── Subcommand tab completion ───────────────────────────────────────────


class TestSubcommandCompletion:


    def test_tools_enable_skips_already_listed(self, monkeypatch):
        """If the user already typed a name, don't suggest it again."""
        monkeypatch.setattr(
            "scout_cli.tools_config._get_platform_tools",
            lambda *_a, **_k: set(),
        )
        monkeypatch.setattr("scout_cli.config.load_config", lambda: {})
        monkeypatch.setattr(
            "scout_cli.tools_config._get_plugin_toolset_keys",
            lambda: set(),
        )

        completions = _completions(SlashCommandCompleter(), "/tools enable spotify ")
        texts = {c.text for c in completions}
        assert "spotify" not in texts


    def _fake_gateway(self, monkeypatch, platforms):
        """Patch load_gateway_config with a fake whose connected platforms are
        the keys of `platforms` (name -> home as None or a (chat_id, name) tuple).
        """
        from types import SimpleNamespace

        enums = {name: SimpleNamespace(value=name) for name in platforms}
        homes = {
            name: (None if home is None else SimpleNamespace(chat_id=home[0], name=home[1]))
            for name, home in platforms.items()
        }
        fake = SimpleNamespace(
            get_connected_platforms=lambda: list(enums.values()),
            get_home_channel=lambda p: homes[p.value],
        )
        monkeypatch.setattr("gateway.config.load_gateway_config", lambda: fake)

    def test_handoff_completes_connected_platforms(self, monkeypatch):
        """`/handoff ` offers connected platforms, with or without a home channel."""
        self._fake_gateway(
            monkeypatch,
            {
                "telegram": ("123", "Me"),
                "discord": None,  # no home channel yet -> still listed
            },
        )

        texts = {c.text for c in _completions(SlashCommandCompleter(), "/handoff ")}
        assert texts == {"telegram", "discord"}


# ── Ghost text (SlashCommandAutoSuggest) ────────────────────────────────


def _suggestion(text: str, completer=None) -> str | None:
    """Get ghost text suggestion for given input."""
    suggest = SlashCommandAutoSuggest(completer=completer)
    doc = Document(text=text)

    class FakeBuffer:
        pass

    result = suggest.get_suggestion(FakeBuffer(), doc)
    return result.text if result else None


class TestGhostText:
    def test_command_name_suggestion(self):
        """/he → 'lp'"""
        assert _suggestion("/he") == "lp"


    # -- stacked slash-skill ghost text -----------------------------------


    def test_stacked_skill_ghost_text_skips_used(self):
        completer = SlashCommandCompleter(
            skill_commands_provider=lambda: {
                "/alpha": {"description": "A"},
                "/beta": {"description": "B"},
            }
        )
        assert _suggestion("/alpha /a", completer=completer) is None
        assert _suggestion("/alpha /b", completer=completer) == "eta"


# ---------------------------------------------------------------------------
# Telegram command name sanitization
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# Telegram command name clamping (32-char limit)
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# Discord skill commands grouped by category
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# Plugin slash command integration
# ---------------------------------------------------------------------------

class TestPluginCommandEnumeration:
    """Plugin commands registered via ctx.register_command() must be surfaced
    by every gateway enumerator (Telegram menu, Slack subcommand map, etc.).
    """

    def _patch_plugin_commands(self, monkeypatch, commands):
        """Monkeypatch scout_cli.plugins.get_plugin_commands() to a fixed dict."""
        from scout_cli import plugins as _plugins_mod

        monkeypatch.setattr(
            _plugins_mod, "get_plugin_commands", lambda: dict(commands)
        )


