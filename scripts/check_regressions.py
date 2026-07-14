"""Focused regression checks for high-impact Break Free bugs.

Run from the repository root:
  python3 scripts/check_regressions.py
"""

from pathlib import Path
from zipfile import ZipFile


ROOT = Path(__file__).resolve().parent.parent


def assert_help_fallback_is_guarded(path: Path) -> None:
    text = path.read_text(encoding="utf-8")
    loading_marker = 'Knowledge index loading…'
    unavailable_marker = 'Knowledge index unavailable.'
    guarded_rerender = (
        'if (!KNOWLEDGE) KNOWLEDGE_PROMISE.then(() => route === "help" && renderHelp());'
    )
    unguarded_rerender = (
        'sources.innerHTML = `<li class="muted">Knowledge index loading…</li>`;\n'
        '      KNOWLEDGE_PROMISE.then(() => route === "help" && renderHelp());'
    )

    assert loading_marker in text, f"{path} no longer shows the loading state"
    assert unavailable_marker in text, f"{path} no longer shows the unavailable state"
    assert guarded_rerender in text, f"{path} does not guard the Help-page rerender"
    assert unguarded_rerender not in text, (
        f"{path} can re-enter renderHelp forever after knowledge loading fails"
    )


def assert_distributions_match_source() -> None:
    app_source = (ROOT / "app.js").read_text(encoding="utf-8")
    standalone = (ROOT / "dist" / "BreakFree.html").read_text(encoding="utf-8")
    assert f"<script>\n{app_source}\n</script>" in standalone, (
        "dist/BreakFree.html does not contain the current app.js"
    )

    with ZipFile(ROOT / "dist" / "break-free-hosted.zip") as hosted:
        archived_app = hosted.read("break-free/app.js").decode("utf-8")
    assert archived_app == app_source, (
        "dist/break-free-hosted.zip does not contain the current app.js"
    )


def main() -> None:
    assert_help_fallback_is_guarded(ROOT / "app.js")
    assert_help_fallback_is_guarded(ROOT / "dist" / "BreakFree.html")
    assert_distributions_match_source()
    print("OK regression checks passed")


if __name__ == "__main__":
    main()
