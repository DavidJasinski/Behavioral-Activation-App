"""Focused regression checks for high-impact Break Free bugs.

Run from the repository root:
  python3 scripts/check_regressions.py
"""

from pathlib import Path
import subprocess


ROOT = Path(__file__).resolve().parent.parent


def extract_load_knowledge(text: str, path: Path) -> str:
    start_marker = "async function loadKnowledge() {"
    end_marker = "\nfunction uid() {"
    start = text.find(start_marker)
    end = text.find(end_marker, start)
    assert start >= 0 and end > start, f"{path} does not contain loadKnowledge()"
    return text[start:end]


def assert_falsy_payload_is_normalized(path: Path) -> None:
    text = path.read_text(encoding="utf-8")
    load_knowledge = extract_load_knowledge(text, path)
    script = f"""
const KNOWLEDGE_URL = "knowledge.json";
let KNOWLEDGE = null;
const window = {{}};
global.fetch = async () => ({{
  ok: true,
  json: async () => null,
}});

{load_knowledge}

loadKnowledge().then((result) => {{
  if (!result || typeof result !== "object") {{
    console.error("loadKnowledge left a falsy payload after settling");
    process.exitCode = 1;
  }}
}}).catch((error) => {{
  console.error(error);
  process.exitCode = 1;
}});
"""
    result = subprocess.run(
        ["node", "-e", script],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, (
        f"{path} does not normalize a falsy knowledge payload:\n"
        f"{result.stdout}{result.stderr}"
    )


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


def main() -> None:
    paths = (ROOT / "app.js", ROOT / "dist" / "BreakFree.html")
    for path in paths:
        assert_help_fallback_is_guarded(path)
        assert_falsy_payload_is_normalized(path)
    print("OK regression checks passed")


if __name__ == "__main__":
    main()
