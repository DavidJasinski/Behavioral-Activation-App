"""Focused regression checks for high-impact Break Free bugs.

Run from the repository root:
  python3 scripts/check_regressions.py
"""

from pathlib import Path
import json
import subprocess
import textwrap


ROOT = Path(__file__).resolve().parent.parent


def run_app_storage_scenario(scenario: str) -> dict:
    script = f"""
    const fs = require("fs");
    const vm = require("vm");
    const app = fs.readFileSync({json.dumps(str(ROOT / "app.js"))}, "utf8");
    const context = {{
      console: {{ warn: () => {{}}, log: () => {{}} }},
      setTimeout,
      clearTimeout,
      structuredClone,
      fetch: async () => ({{ ok: false, status: 404 }}),
      window: {{}},
      document: {{
        addEventListener: () => {{}},
        querySelector: () => null,
        querySelectorAll: () => [],
        createElement: () => ({{}}),
        body: {{ addEventListener: () => {{}}, appendChild: () => {{}} }}
      }},
      confirm: () => true,
      prompt: () => "",
      __result: null
    }};
    vm.createContext(context);
    {textwrap.indent(scenario, "    ")}
    process.stdout.write(JSON.stringify(context.__result));
    """
    completed = subprocess.run(
        ["node", "-e", script],
        cwd=ROOT,
        check=True,
        text=True,
        capture_output=True,
    )
    return json.loads(completed.stdout)


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


def assert_legacy_state_loads_when_promotion_fails() -> None:
    result = run_app_storage_scenario(
        """
        const legacy = JSON.stringify({
          activations: [{ id: "legacy-action", title: "Legacy plan" }],
          coach: { memory: [], topicCounts: {}, facts: [] }
        });
        const store = new Map([["baApp.v1", legacy]]);
        context.localStorage = {
          getItem: (key) => store.has(key) ? store.get(key) : null,
          setItem: (key, value) => {
            if (key === "breakFree.v1") throw new Error("QuotaExceededError");
            store.set(key, value);
          },
          removeItem: (key) => store.delete(key)
        };
        vm.runInContext(app, context);
        context.__result = vm.runInContext(`({
          activationIds: STATE.activations.map((a) => a.id),
          hasLegacy: localStorage.getItem("baApp.v1") !== null,
          hasCurrent: localStorage.getItem("breakFree.v1") !== null
        })`, context);
        """
    )
    assert result["activationIds"] == ["legacy-action"], (
        "legacy baApp.v1 data should still hydrate when breakFree.v1 promotion fails"
    )
    assert result["hasLegacy"] is True, "failed promotion must keep the legacy backup"
    assert result["hasCurrent"] is False, "failed promotion should not create partial current state"


def assert_corrupt_current_state_recovers_from_legacy() -> None:
    result = run_app_storage_scenario(
        """
        const legacy = JSON.stringify({
          goals: [{ id: "legacy-goal", title: "Keep data" }],
          coach: { memory: [], topicCounts: {}, facts: [] }
        });
        const store = new Map([
          ["breakFree.v1", "{not valid json"],
          ["baApp.v1", legacy]
        ]);
        context.localStorage = {
          getItem: (key) => store.has(key) ? store.get(key) : null,
          setItem: (key, value) => store.set(key, value),
          removeItem: (key) => store.delete(key)
        };
        vm.runInContext(app, context);
        context.__result = vm.runInContext(`({
          goalIds: STATE.goals.map((g) => g.id),
          recoveredCurrent: JSON.parse(localStorage.getItem("breakFree.v1")).goals.map((g) => g.id),
          hasLegacy: localStorage.getItem("baApp.v1") !== null
        })`, context);
        """
    )
    assert result["goalIds"] == ["legacy-goal"], (
        "corrupt breakFree.v1 should not shadow a valid legacy backup"
    )
    assert result["recoveredCurrent"] == ["legacy-goal"], (
        "valid legacy backup should be promoted after corrupt current recovery"
    )
    assert result["hasLegacy"] is False, "successful recovery promotion should remove duplicate legacy data"


def assert_successful_legacy_promotion_removes_duplicate() -> None:
    result = run_app_storage_scenario(
        """
        const legacy = JSON.stringify({
          logs: [{ id: "legacy-log", content: "Saved" }],
          coach: { memory: [], topicCounts: {}, facts: [] }
        });
        const store = new Map([["baApp.v1", legacy]]);
        context.localStorage = {
          getItem: (key) => store.has(key) ? store.get(key) : null,
          setItem: (key, value) => store.set(key, value),
          removeItem: (key) => store.delete(key)
        };
        vm.runInContext(app, context);
        context.__result = vm.runInContext(`({
          logIds: STATE.logs.map((l) => l.id),
          promotedLogIds: JSON.parse(localStorage.getItem("breakFree.v1")).logs.map((l) => l.id),
          hasLegacy: localStorage.getItem("baApp.v1") !== null
        })`, context);
        """
    )
    assert result["logIds"] == ["legacy-log"], "legacy data should hydrate after promotion"
    assert result["promotedLogIds"] == ["legacy-log"], "legacy data should be copied to breakFree.v1"
    assert result["hasLegacy"] is False, "successful promotion should remove duplicate legacy data"


def assert_save_state_failure_is_contained() -> None:
    result = run_app_storage_scenario(
        """
        const store = new Map();
        let writes = 0;
        context.localStorage = {
          getItem: (key) => store.has(key) ? store.get(key) : null,
          setItem: (key, value) => {
            writes += 1;
            throw new Error("QuotaExceededError");
          },
          removeItem: (key) => store.delete(key)
        };
        vm.runInContext(app, context);
        let threw = false;
        vm.runInContext('STATE.activations.push({ id: "unsaved", title: "Unsaved" });', context);
        try {
          vm.runInContext("saveState()", context);
        } catch (e) {
          threw = true;
        }
        context.__result = {
          threw,
          writes,
          inMemoryIds: vm.runInContext("STATE.activations.map((a) => a.id)", context)
        };
        """
    )
    assert result["threw"] is False, "saveState should not crash user actions when storage rejects writes"
    assert result["inMemoryIds"] == ["unsaved"], "failed persistence should not roll back in-memory edits"


def main() -> None:
    assert_help_fallback_is_guarded(ROOT / "app.js")
    assert_help_fallback_is_guarded(ROOT / "dist" / "BreakFree.html")
    assert_legacy_state_loads_when_promotion_fails()
    assert_corrupt_current_state_recovers_from_legacy()
    assert_successful_legacy_promotion_removes_duplicate()
    assert_save_state_failure_is_contained()
    print("OK regression checks passed")


if __name__ == "__main__":
    main()
