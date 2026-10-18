"""``scout plugins validate`` on language packs: bad keys WARN by name, non-text leaves fail, a
manifest-only pack is loadable, a declared id with no file fails."""

from __future__ import annotations

from pathlib import Path

import scout_yaml as yaml

from scout_cli.plugin_validate import validate_plugin_dir


def _pack(root: Path, *, core: dict | None, tui: dict | None = None, declared=("pl",), init: str | None = None) -> Path:
    plugin = root / "scout-lang-pl"
    (plugin / "locales").mkdir(parents=True)
    (plugin / "plugin.yaml").write_text(yaml.safe_dump({
        "name": "scout-lang-pl", "version": "1.0.0", "description": "Polish pack",
        "provides_locales": list(declared),
    }), encoding="utf-8")
    if core is not None:
        (plugin / "locales" / "pl.yaml").write_text(yaml.safe_dump(core, allow_unicode=True), encoding="utf-8")
    if tui is not None:
        (plugin / "locales" / "pl.tui.yaml").write_text(yaml.safe_dump(tui, allow_unicode=True), encoding="utf-8")
    if init is not None:
        (plugin / "__init__.py").write_text(init, encoding="utf-8")
    return plugin


def _check(report, name: str):
    return next((ok, detail) for check_name, ok, detail in report.checks if check_name == name)


def test_manifest_only_pack_passes_and_unknown_key_warns_by_name(tmp_path):
    plugin = _pack(tmp_path, core={"approval": {"denied": "      ✗ Odrzucono", "no_such_key": "x"}})
    report = validate_plugin_dir(plugin)
    assert report.ok, report.failures
    ok, detail = _check(report, "loadable")
    assert ok and "language pack" in detail
    ok, detail = _check(report, "locale pl")
    assert ok and "1 match" in detail
    assert any("approval.no_such_key" in w and "pl.yaml" in w for w in report.warnings), report.warnings


def test_non_text_leaf_is_an_error(tmp_path):
    plugin = _pack(tmp_path, core={"approval": {"denied": 42, "cancelled": ["a", "b"]}})
    report = validate_plugin_dir(plugin)
    assert not report.ok
    ok, detail = _check(report, "locale pl")
    assert not ok and "approval.denied" in detail and "approval.cancelled" in detail


def test_declared_language_without_file_fails(tmp_path):
    plugin = _pack(tmp_path, core=None)
    report = validate_plugin_dir(plugin)
    assert not report.ok
    assert any("locales/pl.yaml is missing" in f for f in report.failures), report.failures




def test_pack_with_register_function_still_probes(tmp_path):
    plugin = _pack(tmp_path, core={"approval": {"denied": "Odrzucono"}},
                   init="def register(ctx):\n    ctx.register_locale('pl', {'approval': {'cancelled': 'Anulowano'}})\n")
    report = validate_plugin_dir(plugin)
    assert report.ok, report.failures
    ok, _ = _check(report, "capability probe")
    assert ok
