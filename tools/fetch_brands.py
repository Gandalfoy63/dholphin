#!/usr/bin/env python3
# Docs: docs/05 - UI-UX/Provider Logos.md
"""Download provider logos from Brandfetch into brand/providers/<id>/, using BRANDFETCH_API_KEY from .env.

The key is sent only to api.brandfetch.io and is never written or printed. Standard library only.
"""
import json
import re
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "brand" / "providers"
PROVIDERS = {"netflix": "netflix.com", "jellyfin": "jellyfin.org", "seerr": "seerr.dev"}
UA = {"User-Agent": "Mozilla/5.0 dholphin-brand-fetcher"}


def load_key():
    for line in (ROOT / ".env").read_text(encoding="utf-8").splitlines():
        if line.startswith("BRANDFETCH_API_KEY="):
            return line.split("=", 1)[1].strip()
    raise SystemExit("BRANDFETCH_API_KEY is missing from .env")


def get(url, headers=None):
    request = urllib.request.Request(url, headers={**UA, **(headers or {})})
    with urllib.request.urlopen(request, timeout=40) as response:
        return response.read()


def main():
    key = load_key()
    for pid, domain in PROVIDERS.items():
        try:
            brand = json.loads(get(f"https://api.brandfetch.io/v2/brands/{domain}",
                                   {"Authorization": f"Bearer {key}"}))
        except Exception as error:  # One missing brand must not stop the others. The error never holds the key.
            print(f"{pid}: FAILED {type(error).__name__}: {error}")
            continue
        folder = OUT / pid
        folder.mkdir(parents=True, exist_ok=True)
        files = []
        for logo in brand.get("logos", []):
            for item in logo.get("formats", []):
                name = f"{logo['type']}-{logo.get('theme') or 'any'}.{item['format']}"
                if not re.fullmatch(r"[a-z0-9.-]+", name):
                    continue
                (folder / name).write_bytes(get(item["src"]))
                files.append({"file": name, "type": logo["type"], "theme": logo.get("theme"),
                              "background": item.get("background"), "width": item.get("width")})
        (folder / "brand.json").write_text(json.dumps({
            "name": brand.get("name"), "domain": domain, "claimed": brand.get("claimed"),
            "colors": brand.get("colors"), "files": files}, indent=2) + "\n", encoding="utf-8")
        print(pid, brand.get("name"), [f["file"] for f in files])


if __name__ == "__main__":
    main()
