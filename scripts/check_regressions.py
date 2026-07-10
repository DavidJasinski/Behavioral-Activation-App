"""Focused regression checks for high-impact Break Free bugs.

Run from the repository root:
  python3 scripts/check_regressions.py
"""

from pathlib import Path
import subprocess
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


def run_node_regression(name: str, script: str) -> None:
    result = subprocess.run(
        ["node", "-e", script],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    assert result.returncode == 0, (
        f"{name} failed\nSTDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}"
    )


def assert_legacy_state_survives_failed_promotion() -> None:
    script = textwrap.dedent(
        r"""
        const assert = require("assert");
        const fs = require("fs");
        const vm = require("vm");

        const legacyRaw = JSON.stringify({
          activations: [{ id: "legacy-step", title: "legacy step" }],
          coach: { memory: [], topicCounts: {}, facts: [] }
        });
        const store = new Map([["baApp.v1", legacyRaw]]);
        const context = { __alerts: [] };

        Object.assign(context, {
          console,
          structuredClone,
          setTimeout,
          clearTimeout,
          window: {
            alert(message) {
              context.__alerts.push(message);
            }
          },
          document: {
            addEventListener() {},
            querySelector() { return null; },
            querySelectorAll() { return []; },
            body: { addEventListener() {} }
          },
          localStorage: {
            getItem(key) {
              return store.has(key) ? store.get(key) : null;
            },
            setItem(key, value) {
              if (key === "breakFree.v1") throw new Error("quota exceeded");
              store.set(key, value);
            },
            removeItem(key) {
              store.delete(key);
            }
          },
          fetch() {
            return Promise.reject(new Error("knowledge unavailable in test"));
          }
        });

        vm.createContext(context);
        const source =
          fs.readFileSync("app.js", "utf8") +
          "\n;globalThis.__STATE = STATE;" +
          "\n;globalThis.__saveState = saveState;" +
          "\n;globalThis.__activeStorageKey = () => activeStorageKey;";
        vm.runInContext(source, context);

        assert.equal(context.__STATE.activations.length, 1);
        assert.equal(context.__STATE.activations[0].id, "legacy-step");
        assert.equal(context.__activeStorageKey(), "baApp.v1");
        assert.equal(store.has("breakFree.v1"), false);

        context.__STATE.activations.push({ id: "new-step", title: "new step" });
        assert.equal(context.__saveState(), true);
        const savedLegacy = JSON.parse(store.get("baApp.v1"));
        assert.deepEqual(
          savedLegacy.activations.map((a) => a.id),
          ["legacy-step", "new-step"]
        );
        assert.equal(store.has("breakFree.v1"), false);
        """
    )
    run_node_regression("legacy migration quota regression", script)


def main() -> None:
    assert_help_fallback_is_guarded(ROOT / "app.js")
    assert_help_fallback_is_guarded(ROOT / "dist" / "BreakFree.html")
    assert_legacy_state_survives_failed_promotion()
    print("OK regression checks passed")


if __name__ == "__main__":
    main()
