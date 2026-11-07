#!/usr/bin/env python3
# Docs: docs/02 - Tech/Downloaded Docs Process.md
"""Download official third-party docs into docs/00 - Downloaded Docs as Markdown.

Needs: pip install markdownify pyyaml. Run from anywhere. A page that fails is reported and
listed in that folder's README, so a gap is visible instead of silent. Downloaded files are data: this
script only writes them, it never runs them.
"""
import datetime
import re
import sys
import urllib.request
from pathlib import Path

import yaml
from markdownify import markdownify

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "00 - Downloaded Docs"
TODAY = datetime.date.today().isoformat()
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) dholphin-docs-fetcher"}

GH = "https://raw.githubusercontent.com"
TMDB = "https://developer.themoviedb.org"
CHROME = "https://developer.chrome.com/docs/extensions"
MDN = f"{GH}/mdn/content/main/files/en-us/web"

SOURCES = {
    "Preact": ("11.x", f"{GH}/preactjs/preact-www/master/content/en/guide/v11", {
        t: f"{t.lower()}.md" for t in ("Getting-started", "Components", "Hooks", "Refs", "Context",
                                       "Forms", "Signals", "TypeScript", "API-reference", "Options",
                                       "Debugging")}),
    "Vite": ("8.x", f"{GH}/vitejs/vite/main/docs", {
        "Features": "guide/features.md", "Build": "guide/build.md",
        "Env and Mode": "guide/env-and-mode.md", "Shared Options": "config/shared-options.md",
        "Build Options": "config/build-options.md"}),
    "TypeScript": ("7.x", f"{GH}/microsoft/TypeScript-Website/v2/packages/documentation/copy/en", {
        "tsconfig": "project-config/tsconfig.json.md", "Modules": "modules-reference/Reference.md"}),
    "Vitest": ("5.x", f"{GH}/vitest-dev/vitest/main/docs", {
        "Getting Started": "guide/index.md", "Mocking": "guide/mocking.md", "Expect": "api/expect.md"}),
    "Playwright": ("1.64", f"{GH}/microsoft/playwright/main/docs/src", {
        "Writing Tests": "writing-tests-js.md", "Assertions": "test-assertions-js.md",
        "Chrome Extensions": "chrome-extensions-js-python.md", "Keyboard": "api/class-keyboard.md"}),
    "Lucide": ("1.x", f"{GH}/lucide-icons/lucide/main/docs/guide", {
        "Index": "index.md", "Preact Getting Started": "preact/getting-started.md"}),
    "hls.js": ("1.7", f"{GH}/video-dev/hls.js/master/docs", {"API": "API.md"}),
    "TMDB": ("API v3", TMDB, {
        "Getting Started": "docs/getting-started.md", "Authentication": "docs/authentication-application.md",
        "Image Basics": "docs/image-basics.md", "Rate Limiting": "docs/rate-limiting.md",
        "Append To Response": "docs/append-to-response.md", "Languages": "docs/languages.md",
        "Discover Movie": "reference/discover-movie.md", "Discover TV": "reference/discover-tv.md",
        "Trending All": "reference/trending-all.md", "Movie Details": "reference/movie-details.md",
        "TV Details": "reference/tv-series-details.md", "TV Season": "reference/tv-season-details.md",
        "Movie Recommendations": "reference/movie-recommendations.md",
        "TV Recommendations": "reference/tv-series-recommendations.md",
        "Movie Similar": "reference/movie-similar.md", "Movie Credits": "reference/movie-credits.md",
        "Movie Videos": "reference/movie-videos.md", "Movie Keywords": "reference/movie-keywords.md",
        "Movie External IDs": "reference/movie-external-ids.md",
        "Movie Watch Providers": "reference/movie-watch-providers.md",
        "Search Multi": "reference/search-multi.md", "Find By ID": "reference/find-by-id.md",
        "Genres Movie": "reference/genre-movie-list.md", "Genres TV": "reference/genre-tv-list.md",
        "Search Keyword": "reference/search-keyword.md", "Person Popular": "reference/person-popular-list.md",
        "Search Person": "reference/search-person.md", "Person Details": "reference/person-details.md",
        "Person Combined Credits": "reference/person-combined-credits.md", "Person Images": "reference/person-images.md",
        "TV Aggregate Credits": "reference/tv-series-aggregate-credits.md"}),
    "OMDb": ("1", "https://www.omdbapi.com", {"API": "", "Legal": "legal.htm"}),
    "IMDb Datasets": ("current", "https://developer.imdb.com", {
        "Non-Commercial Datasets": "non-commercial-datasets/"}),
    "Seerr Guides": ("develop", "https://docs.seerr.dev", {
        "Getting Started": "getting-started/", "Migration": "migration-guide/"}),
    "Chrome Extensions": ("Manifest V3", CHROME, {
        "Manifest": "reference/manifest", "Host Permissions": "develop/concepts/declare-permissions",
        "Match Patterns": "develop/concepts/match-patterns",
        "Content Scripts": "develop/concepts/content-scripts",
        "Network Requests": "develop/concepts/network-requests",
        "Cookies API": "reference/api/cookies", "Storage API": "reference/api/storage",
        "Tabs API": "reference/api/tabs", "Runtime API": "reference/api/runtime",
        "Declarative Net Request": "reference/api/declarativeNetRequest"}),
    "Web Platform": ("MDN, living", MDN, {
        "WebAssembly.instantiateStreaming": "webassembly/reference/javascript_interface/instantiatestreaming_static/index.md",
        "Web Animations API": "api/web_animations_api/index.md", "Element.animate": "api/element/animate/index.md",
        "prefers-reduced-motion": "css/reference/at-rules/@media/prefers-reduced-motion/index.md",
        "focus-visible": "css/reference/selectors/_colon_focus-visible/index.md",
        "IndexedDB": "api/indexeddb_api/index.md", "KeyboardEvent.key": "api/keyboardevent/key/index.md",
        "IntersectionObserver": "api/intersection_observer_api/index.md"}),
    "WCAG": ("2.2", "https://www.w3.org/WAI/WCAG22/Understanding", {
        "Contrast Minimum": "contrast-minimum.html", "Focus Visible": "focus-visible.html",
        "Keyboard": "keyboard.html"}),
    "UX Heuristics": ("1994, updated", "https://www.nngroup.com/articles", {
        "Nielsen 10 Heuristics": "ten-usability-heuristics/"}),
    "fontTools": ("current", "https://fonttools.readthedocs.io/en/latest", {
        "SVG Path Pen": "pens/svgPathPen.html", "Transform Pen": "pens/transformPen.html", "ttLib": "ttLib/index.html"}),
    "Pillow": ("stable", "https://pillow.readthedocs.io/en/stable", {
        "Image": "reference/Image.html", "ICO Format": "handbook/image-file-formats.html"}),
    "resvg-py": ("0.5.0", f"{GH}/baseplate-admin/resvg-py/master", {"README": "README.md"}),
    "Inter": ("4.x", f"{GH}/rsms/inter/master", {"README": "README.md", "License": "LICENSE.txt"}),
    "Serde": ("1.x", "https://serde.rs", {"Overview": "", "Attributes": "attributes.html", "Field Attributes": "field-attrs.html"}),
    "Rust WASM": ("stable", "https://doc.rust-lang.org", {
        "Platform wasm32-unknown-unknown": "rustc/platform-support/wasm32-unknown-unknown.html",
        "Linkage": "reference/linkage.html", "FFI": "nomicon/ffi.html"}),
    "Android": ("API 36", "https://developer.android.com", {
        "WebView": "develop/ui/views/layout/webapps/webview", "Load Local Content": "develop/ui/views/layout/webapps/load-local-content",
        "JavascriptInterface": "reference/android/webkit/JavascriptInterface",
        "WebViewAssetLoader": "reference/androidx/webkit/WebViewAssetLoader",
        "TV Get Started": "training/tv/get-started/create", "TV Navigation": "training/tv/get-started/navigation",
        "Sending Users to Another App": "training/basics/intents/sending", "Package Visibility": "training/package-visibility",
        "PackageInstaller": "reference/android/content/pm/PackageInstaller",
        "Unknown App Sources": "reference/android/provider/Settings#ACTION_MANAGE_UNKNOWN_APP_SOURCES",
        "FileProvider": "reference/androidx/core/content/FileProvider",
        "App Signing": "studio/publish/app-signing", "Build Configuration": "build", "Version Your App": "studio/publish/versioning",
        "Network Security Config": "privacy-and-security/security-config"}),
    "GitHub": ("REST 2022-11-28", "https://docs.github.com/en", {
        "Releases API": "rest/releases/releases", "Release Assets API": "rest/releases/assets"}),
    "GitHub CLI": ("current", "https://cli.github.com/manual", {
        "gh release create": "gh_release_create", "gh repo create": "gh_repo_create", "gh release view": "gh_release_view"}),
    "ZXing": ("3.5", f"{GH}/zxing/zxing/master", {"Project README": "README.md", "QRCodeWriter": "core/src/main/java/com/google/zxing/qrcode/QRCodeWriter.java"}),
    "YouTube": ("current", "https://developers.google.com/youtube", {
        "Player Parameters": "player_parameters", "IFrame Player API": "iframe_api_reference",
        "Required Minimum Functionality": "terms/required-minimum-functionality",
        "Developer Policies": "terms/developer-policies"}),
    "Wikidata": ("current", "https://www.wikidata.org/wiki", {
        "Netflix ID property": "Property:P1874", "IMDb ID property": "Property:P345",
        "SPARQL Tutorial": "Wikidata:SPARQL_tutorial", "Award received property": "Property:P166",
        "TMDB movie ID property": "Property:P4947", "TMDB TV ID property": "Property:P4983",
        "Cast member property": "Property:P161", "Voice actor property": "Property:P725",
        "Character role property": "Property:P453", "Language of work property": "Property:P407",
        "TMDB person ID property": "Property:P4985", "Image property": "Property:P18"}),
    "Wikimedia Commons": ("current", "https://commons.wikimedia.org/wiki", {
        "Reusing content": "Commons:Reusing_content_outside_Wikimedia"}),
    "MediaWiki": ("current", "https://www.mediawiki.org/wiki", {"Linking to files (Special:FilePath)": "Help:Linking_to_files",
        "API Imageinfo": "API:Imageinfo", "Extension CommonsMetadata": "Extension:CommonsMetadata", "API CORS": "API:Cross-site_requests",
        "API Parsing wikitext": "API:Parsing_wikitext", "API Etiquette": "API:Etiquette",
        "Wikimedia API rate limits": "Wikimedia_APIs/Rate_limits", "Extension PageImages": "Extension:PageImages", "Wikibase RDF Dump Format (sitelinks)": "Wikibase/Indexing/RDF_Dump_Format"}),
    "Wikipedia": ("current", "https://en.wikipedia.org/wiki", {
        "Reusing Wikipedia content": "Wikipedia:Reusing_Wikipedia_content"}),
    "Wikimedia Foundation": ("current", "https://foundation.wikimedia.org/wiki", {"User-Agent policy": "Policy:Wikimedia_Foundation_User-Agent_Policy"}),
    "Fandom": ("current", "https://www.fandom.com", {"Licensing": "licensing"}),
    "TVmaze": ("current", "https://www.tvmaze.com", {"API": "api"}),
    "Node.js": ("24.x", "https://nodejs.org/docs/latest-v24.x/api", {"HTTP": "http.html", "Crypto": "crypto.html", "File system": "fs.html"}),
    "Docker": ("current", "https://docs.docker.com", {"Dockerfile reference": "reference/dockerfile/",
        "Compose services": "reference/compose-file/services/", "Compose volumes": "reference/compose-file/volumes/", "Volumes": "engine/storage/volumes/"}),
    # Traefik's site draws its pages with script: the same docs, as Markdown, from its repository.
    "Traefik": ("v3", f"{GH}/traefik/traefik/master/docs/content", {"Docker provider": "reference/install-configuration/providers/docker.md",
        "Docker routing labels": "reference/routing-configuration/other-providers/docker.md", "Expose with Docker": "expose/docker/basic.md"}),
    "Unicode": ("17.0", "https://www.unicode.org", {"UAX 38 Unihan": "reports/tr38/", "Unicode License": "license.txt",
        "Hangul Syllables (Core Spec 3.12)": "versions/latest/core-spec/chapter-3/"}),
    "AniList": ("v2", "https://docs.anilist.co/guide", {"Introduction": "introduction", "Terms of use": "terms-of-use",
        "Rate limiting": "rate-limiting", "GraphQL": "graphql/"}),
    "Google Knowledge Graph": ("v1", "https://developers.google.com/knowledge-graph", {"Overview": "",
        "Reference": "reference/rest/v1", "Authorizing": "how-tos/authorizing"}),
    "Netflix Help": ("2026-11", "https://help.netflix.com/en/node", {
        "TV Experience": "321880164349028", "Recommendations": "100639/", "Search and Browse": "47765",
        "Viewing History": "101917"}),
}

SEERR_API = f"{GH}/seerr-team/seerr/develop/seerr-api.yml"
JIKAN_API = f"{GH}/jikan-me/jikan-rest/master/storage/api-docs/api-docs.json"
TRAKT_API = "https://jsapi.apiary.io/apis/trakt.apib"
# The blueprint files the movie endpoints (trending, ratings…) under its Languages group.
TRAKT_GROUPS = {"Languages": "Movies", "Shows": "Shows", "People": "People", "Search": "Search"}


def fetch(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=40) as response:
        return response.read().decode("utf-8", "replace")


def to_markdown(text, url):
    """Keep Markdown as it is, convert HTML, keep only the page's main content."""
    if url.endswith(".md") or not text.lstrip().lower().startswith(("<!doctype", "<html")):
        return text
    text = re.sub(r"(?is)<(script|style|nav|header|footer|aside|svg|noscript)\b.*?</\1>", "", text)
    for tag in ("main", "article"):
        match = re.search(rf"(?is)<{tag}\b.*?</{tag}>", text)
        if match:
            text = match.group(0)
            break
    return re.sub(r"\n{3,}", "\n\n", markdownify(text, heading_style="ATX"))


def write_readme(folder, name, version, url, pages, failed, note=""):
    lines = [f"# {name}", "", f"- Source: {url}", f"- Version: {version}", f"- Downloaded: {TODAY}"]
    if note:
        lines.append(f"- Note: {note}")
    lines += ["", "## Pages", ""] + [f"- [[00 - Downloaded Docs/{name}/{p}|{p}]]" for p in sorted(pages)]
    if failed:
        lines += ["", "## Could not be downloaded", ""] + [f"- {p}" for p in failed]
    (folder / "README.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def fetch_group(name, version, base, pages):
    folder = OUT / name
    folder.mkdir(parents=True, exist_ok=True)
    done, failed = [], []
    for title, path in pages.items():
        url = f"{base}/{path}" if path else base
        try:
            text = to_markdown(fetch(url), url)
            if len(text.strip()) < 200:
                raise ValueError("page was almost empty")
            (folder / f"{title}.md").write_text(f"<!-- Source: {url} -->\n\n{text}", encoding="utf-8")
            done.append(title)
        except Exception as error:  # A gap is recorded in the README, the rest still runs.
            failed.append(f"{title}: {url} ({type(error).__name__}: {error})")
    write_readme(folder, name, version, base, done, failed)
    print(f"{name}: {len(done)} ok, {len(failed)} failed")
    for line in failed:
        print("  " + line)


def fetch_seerr():
    """The API is one OpenAPI file: split it into one note per tag."""
    folder = OUT / "Seerr API"
    folder.mkdir(parents=True, exist_ok=True)
    raw = fetch(SEERR_API)
    spec = yaml.safe_load(raw)
    by_tag = {}
    for path, methods in spec["paths"].items():
        for method, op in methods.items():
            if isinstance(op, dict):
                for tag in op.get("tags", ["other"]):
                    by_tag.setdefault(tag, []).append((method.upper(), path, op))
    pages = []
    for tag, operations in sorted(by_tag.items()):
        out = [f"<!-- Source: {SEERR_API} -->", "", f"# Seerr API: {tag}", ""]
        for method, path, op in operations:
            out += [f"## {method} {path}", "", op.get("summary", ""), "", op.get("description", ""), ""]
            out += ["```yaml", yaml.safe_dump({k: op[k] for k in ("parameters", "requestBody", "responses") if k in op},
                                              sort_keys=False, allow_unicode=True), "```", ""]
        title = tag.title()
        (folder / f"{title}.md").write_text("\n".join(out), encoding="utf-8")
        pages.append(title)
    security = yaml.safe_dump(spec.get("components", {}).get("securitySchemes", {}), sort_keys=False)
    schemas = yaml.safe_dump(spec.get("components", {}).get("schemas", {}), sort_keys=False, allow_unicode=True)
    (folder / "Schemas.md").write_text(f"# Seerr API: schemas\n\n## Security\n\n```yaml\n{security}```\n\n"
                                       f"## Schemas\n\n```yaml\n{schemas}```\n", encoding="utf-8")
    pages.append("Schemas")
    write_readme(folder, "Seerr API", spec.get("info", {}).get("version", "develop"), SEERR_API, pages, [],
                 "Generated from the official OpenAPI file, one note per tag.")
    print(f"Seerr API: {len(pages)} notes")


def fetch_jikan():
    """Jikan's API is one OpenAPI file: keep the anime, people and top lists, one note per tag."""
    import json
    folder = OUT / "Jikan"
    folder.mkdir(parents=True, exist_ok=True)
    spec = json.loads(fetch(JIKAN_API))
    by_tag = {}
    for path, methods in spec["paths"].items():
        for method, op in methods.items():
            for tag in op.get("tags", ["other"]):
                if tag in ("anime", "people", "top", "seasons", "characters"):
                    by_tag.setdefault(tag, []).append((method.upper(), path, op))
    pages = []
    for tag, operations in sorted(by_tag.items()):
        out = [f"<!-- Source: {JIKAN_API} -->", "", f"# Jikan API: {tag}", ""]
        for method, path, op in operations:
            out += [f"## {method} https://api.jikan.moe/v4{path}", "", op.get("summary", ""), "", op.get("description", ""), ""]
            out += ["```yaml", yaml.safe_dump({k: op[k] for k in ("parameters", "responses") if k in op}, sort_keys=False, allow_unicode=True), "```", ""]
        (folder / f"{tag.title()}.md").write_text("\n".join(out), encoding="utf-8")
        pages.append(tag.title())
    info = spec.get("info", {}).get("description", "")
    (folder / "Overview.md").write_text(f"<!-- Source: {JIKAN_API} -->\n\n# Jikan API\n\n{info}\n", encoding="utf-8")
    write_readme(folder, "Jikan", spec.get("info", {}).get("version", "v4"), JIKAN_API, pages + ["Overview"], [],
                 "Unofficial MyAnimeList API, split by tag")
    print(f"Jikan: {len(pages) + 1} ok")


def fetch_trakt():
    """Trakt's API is one API Blueprint: keep the introduction and the groups Dholphin reads."""
    folder = OUT / "Trakt"
    folder.mkdir(parents=True, exist_ok=True)
    raw = fetch(TRAKT_API)
    parts = re.split(r"(?m)^# Group ", raw)
    (folder / "Introduction.md").write_text(f"<!-- Source: {TRAKT_API} -->\n\n{parts[0]}", encoding="utf-8")
    pages = ["Introduction"]
    for part in parts[1:]:
        title = part.split("\n", 1)[0].strip()
        if title in TRAKT_GROUPS:
            title = TRAKT_GROUPS[title]
            (folder / f"{title}.md").write_text(f"<!-- Source: {TRAKT_API} -->\n\n# Group {part}", encoding="utf-8")
            pages.append(title)
    write_readme(folder, "Trakt", "2", TRAKT_API, pages, [], "API Blueprint, split by group")
    print(f"Trakt: {len(pages)} ok")


def main():
    only = set(sys.argv[1:])
    for name, (version, base, pages) in SOURCES.items():
        if not only or name in only:
            fetch_group(name, version, base, pages)
    if not only or "Seerr API" in only:
        fetch_seerr()
    if not only or "Jikan" in only:
        fetch_jikan()
    if not only or "Trakt" in only:
        fetch_trakt()


if __name__ == "__main__":
    main()
