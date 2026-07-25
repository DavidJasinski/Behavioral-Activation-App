"""Focused regression checks for high-impact Break Free bugs.

Run from the repository root:
  python3 scripts/check_regressions.py
"""

from __future__ import annotations

import subprocess
import sys
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


def assert_calendar_day_keys_are_local(path: Path) -> None:
    text = path.read_text(encoding="utf-8")
    assert "function coerceLocalDate(" in text, f"{path} missing coerceLocalDate helper"
    assert "function isDateOnlyString(" in text, f"{path} missing isDateOnlyString helper"
    assert "coerceLocalDate(calendarSelected)" in text, (
        f"{path} day agenda does not coerce calendarSelected locally"
    )
    assert "activationsOnDay(new Date(calendarSelected))" not in text, (
        f"{path} still constructs UTC-shifted Date from calendarSelected"
    )


def main() -> None:
    assert_help_fallback_is_guarded(ROOT / "app.js")
    assert_help_fallback_is_guarded(ROOT / "dist" / "BreakFree.html")
    assert_calendar_day_keys_are_local(ROOT / "app.js")
    assert_calendar_day_keys_are_local(ROOT / "dist" / "BreakFree.html")
    subprocess.run(
        ["node", str(ROOT / "scripts" / "check_calendar_day_keys.js")],
        check=True,
        cwd=ROOT,
    )
    print("OK regression checks passed")


if __name__ == "__main__":
    main()
