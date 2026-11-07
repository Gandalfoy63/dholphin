#!/usr/bin/env python3
# Docs: docs/02 - Tech/Downloaded Docs Process.md
"""Check the vault rules: frontmatter, wikilinks, backlinks, orphans, code links, no emojis.

Run before every commit. Exits 1 and lists the problems when a rule is broken.
"""
import re
import sys
from pathlib import Path
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT / "docs"
DOWNLOADED = "00 - Downloaded Docs"
WIKILINK = re.compile(r"\[\[([^\]|#]+)")
CODE_LINK = re.compile(r"\]\((\.\./[^)#]+)(?:#L(\d+)(?:-L(\d+))?)?\)")
EMOJI = re.compile("[\U0001F300-\U0001FAFF☀-➿]")
FIELDS = ("title", "tags", "version", "related")
SOURCE_DIRS = ("src", "providers", "hosts", "tools", "crates", "tests", "packaging", "server")
SOURCE_SUFFIXES = {".ts", ".py", ".sh", ".mjs", ".rs", ".js"}


def check_note(name, path, notes, problems):
    """Check one of our own notes and return the notes it links to."""
    text = path.read_text(encoding="utf-8")
    for field in FIELDS:
        if not re.search(rf"^{field}:", text, re.M):
            problems.append(f"{name}: missing frontmatter {field}")
    if name != "Home" and "## Related" not in text:
        problems.append(f"{name}: missing Related section")
    if EMOJI.search(text):
        problems.append(f"{name}: contains an emoji")
    targets = set(WIKILINK.findall(text))
    for target in targets:
        if target not in notes:
            problems.append(f"{name}: broken link {target}")
    for match in CODE_LINK.finditer(text):
        file = (path.parent / unquote(match.group(1))).resolve()
        if not file.exists():
            problems.append(f"{name}: missing file {match.group(1)}")
        elif match.group(2):
            end = int(match.group(3) or match.group(2))
            if end > len(file.read_text(encoding="utf-8").splitlines()):
                problems.append(f"{name}: line {end} past end of {match.group(1)}")
    return targets


def check_code_map(problems):
    """Every source file is in the Code Map and points back to a note."""
    code_map = (DOCS / "04 - Architecture" / "Code Map.md").read_text(encoding="utf-8")
    for folder in SOURCE_DIRS:
        for file in (ROOT / folder).rglob("*") if (ROOT / folder).exists() else ():
            if file.suffix not in SOURCE_SUFFIXES or "node_modules" in file.parts:
                continue
            rel = file.relative_to(ROOT).as_posix()
            if rel not in code_map:
                problems.append(f"Code Map: {rel} is not listed")
            if "Docs: docs/" not in "".join(file.read_text(encoding="utf-8", errors="replace").splitlines(True)[:3]):
                problems.append(f"{rel}: no 'Docs: docs/...' comment in its first lines")


def main():
    problems = []
    notes = {p.relative_to(DOCS).with_suffix("").as_posix(): p for p in DOCS.rglob("*.md")}
    own = {name: path for name, path in notes.items() if not name.startswith(DOWNLOADED)}
    links = {name: check_note(name, path, notes, problems) for name, path in own.items()}
    for name, targets in links.items():
        for target in targets:
            if target in links and name not in links[target]:
                problems.append(f"{name}: {target} does not link back")
    linked = set().union(*links.values()) if links else set()
    for name in own:
        if name not in linked and name != "Home":
            problems.append(f"{name}: orphan")
    for folder in sorted(p for p in (DOCS / DOWNLOADED).iterdir() if p.is_dir()):
        if not (folder / "README.md").exists():
            problems.append(f"{DOWNLOADED}/{folder.name}: no README.md")
    check_code_map(problems)
    print("\n".join(problems) or f"Docs OK: {len(own)} notes, {len(notes) - len(own)} downloaded pages")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
