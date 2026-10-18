"""Tests for OpenClaw migration integration in the setup wizard."""

from argparse import Namespace
from types import ModuleType
from unittest.mock import MagicMock, patch

from scout_cli import setup as setup_mod
from scout_cli import setup_migration


# ---------------------------------------------------------------------------
# _offer_openclaw_migration — unit tests
# ---------------------------------------------------------------------------


class TestOfferOpenclawMigration:
    """Test the _offer_openclaw_migration helper in isolation."""



    def test_skips_when_user_declines(self, tmp_path):
        """Should return False when user declines the migration prompt."""
        openclaw_dir = tmp_path / ".openclaw"
        openclaw_dir.mkdir()
        script = tmp_path / "openclaw_to_scout.py"
        script.write_text("# placeholder")
        with (
            patch("scout_cli.setup.Path.home", return_value=tmp_path),
            patch.object(setup_migration, "_OPENCLAW_SCRIPT", script),
            patch.object(setup_mod, "prompt_yes_no", return_value=False),
        ):
            assert setup_mod._offer_openclaw_migration(tmp_path / ".scout") is False

    def test_runs_migration_when_user_accepts(self, tmp_path):
        """Should run dry-run preview first, then execute after confirmation."""
        openclaw_dir = tmp_path / ".openclaw"
        openclaw_dir.mkdir()

        # Create a fake scout home with config
        scout_home = tmp_path / ".scout"
        scout_home.mkdir()
        config_path = scout_home / "config.yaml"
        config_path.write_text("agent:\n  max_turns: 90\n")

        # Build a fake migration module
        fake_mod = ModuleType("openclaw_to_scout")
        fake_mod.resolve_selected_options = MagicMock(return_value={"soul", "memory"})
        fake_migrator = MagicMock()
        fake_migrator.migrate.return_value = {
            "summary": {"migrated": 3, "skipped": 1, "conflict": 0, "error": 0},
            "items": [{"kind": "config", "status": "migrated", "destination": "/tmp/x"}],
            "output_dir": str(scout_home / "migration"),
        }
        fake_mod.Migrator = MagicMock(return_value=fake_migrator)

        script = tmp_path / "openclaw_to_scout.py"
        script.write_text("# placeholder")

        with (
            patch("scout_cli.setup.Path.home", return_value=tmp_path),
            patch.object(setup_migration, "_OPENCLAW_SCRIPT", script),
            # Both prompts answered Yes: preview offer + proceed confirmation
            patch.object(setup_mod, "prompt_yes_no", return_value=True),
            patch.object(setup_mod, "get_config_path", return_value=config_path),
            patch("importlib.util.spec_from_file_location") as mock_spec_fn,
        ):
            # Wire up the fake module loading
            mock_spec = MagicMock()
            mock_spec.loader = MagicMock()
            mock_spec_fn.return_value = mock_spec

            def exec_module(mod):
                mod.resolve_selected_options = fake_mod.resolve_selected_options
                mod.Migrator = fake_mod.Migrator

            mock_spec.loader.exec_module = exec_module

            result = setup_mod._offer_openclaw_migration(scout_home)

        assert result is True
        fake_mod.resolve_selected_options.assert_called_once_with(
            None, None, preset="full"
        )
        # Migrator called twice: once for dry-run preview, once for execution
        assert fake_mod.Migrator.call_count == 2

        # First call: dry-run preview (execute=False, overwrite=True to show all)
        preview_kwargs = fake_mod.Migrator.call_args_list[0][1]
        assert preview_kwargs["execute"] is False
        assert preview_kwargs["overwrite"] is True
        assert preview_kwargs["migrate_secrets"] is True
        assert preview_kwargs["preset_name"] == "full"

        # Second call: actual execution (execute=True, overwrite=False to preserve)
        exec_kwargs = fake_mod.Migrator.call_args_list[1][1]
        assert exec_kwargs["execute"] is True
        assert exec_kwargs["overwrite"] is False
        assert exec_kwargs["migrate_secrets"] is True
        assert exec_kwargs["preset_name"] == "full"

        # migrate() called twice (once per Migrator instance)
        assert fake_migrator.migrate.call_count == 2


    def test_handles_migration_error_gracefully(self, tmp_path):
        """Should catch exceptions and return False."""
        openclaw_dir = tmp_path / ".openclaw"
        openclaw_dir.mkdir()
        scout_home = tmp_path / ".scout"
        scout_home.mkdir()
        config_path = scout_home / "config.yaml"
        config_path.write_text("")

        script = tmp_path / "openclaw_to_scout.py"
        script.write_text("# placeholder")

        with (
            patch("scout_cli.setup.Path.home", return_value=tmp_path),
            patch.object(setup_migration, "_OPENCLAW_SCRIPT", script),
            patch.object(setup_mod, "prompt_yes_no", return_value=True),
            patch.object(setup_mod, "get_config_path", return_value=config_path),
            patch(
                "importlib.util.spec_from_file_location",
                side_effect=RuntimeError("boom"),
            ),
        ):
            result = setup_mod._offer_openclaw_migration(scout_home)

        assert result is False


# ---------------------------------------------------------------------------
# Integration with run_setup_wizard — first-time flow
# ---------------------------------------------------------------------------


def _first_time_args() -> Namespace:
    return Namespace(
        section=None,
        non_interactive=False,
        reset=False,
    )




# ---------------------------------------------------------------------------
# _get_section_config_summary / _skip_configured_section — unit tests
# ---------------------------------------------------------------------------


class TestGetSectionConfigSummary:
    """Test the _get_section_config_summary helper."""

    def test_model_returns_none_without_api_key(self):
        with patch.object(setup_mod, "get_env_value", return_value=""):
            result = setup_migration._get_section_config_summary({}, "model")
        assert result is None




    # Regression tests for issue #13025: the model / gateway summaries used
    # stale, hardcoded env-var allowlists that drifted from the real setup +
    # status flows.  Every case below would previously return ``None`` and
    # force OpenClaw migration to re-run setup for an already-configured
    # section.




    def test_model_ignores_claude_code_oauth_token(self):
        """CLAUDE_CODE_OAUTH_TOKEN is set by Claude Code itself and must not
        trigger skip — mirrors the _IMPLICIT_ENV_VARS guard in
        is_provider_explicitly_configured()."""
        def env_side(key):
            return "sk-ant-oat01-xxx" if key == "CLAUDE_CODE_OAUTH_TOKEN" else ""

        with patch.object(setup_mod, "get_env_value", side_effect=env_side):
            result = setup_migration._get_section_config_summary({}, "model")
        assert result is None




class TestSkipConfiguredSection:
    """Test the _skip_configured_section helper."""


    def test_returns_true_when_user_skips(self):
        def env_side(key):
            return "sk-xxx" if key == "OPENROUTER_API_KEY" else ""

        with (
            patch.object(setup_mod, "get_env_value", side_effect=env_side),
            patch.object(setup_mod, "prompt_yes_no", return_value=False),
        ):
            result = setup_mod._skip_configured_section(
                {"model": "openai/gpt-4"}, "model", "Model"
            )
        assert result is True


