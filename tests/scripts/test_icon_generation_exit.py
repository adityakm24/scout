"""Icon generation reports per-target failures without hiding later targets."""
import importlib.util
import io
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
from types import ModuleType, SimpleNamespace

import pytest
from PIL import Image


@pytest.mark.parametrize("bom", [b"", b"\xef\xbb\xbf"])
@pytest.mark.parametrize("editor_export", [False, True])
def test_svg_readers_accept_bom_without_rewriting_assets(tmp_path, monkeypatch, bom, editor_export):
    monkeypatch.setitem(sys.modules, "resvg_py", ModuleType("resvg_py"))
    script = Path(__file__).resolve().parents[2] / "scripts/generate_icons.py"
    spec = importlib.util.spec_from_file_location("icon_readers_under_test", script)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    path = tmp_path / "art.svg"
    element = '<path id="bubble" d="M0 0 L1 1" aria-label="café 東京"/>'
    declaration = '<?xml version="1.0" encoding="UTF-8"?>\n' if editor_export else ""
    namespaces = ' xmlns="http://www.w3.org/2000/svg" xmlns:editor="urn:editor"'
    metadata = '<editor:namedview editor:zoom="1"/>' if editor_export else ""
    document = f'<svg{namespaces} viewBox="0 0 20 30">{metadata}{element}</svg>'
    raw = bom + (declaration + document).encode("utf-8")
    path.write_bytes(raw)
    art = SimpleNamespace(mark=path, paths={}, backgrounds=tmp_path, colors=None)
    assert module.mark_path(art, "bubble") == "M0 0 L1 1"
    inner, width, height = module.background_inner(art, path.name)
    composed = ET.fromstring(f'<svg xmlns="http://www.w3.org/2000/svg">{inner}</svg>')
    assert (width, height) == (20, 30)
    assert [ET.tostring(child) for child in composed] == [
        ET.tostring(child) for child in ET.fromstring(document)
    ]
    assert path.read_bytes() == raw
    path.write_bytes(bom + b"<svg/>")
    art.paths.clear()
    with pytest.raises(AssertionError, match="no <path"):
        module.mark_path(art, "bubble")
    with pytest.raises(AssertionError, match="viewBox"):
        module.background_inner(art, path.name)


@pytest.mark.parametrize("failure", [None, "render", "directory", "verify"])
def test_write_status_includes_every_target(tmp_path, monkeypatch, capsys, failure):
    # The renderer is build-only. This test injects failures at its byte boundary.
    monkeypatch.setitem(sys.modules, "resvg_py", ModuleType("resvg_py"))
    script = Path(__file__).resolve().parents[2] / "scripts" / "generate_icons.py"
    spec = importlib.util.spec_from_file_location("icon_generator_under_test", script)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    source = tmp_path / "immutable source"
    source.mkdir()
    monkeypatch.setattr(module, "IconArt", lambda root: root)
    monkeypatch.setattr(sys, "argv", [str(script), "--source", str(source), "--out", str(tmp_path)])

    image = io.BytesIO()
    Image.new("RGBA", (2, 2), (0, 0, 0, 0)).save(image, "PNG")
    good_bytes = image.getvalue()
    first = "blocked/icon.png" if failure == "directory" else "first.png"
    if failure == "directory":
        (tmp_path / "blocked").write_text("not a directory", encoding="utf-8")
    monkeypatch.setattr(module, "TARGETS", [(first, "png", "first"), ("last.png", "png", "last")])

    def target_bytes(art, kind, target):
        assert art == source
        assert not list(source.iterdir())
        if target == "first":
            if failure == "render":
                raise RuntimeError("injected render failure")
            if failure == "verify":
                return b"not an image"
        return good_bytes

    monkeypatch.setattr(module, "target_bytes", target_bytes)
    code = 0
    try:
        module.main()
    except SystemExit as stopped:
        code = stopped.code
    assert bool(code) is (failure is not None)
    assert (tmp_path / "last.png").read_bytes() == good_bytes
    output = capsys.readouterr().out
    assert "last.png: PNG (2, 2)" in output
    assert ("FAILED" in output) is (failure is not None)


@pytest.mark.parametrize("platform", ["", "mac-"])
@pytest.mark.parametrize("appearance", ["light", "dark"])
@pytest.mark.parametrize("colors", [None, ("#f5cc32", "#443808"), ("#e34850", "#4a1117")])
def test_face_tile_keeps_platform_geometry_with_its_eyes_scaled_onto_it(monkeypatch, platform, appearance, colors):
    """The tile is the agent's face and keeps each platform's geometry; the 1024 eyes are scaled
    onto it unchanged in every flavor, and a canary/commit flavor recolours only the face."""
    monkeypatch.setitem(sys.modules, "resvg_py", ModuleType("resvg_py"))
    source = Path(__file__).resolve().parents[2]
    spec = importlib.util.spec_from_file_location("icon_geometry_under_test", source / "scripts/generate_icons.py")
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    art = SimpleNamespace(backgrounds=source / "assets/backgrounds", colors=colors, commit="0123456",
                          mark=source / "assets/scout-mark.svg", paths={})
    name = f"squircle-{platform}{appearance}.svg"
    ns = {"svg": "http://www.w3.org/2000/svg"}
    original = ET.parse(art.backgrounds / name).find("svg:rect", ns)
    result = ET.fromstring(module.compose_svg(art, appearance, name))
    tile = result.find("svg:rect", ns)
    assert original is not None and tile is not None
    keys = ("x", "y", "width", "height", "rx")
    assert [tile.attrib[k] for k in keys] == [original.attrib[k] for k in keys]

    face = result[-1]
    x, y, width = (float(original.attrib[k]) for k in ("x", "y", "width"))
    assert face.get("transform") == f"translate({x} {y}) scale({width / 1024})"
    assert [p.get("fill") for p in face.findall("svg:path", ns)] == [module.EYE] * 2 + [module.GLINT] * 2
    if colors:
        assert tile.get("fill") == colors[appearance == "dark"]
    else:
        stops = [stop.get("stop-color") for stop in result.find("svg:defs/svg:linearGradient", ns)]
        assert tile.get("fill") == "url(#face)" and stops == list(module.TILE_STOPS[appearance])
