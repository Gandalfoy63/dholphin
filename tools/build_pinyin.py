# Docs: docs/05 - UI-UX/Focus and Remote.md
# Purpose: builds data/pinyin.json, pinyin without tones to Chinese characters by use, from Unicode's Unihan kHanyuPinlu.
"""Usage: python3 tools/build_pinyin.py <Unihan_Readings.txt>

kHanyuPinlu gives each character's readings with how often each is used (UAX 38). The output maps each reading
without tone marks (ü written v, as pinyin keyboards do) to its characters, most used first.
"""
import json
import re
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
READING = re.compile(r"([^\s(]+)\((\d+)\)")


def plain(py: str) -> str:
    # ǜ and the like split into u, a diaeresis and a tone mark: the diaeresis makes it v.
    py = unicodedata.normalize("NFD", py).replace("u\u0308", "v").replace("U\u0308", "v")
    return "".join(c for c in py if not unicodedata.combining(c)).lower()


def main() -> None:
    found: dict[str, dict[str, int]] = {}
    for line in Path(sys.argv[1]).read_text(encoding="utf-8").splitlines():
        if "\tkHanyuPinlu\t" not in line:
            continue
        code, _, value = line.split("\t")
        char = chr(int(code[2:], 16))
        for py, n in READING.findall(value):
            key = plain(py)
            found.setdefault(key, {})
            found[key][char] = max(found[key].get(char, 0), int(n))
    out = {k: "".join(sorted(v, key=lambda c: -v[c])) for k, v in sorted(found.items())}
    (ROOT / "data/pinyin.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"{len(out)} readings, {sum(len(v) for v in out.values())} entries")


if __name__ == "__main__":
    main()
