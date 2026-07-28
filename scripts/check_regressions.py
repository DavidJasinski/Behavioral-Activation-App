"""Focused regression checks for high-impact Break Free bugs.

Run from the repository root:
  python3 scripts/check_regressions.py
"""

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


def assert_coach_reset_clears_derived_state(path: Path) -> None:
    text = path.read_text(encoding="utf-8")
    assert "function resetCoachConversation(" in text, (
        f"{path} is missing resetCoachConversation"
    )
    assert "STATE.coach.facts = []" in text, (
        f"{path} coach reset does not clear facts"
    )
    assert "STATE.coach.topicCounts = {}" in text, (
        f"{path} coach reset does not clear topicCounts"
    )
    assert 'STATE.coach.mode = "free"' in text, (
        f"{path} coach reset does not exit interview mode"
    )


def main() -> None:
    assert_help_fallback_is_guarded(ROOT / "app.js")
    assert_help_fallback_is_guarded(ROOT / "dist" / "BreakFree.html")
    assert_coach_reset_clears_derived_state(ROOT / "app.js")
    assert_coach_reset_clears_derived_state(ROOT / "dist" / "BreakFree.html")
    print("OK regression checks passed")


if __name__ == "__main__":
    main()
