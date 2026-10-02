#!/usr/bin/env python3
"""Generate every app icon in the repo from the Scout mark + platform backgrounds.

Usage (from repo root):
    node scripts/generate-icons.mjs           # write
    node scripts/generate-icons.mjs --check   # verify structure

Sources of truth — two axes, composed per target:
  Mark (vector):      assets/scout-mark.svg — a speech bubble holding a north star, drawn on the
                      1024 tile. Three paths by id: `bubble`, `star`, `spark`.

  Backgrounds (per platform surface, light/dark) give the tile geometry:
                      assets/backgrounds/squircle-light.svg   full-bleed rounded tile
                      assets/backgrounds/squircle-dark.svg
                      assets/backgrounds/squircle-mac-light.svg   mac HIG grid
                      assets/backgrounds/squircle-mac-dark.svg    mac HIG grid

  The tile is iMessage blue (light) or deep orbit navy (dark), the bubble near-white, and the star
  and spark are cut-outs filled with the tile itself. The master SVGs (assets/icon-master.svg
  light, assets/icon-master-dark.svg dark) are GENERATED artifacts. macOS icns targets render from
  an in-memory master that puts the tile on Apple's 824x824 (r=185.4) grid, centered in 1024 with
  100px margins, with the mark scaled to match.

Desktop build identity comes from SCOUT_PAYLOAD_TAG / SCOUT_BUILD_COMMIT:
Canary uses yellow/dark-yellow tiles. Commit builds use red/dark-red and a seven-character SHA
badge. The mark and tile geometry do not change, and because the star is a cut-out the flavor
colour shows through it. Only apps/desktop outputs use this identity. Website, bootstrap,
dashboard, and the shared master SVGs retain the default brand.

GENERATED OUTPUTS ARE COMMITTED. Regular builds and installs consume them and
never render; flavored release bundles (canary/commit) render to a product dir.
icons-freshness-check.yml regenerates, runs --check, and fails on any diff.

Rendering: resvg (resvg-py) for SVG -> PNG fidelity at every size.
Containers: Pillow for multi-size .ico and .icns.

Dependencies:
    Pillow and resvg-py are core runtime dependencies; run this file with a
    Scout runtime interpreter (scripts/generate-icons.mjs uses SCOUT_PYTHON).

Outputs (30 files):
  assets/icon-master.svg                              generated light master
  assets/icon-master-dark.svg                         generated dark master
  apps/desktop/assets/icon.png                        1024x1024 squircle (light)
  apps/desktop/assets/icon.ico                        16,24,32,48,64,128,256
  apps/desktop/assets/icon.icns                       16..1024 (real ICNS)
  apps/desktop/assets/icon-dark.png                   1024x1024 squircle (dark)
  apps/desktop/assets/icon-dark.ico                   16,24,32,48,64,128,256
  apps/desktop/assets/icon-dark.icns                  16..1024 (real ICNS)
  apps/desktop/assets/appx/Wide310x150Logo.png        310x150, squircle 100 centered
  apps/desktop/assets/appx/StoreLogo.png              50x50 squircle
  apps/desktop/assets/appx/Square44x44Logo.png        44x44 squircle
  apps/desktop/assets/appx/Square150x150Logo.png      150x150 squircle
  apps/desktop/assets/appx/*-dark.png                 dark-appearance logos
  apps/desktop/public/apple-touch-icon.png            1024x1024 squircle
  apps/desktop/public/scout-mark.png                   256x256 tile (light, BrandMark)
  apps/desktop/public/scout-mark-dark.png              256x256 tile (dark, BrandMark)
  apps/bootstrap-installer/src-tauri/icons/32x32.png       32x32
  apps/bootstrap-installer/src-tauri/icons/128x128.png     128x128
  apps/bootstrap-installer/src-tauri/icons/128x128@2x.png  256x256
  apps/bootstrap-installer/src-tauri/icons/icon.ico        16,32,64,128,256
  apps/bootstrap-installer/src-tauri/icons/icon.icns       16..1024
  apps/bootstrap-installer/public/scout-mark.png   256x256 tile (light)
  website/static/img/logo.png                     1772x1799 mark alone, transparent (light)
  website/static/img/logo-dark.png                1772x1799 mark alone, transparent (dark)
  website/static/img/spaceshipresearch-logo.png                150x150 on white (opaque)
  website/static/img/spaceshipresearch-logo-dark.png           150x150 on #0d1117 (opaque)
  website/static/img/favicon-16x16.png            16x16
  website/static/img/favicon-32x32.png            32x32
  website/static/img/apple-touch-icon.png         180x180
  website/static/img/favicon.ico                  16,32,48
  website/static/img/favicon.svg                  copy of the light master
  web/public/favicon.ico                          16,32,48
"""

from __future__ import annotations

import argparse
import io
import os
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

from PIL import Image

try:
    import resvg_py
except ImportError:
    sys.exit(
        "resvg-py is missing: run the generator with a Scout runtime interpreter\n"
        "  (SCOUT_PYTHON=<scout venv python> node scripts/generate-icons.mjs)"
    )

# Copy of scout_cli.update_channel._CANARY_TAG_RE: builders run this renderer
# on the runtime dependencies without the application package installed
# (Docker, bundles). tests/scripts/test_icon_flavors.py pins it to the canonical one.
_CANARY_TAG_RE = re.compile(
    r"^v(?:0|[1-9]\d{0,2})\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)"
    r"\+canary\.20\d{6}T\d{6}Z$"
)

# The spaceshipresearch dark background (#0d1117) — fixed dark tile/background everywhere.
DARK_HEX = "#0d1117"
DARK_RGB = (13, 17, 23)
# Tile gradients (top-left -> bottom-right) and the bubble colour, per appearance.
TILE_STOPS = {"light": ("#5cbcff", "#0060d6"), "dark": ("#1b335f", "#070b14")}
BUBBLE = {"light": "#ffffff", "dark": "#eaf3ff"}
# The standalone logo (no tile): a blue bubble with a white star, on any navbar.
LOGO_STOPS = ("#4fb2ff", "#0062cc")
MARK_SIZE = 1024.0

# Target sizes for --check's structural verification: relpath -> (format, size)
CHECK_SIZES: dict[str, tuple[str, tuple[int, int]]] = {
    "apps/desktop/assets/icon.png": ("PNG", (1024, 1024)),
    "apps/desktop/assets/icon-dark.png": ("PNG", (1024, 1024)),
    "apps/desktop/assets/appx/Wide310x150Logo.png": ("PNG", (310, 150)),
    "apps/desktop/assets/appx/Wide310x150Logo-dark.png": ("PNG", (310, 150)),
    "apps/desktop/assets/appx/StoreLogo.png": ("PNG", (50, 50)),
    "apps/desktop/assets/appx/StoreLogo-dark.png": ("PNG", (50, 50)),
    "apps/desktop/assets/appx/Square44x44Logo.png": ("PNG", (44, 44)),
    "apps/desktop/assets/appx/Square44x44Logo-dark.png": ("PNG", (44, 44)),
    "apps/desktop/assets/appx/Square150x150Logo.png": ("PNG", (150, 150)),
    "apps/desktop/assets/appx/Square150x150Logo-dark.png": ("PNG", (150, 150)),
    "apps/desktop/public/apple-touch-icon.png": ("PNG", (1024, 1024)),
    "apps/desktop/public/scout-mark.png": ("PNG", (256, 256)),
    "apps/desktop/public/scout-mark-dark.png": ("PNG", (256, 256)),
    "apps/bootstrap-installer/src-tauri/icons/32x32.png": ("PNG", (32, 32)),
    "apps/bootstrap-installer/src-tauri/icons/128x128.png": ("PNG", (128, 128)),
    "apps/bootstrap-installer/src-tauri/icons/128x128@2x.png": ("PNG", (256, 256)),
    "apps/bootstrap-installer/public/scout-mark.png": ("PNG", (256, 256)),
    "website/static/img/logo.png": ("PNG", (1772, 1799)),
    "website/static/img/logo-dark.png": ("PNG", (1772, 1799)),
    "website/static/img/spaceshipresearch-logo.png": ("PNG", (150, 150)),
    "website/static/img/spaceshipresearch-logo-dark.png": ("PNG", (150, 150)),
    "website/static/img/favicon-16x16.png": ("PNG", (16, 16)),
    "website/static/img/favicon-32x32.png": ("PNG", (32, 32)),
    "website/static/img/apple-touch-icon.png": ("PNG", (180, 180)),
}

# (relpath, kind, arg)
TARGETS: list[tuple[str, str, object]] = [
    ("assets/icon-master.svg", "svg", None),
    ("assets/icon-master-dark.svg", "svg_dark", None),
    ("apps/desktop/assets/icon.png", "png", 1024),
    ("apps/desktop/assets/icon.ico", "ico", [16, 24, 32, 48, 64, 128, 256]),
    ("apps/desktop/assets/icon.icns", "icns", None),
    ("apps/desktop/assets/icon-dark.png", "png_dark", 1024),
    ("apps/desktop/assets/icon-dark.ico", "ico_dark", [16, 24, 32, 48, 64, 128, 256]),
    ("apps/desktop/assets/icon-dark.icns", "icns_dark", None),
    ("apps/desktop/assets/appx/Wide310x150Logo.png", "wide", (310, 150)),
    ("apps/desktop/assets/appx/StoreLogo.png", "png", 50),
    ("apps/desktop/assets/appx/Square44x44Logo.png", "png", 44),
    ("apps/desktop/assets/appx/Square150x150Logo.png", "png", 150),
    ("apps/desktop/assets/appx/Wide310x150Logo-dark.png", "wide_dark", (310, 150)),
    ("apps/desktop/assets/appx/StoreLogo-dark.png", "png_dark", 50),
    ("apps/desktop/assets/appx/Square44x44Logo-dark.png", "png_dark", 44),
    ("apps/desktop/assets/appx/Square150x150Logo-dark.png", "png_dark", 150),
    ("apps/desktop/public/apple-touch-icon.png", "png", 1024),
    # The dev-run Dock icon (app.dock.setIcon): same mac grid as the icns.
    ("apps/desktop/assets/icon-mac.png", "png_mac", 1024),
    ("apps/desktop/public/scout-mark.png", "png", 256),
    ("apps/desktop/public/scout-mark-dark.png", "png_dark", 256),
    ("apps/bootstrap-installer/src-tauri/icons/32x32.png", "png", 32),
    ("apps/bootstrap-installer/src-tauri/icons/128x128.png", "png", 128),
    ("apps/bootstrap-installer/src-tauri/icons/128x128@2x.png", "png", 256),
    ("apps/bootstrap-installer/src-tauri/icons/icon.ico", "ico", [16, 32, 64, 128, 256]),
    ("apps/bootstrap-installer/src-tauri/icons/icon.icns", "icns", None),
    ("apps/bootstrap-installer/public/scout-mark.png", "png", 256),
    ("website/static/img/logo.png", "logo", None),
    ("website/static/img/logo-dark.png", "logo_dark", None),
    ("website/static/img/spaceshipresearch-logo.png", "png_white", 150),
    ("website/static/img/spaceshipresearch-logo-dark.png", "png_dark_white", 150),
    ("website/static/img/favicon-16x16.png", "png", 16),
    ("website/static/img/favicon-32x32.png", "png", 32),
    ("website/static/img/apple-touch-icon.png", "png", 180),
    ("website/static/img/favicon.ico", "ico", [16, 32, 48]),
    ("website/static/img/favicon.svg", "svg_copy", None),
    ("web/public/favicon.ico", "ico", [16, 32, 48]),
]

# ─── mark art ───────────────────────────────────────────────────────────────

class IconArt:
    """One generation's rendering inputs and caches; never writes to source."""

    def __init__(self, source: Path, *, colors: tuple[str, str] | None = None, commit: str = ""):
        assets = source / "assets"
        self.colors = colors
        self.commit = commit
        self.mark = assets / "scout-mark.svg"
        self.backgrounds = assets / "backgrounds"
        self.paths: dict[str, str] = {}
        self.master = compose_svg(self, "light", "squircle-light.svg")
        self.master_dark = compose_svg(self, "dark", "squircle-dark.svg")
        # macOS icons sit on Apple's 824-on-1024 grid, not the full-bleed
        # squircle: same art, mac-grid backgrounds, icns targets only.
        self.master_mac = compose_svg(self, "light", "squircle-mac-light.svg")
        self.master_mac_dark = compose_svg(self, "dark", "squircle-mac-dark.svg")


def mark_path(art: IconArt, name: str) -> str:
    """The `d` of one mark path (`bubble`, `star`, `spark`) from assets/scout-mark.svg."""
    if not art.paths:
        src = art.mark.read_text(encoding="utf-8-sig")
        art.paths = {m.group(1): " ".join(m.group(2).split())
                     for m in re.finditer(r'<path\s+id="(\w+)"[^>]*?\sd="([^"]+)"', src)}
    assert name in art.paths, f"no <path id={name!r}> in {art.mark.name}"
    return art.paths[name]


def gradient(gid: str, stops: tuple[str, str], x: float, y: float, size: float) -> str:
    return (f'<linearGradient id="{gid}" x1="{x}" y1="{y}" x2="{x + size}" y2="{y + size}" '
            f'gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="{stops[0]}"/>'
            f'<stop offset="1" stop-color="{stops[1]}"/></linearGradient>')


def background_inner(art: IconArt, name: str) -> tuple[str, int, int]:
    """Inner content + (width, height) of a background SVG asset."""
    text = (art.backgrounds / name).read_text(encoding="utf-8-sig")
    if art.colors:
        text = text.replace('fill="#ffffff"', f'fill="{art.colors[0]}"')
        text = text.replace(f'fill="{DARK_HEX}"', f'fill="{art.colors[1]}"')
    root = ET.fromstring(text)
    m = re.fullmatch(r"0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)", root.get("viewBox", ""))
    assert m, f"cannot parse viewBox of {name}"
    w, h = float(m.group(1)), float(m.group(2))
    # Editor exports include XML declarations and root-scoped namespaces.
    # Parse away the prolog and retain child namespaces when embedding.
    inner = "".join(ET.tostring(child, encoding="unicode") for child in root)
    return inner, int(w), int(h)


# Five-by-seven lowercase hexadecimal glyphs, one five-bit row at a time.
# Vector cells keep release builds deterministic without any installed fonts.
HEX_GLYPHS = {
    "0": (14, 17, 19, 21, 25, 17, 14),
    "1": (4, 12, 4, 4, 4, 4, 14),
    "2": (14, 17, 1, 2, 4, 8, 31),
    "3": (30, 1, 1, 14, 1, 1, 30),
    "4": (2, 6, 10, 18, 31, 2, 2),
    "5": (31, 16, 16, 30, 1, 1, 30),
    "6": (14, 16, 16, 30, 17, 17, 14),
    "7": (31, 1, 2, 4, 8, 8, 8),
    "8": (14, 17, 17, 14, 17, 17, 14),
    "9": (14, 17, 17, 15, 1, 1, 14),
    "a": (0, 0, 14, 1, 15, 17, 15),
    "b": (16, 16, 30, 17, 17, 17, 30),
    "c": (0, 0, 14, 16, 16, 17, 14),
    "d": (1, 1, 15, 17, 17, 17, 15),
    "e": (0, 0, 14, 17, 31, 16, 14),
    "f": (6, 9, 8, 28, 8, 8, 8),
}


def commit_layer(commit: str, bg: str) -> str:
    cells = []
    for index, char in enumerate(commit[:7]):
        for row, bits in enumerate(HEX_GLYPHS[char]):
            for col in range(5):
                if bits & (1 << (4 - col)):
                    x, y = 184 + (index * 6 + col) * 16, 48 + row * 16
                    cells.append(f"M{x} {y}h16v16h-16z")
    # The badge follows the tile's mac HIG inset, never the outer canvas.
    transform = f' transform="translate(100 100) scale({824 / 1024})"' if "-mac-" in bg else ""
    return (
        f'<g{transform}><rect x="160" y="28" width="704" height="152" rx="24" fill="#29090c"/>'
        f'<path fill="#ffffff" d="{"".join(cells)}"/></g>'
    )


def compose_svg(art: IconArt, appearance: str, bg: str) -> str:
    """Full svg text: tile + mark, in the background's native coordinate space (resvg scales to
    whatever output size is requested, so the composition is size-agnostic). A build flavor
    replaces the tile gradient with its flat colour; the star cut-outs follow the tile."""
    inner, w, h = background_inner(art, bg)
    background = ET.fromstring(f"<g>{inner}</g>")
    tile = background.find("{http://www.w3.org/2000/svg}rect")
    assert tile is not None, f"no background rectangle in {bg}"
    x, y, size = (float(tile.attrib[key]) for key in ("x", "y", "width"))
    scale = size / MARK_SIZE
    if art.colors:
        flat = art.colors[0] if appearance == "light" else art.colors[1]
        defs, tile_fill, cut_fill = "", flat, flat
    else:
        stops = TILE_STOPS[appearance]
        # One gradient in tile space for the tile, the same one in mark space for the cut-outs,
        # so the star reads as a hole straight through to the tile.
        defs = gradient("tile", stops, x, y, size) + gradient("cut", stops, 0, 0, MARK_SIZE)
        tile_fill, cut_fill = "url(#tile)", "url(#cut)"
    tile.set("fill", tile_fill)
    tile_svg = ET.tostring(tile, encoding="unicode")
    badge = f"  {commit_layer(art.commit, bg)}\n" if art.commit else ""
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}">\n'
        f"  <defs>{defs}</defs>\n"
        f"  {tile_svg}\n"
        f"{badge}"
        f'  <g transform="translate({x} {y}) scale({scale})">'
        f'<path fill="{BUBBLE[appearance]}" d="{mark_path(art, "bubble")}"/>'
        f'<path fill="{cut_fill}" d="{mark_path(art, "star")}"/>'
        f'<path fill="{cut_fill}" d="{mark_path(art, "spark")}"/></g>\n'
        "</svg>\n"
    )


# ─── rendering ──────────────────────────────────────────────────────────────

def render(master: str, size: int, *, background: str | None = None) -> Image.Image:
    """Render a master to an RGBA PNG of `size`x`size`."""
    data = resvg_py.svg_to_bytes(
        svg_string=master, width=size, height=size, background=background
    )
    return Image.open(io.BytesIO(data)).convert("RGBA")


def render_svg(svg: str, size: int | tuple[int, int]) -> Image.Image:
    if isinstance(size, int):
        w = h = size
    else:
        w, h = size
    data = resvg_py.svg_to_bytes(svg_string=svg, width=w, height=h)
    return Image.open(io.BytesIO(data)).convert("RGBA")


def paste_centered(canvas: Image.Image, img: Image.Image) -> None:
    x = (canvas.width - img.width) // 2
    y = (canvas.height - img.height) // 2
    canvas.alpha_composite(img, (x, y))


def save_png(img: Image.Image, buf: io.BytesIO) -> None:
    """Save with alpha preserved. Flat art quantizes losslessly to an 8-bit
    palette (tRNS per-index alpha keeps the AA edges), so use that when the
    palette round-trips pixel-identically; fall back to RGBA otherwise."""
    if img.mode != "RGBA":
        img.convert("RGBA").save(buf, "PNG", optimize=True)
        return
    quantized = img.quantize(colors=256, method=Image.FASTOCTREE, dither=Image.NONE)
    if quantized.convert("RGBA").tobytes() == img.tobytes():
        quantized.save(buf, "PNG", optimize=True)
    else:
        img.save(buf, "PNG", optimize=True)


def build_logo_image(art: IconArt, dark: bool = False) -> Image.Image:
    """1772x1799 wordmark: the mark alone on transparency (no tile), centered — a blue bubble
    with a white star, legible on light and dark navbars alike (`dark` kept for the target table)."""
    W, H = 1772, 1799
    bx, by, bw, bh = 186, 196, 652, 624  # the bubble (with its tail) plus a hair of margin
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}">\n'
        f"  <defs>{gradient('logo', LOGO_STOPS, 0, 0, MARK_SIZE)}</defs>\n"
        f'  <svg x="0" y="0" width="{W}" height="{H}" viewBox="{bx} {by} {bw} {bh}" '
        f'preserveAspectRatio="xMidYMid meet">'
        f'<path fill="url(#logo)" d="{mark_path(art, "bubble")}"/>'
        f'<path fill="#ffffff" d="{mark_path(art, "star")}"/>'
        f'<path fill="#ffffff" d="{mark_path(art, "spark")}"/></svg>\n'
        "</svg>\n"
    )
    return render_svg(svg, (W, H))


def target_bytes(art: IconArt, kind: str, arg: object) -> bytes:
    """Produce the exact bytes for one target. Shared by write + check."""
    if kind == "svg":
        return art.master.encode("utf-8")
    if kind == "svg_dark":
        return art.master_dark.encode("utf-8")
    if kind == "svg_copy":
        return art.master.encode("utf-8")

    buf = io.BytesIO()
    if kind == "png":
        save_png(render(art.master, arg), buf)
    elif kind == "png_mac":
        save_png(render(art.master_mac, arg), buf)
    elif kind == "png_dark":
        save_png(render(art.master_dark, arg), buf)
    elif kind == "png_white":
        render(art.master, arg, background="#ffffff").convert("RGB").save(buf, "PNG", optimize=True)
    elif kind == "png_dark_white":
        render(art.master_dark, arg, background=DARK_HEX).convert("RGB").save(buf, "PNG", optimize=True)
    elif kind == "ico":
        img = render(art.master, max(arg))
        img.save(buf, format="ICO", sizes=[(s, s) for s in arg])
    elif kind == "ico_dark":
        img = render(art.master_dark, max(arg))
        img.save(buf, format="ICO", sizes=[(s, s) for s in arg])
    elif kind == "icns":
        img = render(art.master_mac, 1024)
        frames = [img.resize((s, s), Image.LANCZOS) for s in (16, 32, 64, 128, 256, 512, 1024)]
        img.save(buf, format="ICNS", append_images=frames[1:])
    elif kind == "icns_dark":
        img = render(art.master_mac_dark, 1024)
        frames = [img.resize((s, s), Image.LANCZOS) for s in (16, 32, 64, 128, 256, 512, 1024)]
        img.save(buf, format="ICNS", append_images=frames[1:])
    elif kind == "wide":
        w, h = arg
        canvas = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        paste_centered(canvas, render(art.master, 100))
        canvas.save(buf, "PNG")
    elif kind == "wide_dark":
        w, h = arg
        canvas = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        paste_centered(canvas, render(art.master_dark, 100))
        canvas.save(buf, "PNG")
    elif kind == "logo":
        build_logo_image(art, dark=False).save(buf, "PNG")
    elif kind == "logo_dark":
        build_logo_image(art, dark=True).save(buf, "PNG")
    else:
        raise ValueError(f"unknown kind {kind!r}")
    return buf.getvalue()


def build_art(source: Path) -> tuple[IconArt, IconArt]:
    """Only desktop outputs carry build identity. Shared branding stays stable."""
    art = IconArt(source)
    tag = os.environ.get("SCOUT_PAYLOAD_TAG", "")
    commit = os.environ.get("SCOUT_BUILD_COMMIT", "")
    if commit:
        if tag:
            raise ValueError("Commit builds cannot also select SCOUT_PAYLOAD_TAG")
        if not re.fullmatch(r"[a-f0-9]{40}", commit):
            raise ValueError("SCOUT_BUILD_COMMIT requires an exact full 40-character SHA")
        return art, IconArt(source, colors=("#e34850", "#4a1117"), commit=commit)
    if _CANARY_TAG_RE.match(tag.strip()):
        return art, IconArt(source, colors=("#f5cc32", "#443808"))
    return art, art


def cmd_write(source: Path, out: Path) -> int:
    """Return failure when any target cannot be generated or verified."""
    art, desktop_art = build_art(source)
    written = 0
    failures = 0
    for rel, kind, arg in TARGETS:
        path = out / rel
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            selected = desktop_art if rel.startswith("apps/desktop/") else art
            path.write_bytes(target_bytes(selected, kind, arg))
            written += 1
        except Exception as exc:  # noqa: BLE001 - report all, then fail
            failures += 1
            print(f"  !! {rel}: FAILED ({exc})")
    print(f"[write] wrote {written}/{len(TARGETS)} files")

    print("\n[verify]")
    for rel, kind, arg in TARGETS:
        path = out / rel
        try:
            if kind in ("svg", "svg_dark", "svg_copy"):
                print(f"  {rel}: {path.stat().st_size} bytes SVG")
                continue
            im = Image.open(path)
            if kind in ("ico", "ico_dark"):
                sizes = []
                try:
                    for i in range(im.n_frames):
                        im.seek(i)
                        sizes.append(im.size)
                except Exception:
                    sizes = [im.size]
                print(f"  {rel}: ICO {sorted(set(sizes))}")
            elif kind in ("icns", "icns_dark"):
                print(f"  {rel}: ICNS {im.size} (container)")
            else:
                print(f"  {rel}: {im.format} {im.size}")
        except Exception as exc:
            failures += 1
            print(f"  {rel}: VERIFY FAILED ({exc})")

    return int(failures > 0)


def cmd_check(source: Path, out: Path) -> int:
    """Structural verification: regenerate every target in memory and assert
    the invariants that actually matter (there are no committed bytes to
    byte-compare — outputs are generated on demand)."""
    art, desktop_art = build_art(source)
    problems: list[str] = []

    # every target must generate without error
    for rel, kind, arg in TARGETS:
        try:
            selected = desktop_art if rel.startswith("apps/desktop/") else art
            target_bytes(selected, kind, arg)
        except Exception as exc:  # noqa: BLE001
            problems.append(f"{rel}: REGENERATE FAILED ({exc})")

    # PNG targets must have the expected format + size
    for rel, (fmt, size) in CHECK_SIZES.items():
        path = out / rel
        if not path.exists():
            problems.append(f"{rel}: MISSING (expected generated file)")
            continue
        try:
            im = Image.open(path)
            if im.format != fmt or im.size != size:
                problems.append(f"{rel}: got {im.format} {im.size}, expected {fmt} {size}")
        except Exception as exc:  # noqa: BLE001
            problems.append(f"{rel}: UNREADABLE ({exc})")

    # squircles must keep transparent corners (alpha extrema include 0)
    for rel in (
        "apps/desktop/assets/icon.png",
        "apps/desktop/assets/icon-dark.png",
        "apps/desktop/public/scout-mark.png",
        "apps/desktop/public/scout-mark-dark.png",
        "apps/desktop/public/apple-touch-icon.png",
    ):
        path = out / rel
        if not path.exists():
            continue
        alpha = Image.open(path).convert("RGBA").getchannel("A")
        lo, hi = alpha.getextrema()
        if lo != 0 or hi != 255:
            problems.append(f"{rel}: alpha extrema {alpha.getextrema()}, expected (0, 255) transparent corners")

    # containers must have the right frame sets (parse ICO headers directly —
    # PIL's ICO n_frames is unreliable across versions)
    def ico_sizes(path: Path) -> list[int]:
        data = path.read_bytes()
        count = int.from_bytes(data[4:6], "little")
        sizes = []
        for i in range(count):
            entry = data[6 + i * 16 : 6 + (i + 1) * 16]
            w = entry[0] or 256
            h = entry[1] or 256
            sizes.append(w)
        return sorted(set(sizes))

    for rel, sizes in (
        ("apps/desktop/assets/icon.ico", [16, 24, 32, 48, 64, 128, 256]),
        ("apps/desktop/assets/icon-dark.ico", [16, 24, 32, 48, 64, 128, 256]),
        ("apps/bootstrap-installer/src-tauri/icons/icon.ico", [16, 32, 64, 128, 256]),
    ):
        path = out / rel
        if not path.exists():
            problems.append(f"{rel}: MISSING")
            continue
        try:
            got = ico_sizes(path)
            if got != sizes:
                problems.append(f"{rel}: ICO frames {got}, expected {sizes}")
        except Exception as exc:  # noqa: BLE001
            problems.append(f"{rel}: UNREADABLE ({exc})")

    if not problems:
        print(f"[ok] all {len(TARGETS)} targets generate and pass structural checks")
        return 0

    print(f"[check] {len(problems)} problem(s):")
    for line in problems:
        print(f"  - {line}")
    return 1


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=Path(__file__).resolve().parent.parent)
    parser.add_argument("--out", type=Path, help="Output root (defaults to source for developer builds)")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    source = args.source.resolve()
    out = (args.out or source).resolve()
    command = cmd_check if args.check else cmd_write
    sys.exit(command(source, out))


if __name__ == "__main__":
    main()
