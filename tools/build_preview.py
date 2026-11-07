#!/usr/bin/env python3
# Docs: docs/05 - UI-UX/UI Preview.md
"""Build prototypes/ui-preview/preview.html: the template plus the Lucide icons and the outlined wordmark.

Usage: build_preview.py <lucide-static icons folder>. Needs what build_brand.py needs.
"""
import base64
import io
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_brand import wordmark  # noqa: E402
from PIL import Image  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
FOLDER = ROOT / "prototypes" / "ui-preview"
ICONS = ("search house tv clapperboard layout-grid bookmark history inbox settings play info plus check star "
         "thumbs-up thumbs-down pencil lock server film delete rotate-ccw loader-circle").split()


def symbol(folder, name):
    text = (folder / f"{name}.svg").read_text(encoding="utf-8")
    inner = re.search(r"<svg[^>]*>(.*)</svg>", text, re.S).group(1)
    inner = re.sub(r"\s+", " ", re.sub(r"<!--.*?-->", "", inner, flags=re.S)).strip()
    return (f'<symbol id="i-{name}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '
            f'stroke-linecap="round" stroke-linejoin="round">{inner}</symbol>')


def logo_uri(path):
    """Provider logos as images inside the file. An <img> can't run anything an SVG might hold."""
    if path.suffix == ".svg":
        return "data:image/svg+xml;base64," + base64.b64encode(path.read_bytes()).decode()
    image = Image.open(path).convert("RGBA")
    image.thumbnail((96, 96))
    out = io.BytesIO()
    image.save(out, "PNG", optimize=True)
    return "data:image/png;base64," + base64.b64encode(out.getvalue()).decode()


def main():
    icons = Path(sys.argv[1])
    sprite = "".join(symbol(icons, name) for name in ICONS)
    letters, _ = wordmark()
    word = "".join(f'<path d="{d}"/>' for d in letters)
    html = (FOLDER / "template.html").read_text(encoding="utf-8")
    html = html.replace("@@SPRITE@@", sprite).replace("@@WORD@@", word)
    logos = ROOT / "brand" / "providers"
    for key, name in (("NETFLIX", "netflix/symbol-dark.png"), ("JELLYFIN", "jellyfin/symbol-dark.svg"),
                      ("SEERR", "seerr/logo-dark.svg")):
        html = html.replace(f"@@LOGO_{key}@@", logo_uri(logos / name))
    (FOLDER / "preview.html").write_text(html, encoding="utf-8")
    print(f"preview.html, {len(html) // 1024} KB")


if __name__ == "__main__":
    main()
