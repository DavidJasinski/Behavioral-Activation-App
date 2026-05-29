"""Focused regression checks for high-impact Break Free bugs.

Run from the repository root:
  python3 scripts/check_regressions.py
"""

import json
import subprocess
import tempfile
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


def extract_app_js(path: Path) -> str:
    text = path.read_text(encoding="utf-8")
    if path.suffix != ".html":
        return text

    script_marker = '<script>\n"use strict";\n'
    script_start = text.find(script_marker)
    assert script_start != -1, f"{path} does not contain the inlined app script"
    script_start += len("<script>\n")
    script_end = text.find("\n</script>", script_start)
    assert script_end != -1, f"{path} does not close the inlined app script"
    return text[script_start:script_end]


def persistence_bootstrap(js_text: str) -> str:
    state_marker = "const STATE = loadState();"
    load_marker = "function loadState()"
    knowledge_marker = "async function loadKnowledge()"

    assert state_marker in js_text, "app script no longer initializes STATE as expected"
    assert load_marker in js_text, "app script no longer defines loadState()"
    assert knowledge_marker in js_text, "app script no longer defines loadKnowledge()"

    return (
        js_text[: js_text.index(state_marker)]
        + js_text[js_text.index(load_marker) : js_text.index(knowledge_marker)]
        + "\nconst STATE = loadState();\n"
    )


def assert_legacy_migration_quota_safe(path: Path) -> None:
    legacy_state = {
        "user": {"name": "Legacy User"},
        "activations": [{"id": "a1", "title": "walk"}],
        "coach": {"memory": []},
    }
    bootstrap = persistence_bootstrap(extract_app_js(path))
    harness = f"""
const __legacyState = {json.dumps(json.dumps(legacy_state))};
const __stored = new Map([["baApp.v1", __legacyState]]);
globalThis.localStorage = {{
  getItem(key) {{
    return __stored.has(key) ? __stored.get(key) : null;
  }},
  setItem(key, value) {{
    if (key === "breakFree.v1") {{
      throw new DOMException("quota exceeded", "QuotaExceededError");
    }}
    __stored.set(key, value);
  }},
  removeItem(key) {{
    __stored.delete(key);
  }},
}};
globalThis.console = {{ warn() {{}} }};

{bootstrap}

if (STATE.user.name !== "Legacy User") {{
  throw new Error(`expected legacy user to load, got "${{STATE.user.name}}"`);
}}

STATE.user.name = "Saved Legacy";
saveState();
const savedLegacy = JSON.parse(__stored.get("baApp.v1"));
if (savedLegacy.user.name !== "Saved Legacy") {{
  throw new Error("expected saveState() to preserve writes through the legacy key");
}}
"""
    with tempfile.NamedTemporaryFile("w", suffix=".js", encoding="utf-8") as test_file:
        test_file.write(harness)
        test_file.flush()
        result = subprocess.run(
            ["node", test_file.name],
            cwd=ROOT,
            text=True,
            capture_output=True,
            check=False,
        )

    assert result.returncode == 0, (
        f"{path} does not survive legacy migration quota failures\n"
        f"stdout:\n{result.stdout}\n"
        f"stderr:\n{result.stderr}"
    )


def main() -> None:
    assert_help_fallback_is_guarded(ROOT / "app.js")
    assert_help_fallback_is_guarded(ROOT / "dist" / "BreakFree.html")
    assert_legacy_migration_quota_safe(ROOT / "app.js")
    assert_legacy_migration_quota_safe(ROOT / "dist" / "BreakFree.html")
    print("OK regression checks passed")


if __name__ == "__main__":
    main()
