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


def assert_legacy_migration_is_resilient(path: Path) -> None:
    text = path.read_text(encoding="utf-8")
    assert "let shouldMigrateLegacy = false;" in text, (
        f"{path} does not track legacy migration separately from loading"
    )
    assert "catch (migrationError)" in text, (
        f"{path} lets legacy migration write failures abort state loading"
    )
    assert "localStorage.setItem(STORAGE_KEY, raw);" not in text, (
        f"{path} duplicates legacy state before verifying it can be loaded"
    )


def assert_coach_refreshes_open_drawer(path: Path) -> None:
    text = path.read_text(encoding="utf-8")
    assert "function refreshAfterCoachChange()" in text, (
        f"{path} does not centralize coach surface refreshes"
    )
    assert "if (drawer && !drawer.hidden) drawCoach();" in text, (
        f"{path} does not redraw the open coach drawer after coach changes"
    )
    assert 'if (route === "home") render();\n    else drawCoach();' not in text, (
        f"{path} still skips coach drawer redraws on the Home route"
    )


def assert_interview_controls_are_commands(path: Path) -> None:
    text = path.read_text(encoding="utf-8")
    assert "enough|enough for now|that'?s enough" in text, (
        f"{path} does not treat the suggested 'enough for now' control as pause"
    )
    assert "skip|skip this one|next|pass|ask me something else" in text, (
        f"{path} does not treat suggested skip controls as commands"
    )


def assert_forget_recent_clears_recall(path: Path) -> None:
    text = path.read_text(encoding="utf-8")
    assert "STATE.coach.topicCounts = {};" in text, (
        f"{path} forgets visible chat but keeps topic recall metadata"
    )
    assert "STATE.coach.facts = [];" in text, (
        f"{path} forgets visible chat but keeps raw recalled facts"
    )
    assert "I've forgotten the recent conversation." in text, (
        f"{path} does not replace forgotten chat with a neutral reset message"
    )


def main() -> None:
    checked_paths = [ROOT / "app.js", ROOT / "dist" / "BreakFree.html"]
    for path in checked_paths:
        assert_help_fallback_is_guarded(path)
        assert_legacy_migration_is_resilient(path)
        assert_coach_refreshes_open_drawer(path)
        assert_interview_controls_are_commands(path)
        assert_forget_recent_clears_recall(path)
    print("OK regression checks passed")


if __name__ == "__main__":
    main()
