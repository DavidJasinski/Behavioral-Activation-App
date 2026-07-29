"""Focused regression checks for high-impact Break Free bugs.

Run from the repository root:
  python3 scripts/check_regressions.py
"""

from pathlib import Path
import subprocess
import sys


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


def assert_easiest_planned_is_read_only(path: Path) -> None:
    text = path.read_text(encoding="utf-8")
    assert 'name: "easiest_planned"' in text, f"{path} missing easiest_planned intent"
    assert 'kind: "easiest_planned"' in text, f"{path} missing easiest_planned action"
    # suggest must not treat "easiest thing" as a create-activation request
    assert "first small step|easiest thing" not in text, (
        f"{path} still lets suggest intent match 'easiest thing'"
    )
    assert "what's the easiest thing I have planned?" in text, (
        f"{path} missing Coach chip that triggers the bug when misclassified"
    )


def main() -> None:
    assert_help_fallback_is_guarded(ROOT / "app.js")
    assert_help_fallback_is_guarded(ROOT / "dist" / "BreakFree.html")
    assert_easiest_planned_is_read_only(ROOT / "app.js")
    assert_easiest_planned_is_read_only(ROOT / "dist" / "BreakFree.html")
    subprocess.check_call(
        ["node", str(ROOT / "scripts" / "check_easiest_planned.js")]
    )
    print("OK regression checks passed")


if __name__ == "__main__":
    main()
