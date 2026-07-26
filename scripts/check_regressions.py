"""Focused regression checks for high-impact Break Free bugs.

Run from the repository root:
  python3 scripts/check_regressions.py
"""

from __future__ import annotations

import subprocess
from pathlib import Path


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


def assert_coach_home_refresh_is_wired(path: Path) -> None:
    text = path.read_text(encoding="utf-8")
    assert "function refreshAfterCoachChange(" in text, (
        f"{path} missing refreshAfterCoachChange helper"
    )
    assert "refreshAfterCoachChange();" in text, (
        f"{path} does not call refreshAfterCoachChange after coach updates"
    )
    assert 'if (route === "home") render();\n    else drawCoach();' not in text, (
        f"{path} still skips drawCoach on the Home route"
    )
    assert "enough for now" in text, f"{path} missing pause chip phrasing"
    assert "ask me something else" in text, f"{path} missing skip chip phrasing"


def main() -> None:
    paths = (ROOT / "app.js", ROOT / "dist" / "BreakFree.html")
    for path in paths:
        assert_help_fallback_is_guarded(path)
        assert_coach_home_refresh_is_wired(path)
    result = subprocess.run(
        ["node", str(ROOT / "scripts" / "check_coach_home_refresh.js")],
        cwd=ROOT,
        check=False,
    )
    assert result.returncode == 0, "check_coach_home_refresh.js failed"
    print("OK regression checks passed")


if __name__ == "__main__":
    main()
