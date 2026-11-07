#!/usr/bin/env python3
# Docs: docs/05 - UI-UX/Logo.md
"""Build every logo file in brand/logo/ from the master geometry below.

Needs: pip install resvg_py pillow fonttools. Files are generated, so change the geometry here and run this again.
"""
import io
import json
from pathlib import Path

import resvg_py
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "brand" / "logo"
FONT = ROOT / "brand" / "fonts" / "inter-latin-700-normal.woff"

RED, DARK, LIGHT, WHITE, BLACK = "#E5232D", "#0E0E10", "#F4F4F5", "#FFFFFF", "#000000"

D_OUTER = "M40 32H120A96 96 0 0 1 120 224H40Z"
DOLPHIN = ("M68 170A63 63 0 0 1 103.6 113.3C107.7 104.2 106.4 90.5 99.5 78C117.3 83.7 132.4 94.6 144.7 108.5"
           "A63 63 0 0 1 194 170A86 86 0 0 0 68 170Z")
# Small cut, for 32 px and below: a larger, thicker dolphin, so the cutout stays open.
DOLPHIN_SMALL = ("M60 178A72 72 0 0 1 92 118C96 102 94 84 84 66C110 74 132 88 148 106A72 72 0 0 1 204 178"
                 "A92 92 0 0 0 60 178Z")
SYMBOL = D_OUTER + DOLPHIN
SYMBOL_SMALL = D_OUTER + DOLPHIN_SMALL


def wordmark(size=132, x=260, base=176, tracking=-0.01):
    """Return 'dholphin' as outlined letters and the x where it ends. Inter Bold, SIL Open Font License."""
    font = TTFont(FONT)
    glyphs, cmap, scale = font.getGlyphSet(), font.getBestCmap(), size / font["head"].unitsPerEm
    letters = []
    for char in "dholphin":
        name = cmap[ord(char)]
        pen = SVGPathPen(glyphs, ntos=lambda v: f"{v:.1f}".rstrip("0").rstrip("."))
        glyphs[name].draw(TransformPen(pen, (scale, 0, 0, -scale, x, base)))
        letters.append(pen.getCommands())
        x += glyphs[name].width * scale + tracking * size
    return letters, x


def svg(width, height, body, title="Dholphin logo"):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" width="{width}" height="{height}" '
            f'role="img" aria-label="{title}">{body}</svg>\n')


def symbol_path(color, small=False):
    return f'<path fill="{color}" fill-rule="evenodd" d="{SYMBOL_SMALL if small else SYMBOL}"/>'


def tile(bg, fg, small=False, radius=56):
    """Symbol on a rounded square, nudged to its optical centre."""
    return (f'<rect width="256" height="256" rx="{radius}" fill="{bg}"/>'
            f'<g transform="translate(128 128) scale(.74) translate(-122 -128)">{symbol_path(fg, small)}</g>')


def png(markup, width, height):
    data = bytes(resvg_py.svg_to_bytes(svg_string=markup, width=width, height=height))
    return Image.open(io.BytesIO(data)).convert("RGBA")


def main():
    for folder in ("svg", "png", "web"):
        (OUT / folder).mkdir(parents=True, exist_ok=True)
    letters, end = wordmark()
    width = round(end + 40)
    word = "".join(f'<path d="{d}"/>' for d in letters)

    symbols = {"red": RED, "white": WHITE, "black": BLACK, "dark": DARK}
    files = {f"symbol-{n}": svg(256, 256, symbol_path(c)) for n, c in symbols.items()}
    files |= {f"symbol-small-{n}": svg(256, 256, symbol_path(c, True)) for n, c in symbols.items()}
    lockups = {"on-dark": (RED, LIGHT), "on-light": (RED, DARK), "white": (WHITE, WHITE), "black": (BLACK, BLACK)}
    for name, (mark, text) in lockups.items():
        files[f"lockup-{name}"] = svg(width, 256, symbol_path(mark) + f'<g fill="{text}">{word}</g>')
    files["app-icon"] = svg(256, 256, tile(RED, WHITE))
    files["favicon"] = svg(256, 256, tile(RED, WHITE, small=True))
    # 320 x 180 CoolDash banner: the lockup centred on the app's background.
    scale = 280 / width
    files["banner"] = svg(320, 180, f'<rect width="320" height="180" fill="{DARK}"/><g transform="translate(20 '
                                    f'{90 - 128 * scale:.1f}) scale({scale:.4f})">{symbol_path(RED)}'
                                    f'<g fill="{LIGHT}">{word}</g></g>')
    for name, markup in files.items():
        (OUT / "svg" / f"{name}.svg").write_text(markup, encoding="utf-8")

    # Size ranges: 32 px and below use the small cut.
    for size in (48, 64, 128, 256, 512, 1024):
        png(files["symbol-red"], size, size).save(OUT / "png" / f"symbol-red-{size}.png")
        png(files["symbol-white"], size, size).save(OUT / "png" / f"symbol-white-{size}.png")
    for size in (16, 24, 32):
        png(files["symbol-small-red"], size, size).save(OUT / "png" / f"symbol-red-{size}.png")
        png(files["symbol-small-white"], size, size).save(OUT / "png" / f"symbol-white-{size}.png")
    for name in ("on-dark", "on-light", "white", "black"):
        png(files[f"lockup-{name}"], 1660, round(1660 * 256 / width)).save(OUT / "png" / f"lockup-{name}.png")
    png(files["app-icon"], 256, 256).save(OUT / "png" / "cooldash-icon.png")
    png(files["banner"], 320, 180).convert("RGB").save(OUT / "png" / "cooldash-banner.png")
    png(files["app-icon"], 1024, 1024).save(OUT / "png" / "app-icon-1024.png")

    for size in (32, 180, 192, 512):
        source = files["favicon"] if size == 32 else files["app-icon"]
        png(source, size, size).save(OUT / "web" / f"icon-{size}.png")
    (OUT / "web" / "favicon.svg").write_text(files["favicon"], encoding="utf-8")
    sizes = [(16, 16), (24, 24), (32, 32), (48, 48)]
    png(files["favicon"], 256, 256).save(OUT / "web" / "favicon.ico", sizes=sizes)
    (OUT / "web" / "site.webmanifest").write_text(json.dumps({
        "name": "Dholphin", "short_name": "Dholphin", "theme_color": DARK, "background_color": DARK,
        "display": "standalone", "icons": [{"src": f"icon-{s}.png", "sizes": f"{s}x{s}", "type": "image/png"}
                                           for s in (192, 512)]}, indent=2) + "\n", encoding="utf-8")
    print(f"{sum(1 for p in OUT.rglob('*') if p.is_file())} files in {OUT}")


if __name__ == "__main__":
    main()
