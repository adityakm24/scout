"""A job template that needs a pre-run script installs it where the scheduler runs scripts from.

Cron only runs scripts inside the job's ``<home>/scripts``; the "New email check" template's
Gmail pre-check ships in ``cron/scripts`` and must land there when the template is used.
"""
from cron.blueprint_catalog import fill_blueprint, get_blueprint
from cron.bundled_scripts import BUNDLED_SCRIPTS_DIR, install_bundled_script
from cron.scheduler_prompt import latest_archived_answer


def test_mail_template_installs_its_precheck_into_the_profile(tmp_path):
    blueprint = get_blueprint("important-mail")
    spec = fill_blueprint(blueprint, {})

    name = install_bundled_script(spec["script"], tmp_path)

    installed = tmp_path / "scripts" / name
    assert installed.read_bytes() == (BUNDLED_SCRIPTS_DIR / spec["script"]).read_bytes()
    assert spec["schedule"] == "*/30 * * * *" and "google-workspace" in spec["skills"]


def test_latest_answer_skips_quiet_checks(tmp_path):
    (tmp_path / "2026-10-02_10-00-00.md").write_text("# Cron Job: mail\n\n## Response\n\nDBS: statement ready.")
    quiet = tmp_path / "2026-10-02_10-30-00.md"
    quiet.write_text("# Cron Job: mail\n\nScript gate returned `wakeAgent=false` — agent skipped.\n")
    import os
    os.utime(quiet, (2_000_000_000, 2_000_000_000))  # newest

    path, answer = latest_archived_answer(tmp_path)

    assert answer == "DBS: statement ready." and path.name.startswith("2026-10-02_10-00")
