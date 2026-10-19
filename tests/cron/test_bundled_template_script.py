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
    assert spec["schedule"] == "every 30m" and "google-workspace" in spec["skills"]


def test_latest_answer_skips_quiet_checks(tmp_path):
    (tmp_path / "2026-10-02_10-00-00.md").write_text("# Cron Job: mail\n\n## Response\n\nDBS: statement ready.")
    quiet = tmp_path / "2026-10-02_10-30-00.md"
    quiet.write_text("# Cron Job: mail\n\nScript gate returned `wakeAgent=false` — agent skipped.\n")
    import os
    os.utime(quiet, (2_000_000_000, 2_000_000_000))  # newest

    path, answer = latest_archived_answer(tmp_path)

    assert answer == "DBS: statement ready." and path.name.startswith("2026-10-02_10-00")


def test_latest_endpoint_shows_what_a_reminder_delivered(tmp_path, monkeypatch):
    """A reminder run is stored as a run header + the delivered text; the Heartbeat shows the text."""
    from scout_backend.web_routers import cron as cron_routes

    out = tmp_path / "out"
    out.mkdir()
    (out / "2026-10-02_15-00-40.md").write_text(
        "# Cron Job: Stand up\n\n**Job ID:** j1\n**Mode:** reminder\n\n---\n\n⏰ Reminder: Stand up and stretch\n")
    monkeypatch.setattr(cron_routes, "_job_owner_profile", lambda job_id, profile: "default")
    monkeypatch.setattr(cron_routes, "_call_cron_for_profile", lambda *a, **k: {"id": "j1"})
    monkeypatch.setattr(cron_routes, "_cron_output_runs_dir", lambda profile, job_id: out)

    result = cron_routes._latest_cron_answer_sync("j1")

    assert result["text"] == "⏰ Reminder: Stand up and stretch" and result["at"]


def test_latest_finding_passes_over_a_failed_run(tmp_path):
    import os

    good = tmp_path / "2026-10-02_10-00-00.md"
    good.write_text("# Cron Job: mail\n\n## Response\n\nDBS: statement ready.")
    failed = tmp_path / "2026-10-02_10-30-00.md"
    failed.write_text("# Cron Job: mail\n\n## Response\n\n[CRON_FAILURE]\nThe script failed.")
    os.utime(failed, (2_000_000_000, 2_000_000_000))

    assert latest_archived_answer(tmp_path, skip_failures=True)[1] == "DBS: statement ready."
    assert latest_archived_answer(tmp_path)[1].startswith("[CRON_FAILURE]")
