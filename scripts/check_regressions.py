"""Focused regression checks for high-impact Break Free bugs.

Run from the repository root:
  python3 scripts/check_regressions.py
"""

from pathlib import Path
import subprocess
import tempfile
import textwrap


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


def assert_storage_migration_recovers_legacy_data() -> None:
    script = textwrap.dedent(
        f"""
        const fs = require("fs");
        const vm = require("vm");
        const code = fs.readFileSync({str(ROOT / "app.js")!r}, "utf8");

        class Storage {{
          constructor(entries) {{ this.map = new Map(entries); }}
          getItem(key) {{ return this.map.has(key) ? this.map.get(key) : null; }}
          setItem(key, value) {{ this.map.set(key, String(value)); }}
          removeItem(key) {{ this.map.delete(key); }}
        }}

        function assert(condition, message) {{
          if (!condition) throw new Error(message);
        }}

        function load(entries) {{
          const context = {{
            console: {{ warn() {{}}, log() {{}}, error() {{}} }},
            fetch: async () => {{ throw new Error("offline"); }},
            localStorage: new Storage(entries),
            window: {{}},
            document: {{ addEventListener() {{}} }}
          }};
          vm.runInNewContext(code + "\\nglobalThis.__STATE = STATE;", context);
          return {{ state: context.__STATE, storage: context.localStorage }};
        }}

        const legacyRich = {{
          createdAt: "2026-04-01T00:00:00.000Z",
          goals: [{{ id: "g-legacy", title: "legacy goal", createdAt: "2026-04-01T00:00:00.000Z" }}],
          activations: [{{ id: "a-legacy", title: "legacy activation", createdAt: "2026-04-01T00:00:00.000Z" }}],
          logs: [{{ id: "l-legacy", type: "reflection", content: "legacy log", ts: "2026-04-01T00:00:00.000Z" }}],
          profile: {{ name: "Ada", values: ["health"] }},
          coach: {{
            memory: [{{ ts: "2026-04-01T00:00:00.000Z", role: "coach", text: "legacy coach" }}],
            topicCounts: {{ health: 1 }},
            facts: []
          }}
        }};

        let result = load([
          ["breakFree.v1", JSON.stringify({{ goals: [], activations: [], logs: [], profile: {{}}, coach: {{ memory: [] }} }})],
          ["baApp.v1", JSON.stringify(legacyRich)]
        ]);
        assert(result.state.activations.some((a) => a.id === "a-legacy"), "richer legacy activation was not restored");
        assert(result.state.goals.some((g) => g.id === "g-legacy"), "richer legacy goal was not restored");
        assert(result.storage.getItem("baApp.v1") === null, "promoted duplicate legacy key was not removed");

        const currentWithNewData = {{
          goals: [],
          activations: [{{ id: "a-current", title: "current activation", createdAt: "2026-05-01T00:00:00.000Z" }}],
          logs: [],
          profile: {{}},
          coach: {{ memory: [] }}
        }};
        result = load([
          ["breakFree.v1", JSON.stringify(currentWithNewData)],
          ["baApp.v1", JSON.stringify(legacyRich)]
        ]);
        assert(result.state.activations.some((a) => a.id === "a-current"), "current activation was lost during legacy recovery");
        assert(result.state.activations.some((a) => a.id === "a-legacy"), "legacy activation was not merged during recovery");

        result = load([
          ["breakFree.v1", JSON.stringify({{
            goals: null,
            activations: {{}},
            logs: null,
            profile: {{ values: "bad", interviewProgress: {{ askedTopics: "bad" }} }},
            coach: {{ memory: null, topicCounts: null, facts: null }}
          }})]
        ]);
        assert(Array.isArray(result.state.goals), "invalid goals shape was not normalized");
        assert(Array.isArray(result.state.activations), "invalid activations shape was not normalized");
        assert(Array.isArray(result.state.coach.memory), "invalid coach memory shape was not normalized");
        assert(Array.isArray(result.state.profile.values), "invalid profile values shape was not normalized");
        """
    )
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False) as f:
        f.write(script)
        script_path = f.name
    subprocess.run(["node", script_path], check=True)


def main() -> None:
    assert_help_fallback_is_guarded(ROOT / "app.js")
    assert_help_fallback_is_guarded(ROOT / "dist" / "BreakFree.html")
    assert_storage_migration_recovers_legacy_data()
    print("OK regression checks passed")


if __name__ == "__main__":
    main()
