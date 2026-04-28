"""Build shareable bundles of Break Free.

Outputs (under dist/):
  BreakFree.html          — single-file standalone. Open it from any browser
                            (including Android Chrome) directly off the
                            filesystem; no server, no fetch(), no internet.
  break-free-hosted.zip   — multi-file build for hosting on GitHub Pages or any
                            static host. Drop on a server and visit index.html.
                            Adds-to-Home-Screen as a PWA on Android.

Usage:
  python scripts/build_bundle.py
"""

from __future__ import annotations

import base64
import json
import re
import shutil
import zipfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"

HOSTED_FILES = [
    "index.html",
    "styles.css",
    "app.js",
    "knowledge.json",
    "manifest.webmanifest",
    "icon.svg",
    "README.md",
]


def read(name: str) -> str:
    return (ROOT / name).read_text(encoding="utf-8")


def build_single_file() -> Path:
    """Inline everything into one self-contained HTML file."""
    html = read("index.html")
    css = read("styles.css")
    js = read("app.js")
    knowledge = json.loads(read("knowledge.json"))
    icon_svg = read("icon.svg")

    def replace_tag(text: str, pattern: str, replacement: str, label: str) -> str:
        # Use a lambda so backslashes in `replacement` (e.g. \s in inlined JS)
        # are not treated as regex backreferences.
        new_text, n = re.subn(pattern, lambda _m: replacement, text, flags=re.IGNORECASE)
        if n < 1:
            raise RuntimeError(
                f"Expected to replace <{label}> tag in index.html, found 0 matches."
            )
        return new_text

    # Replace the external stylesheet link with an inline <style>.
    html = replace_tag(
        html,
        r'<link\b[^>]*rel\s*=\s*["\']stylesheet["\'][^>]*href\s*=\s*["\']styles\.css["\'][^>]*>',
        f"<style>\n{css}\n</style>",
        "link rel=stylesheet",
    )

    # Replace the external icon links with a data: URL so the favicon works
    # even when opened from the filesystem.
    icon_b64 = base64.b64encode(icon_svg.encode("utf-8")).decode("ascii")
    icon_data_url = f"data:image/svg+xml;base64,{icon_b64}"
    html = replace_tag(
        html,
        r'<link\b[^>]*rel\s*=\s*["\']icon["\'][^>]*href\s*=\s*["\']icon\.svg["\'][^>]*>',
        f'<link rel="icon" type="image/svg+xml" href="{icon_data_url}" />',
        "link rel=icon",
    )
    html = replace_tag(
        html,
        r'<link\b[^>]*rel\s*=\s*["\']apple-touch-icon["\'][^>]*href\s*=\s*["\']icon\.svg["\'][^>]*>',
        f'<link rel="apple-touch-icon" href="{icon_data_url}" />',
        "link rel=apple-touch-icon",
    )

    # Drop the manifest link in single-file mode — manifests can't reasonably
    # be loaded from file:// URLs and trigger noisy console errors otherwise.
    html = re.sub(
        r'<link\b[^>]*rel\s*=\s*["\']manifest["\'][^>]*>\s*',
        "",
        html,
        flags=re.IGNORECASE,
    )

    # Inject the inlined knowledge corpus before the app script tag so it's
    # already on `window` by the time loadKnowledge() runs.
    inline_block = (
        "<script>\n"
        f"window.__KNOWLEDGE_INLINE = {json.dumps(knowledge, ensure_ascii=False)};\n"
        "</script>"
    )

    # Replace the external app.js script (any attribute order: defer, type, etc.)
    # with the inlined corpus + inlined script body.
    pattern = re.compile(r'<script\b[^>]*\bsrc\s*=\s*["\']app\.js["\'][^>]*>\s*</script>', re.IGNORECASE)
    replacement = inline_block + "\n<script>\n" + js + "\n</script>"
    new_html, n = pattern.subn(lambda _m: replacement, html)
    if n != 1:
        raise RuntimeError(
            f"Expected exactly one <script src=app.js> tag in index.html, found {n}. "
            "Update the regex in build_bundle.py to match the actual tag."
        )
    html = new_html

    # Stamp build provenance into a comment near the top of <head>.
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    html = html.replace(
        '<meta charset="utf-8" />',
        f'<meta charset="utf-8" />\n  <!-- BreakFree single-file build {stamp} -->',
    )

    DIST.mkdir(exist_ok=True)
    out = DIST / "BreakFree.html"
    out.write_text(html, encoding="utf-8")
    return out


def build_hosted_zip() -> Path:
    """Zip the multi-file build for static hosting (PWA-ready)."""
    DIST.mkdir(exist_ok=True)
    out = DIST / "break-free-hosted.zip"
    if out.exists():
        out.unlink()
    with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED) as z:
        for name in HOSTED_FILES:
            src = ROOT / name
            if src.exists():
                z.write(src, arcname=f"break-free/{name}")
    return out


def copy_share_doc() -> Path:
    """Copy scripts/SHARE.md into dist/SHARE.md (the user-facing share guide)."""
    src = ROOT / "scripts" / "SHARE.md"
    dst = DIST / "SHARE.md"
    if src.exists():
        shutil.copyfile(src, dst)
    return dst


def main() -> None:
    if DIST.exists():
        shutil.rmtree(DIST)
    DIST.mkdir()

    single = build_single_file()
    zipped = build_hosted_zip()
    share = copy_share_doc()

    for path in (single, zipped, share):
        if path.exists():
            size = path.stat().st_size
            print(f"OK  {path.relative_to(ROOT)}  ({size/1024:.1f} KB)")


if __name__ == "__main__":
    main()
