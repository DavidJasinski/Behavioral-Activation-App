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


def assert_legacy_migration_survives_quota_failure() -> None:
    app_js = (ROOT / "app.js").as_posix()
    script = textwrap.dedent(
        f"""
        const fs = require("fs");
        const vm = require("vm");

        const legacyState = {{
          goals: [{{ id: "legacy-goal", title: "keep me", createdAt: "2026-01-01T00:00:00.000Z" }}],
          activations: [],
          logs: [],
          coach: {{ memory: [], topicCounts: {{}}, facts: [] }}
        }};
        const storage = new Map([["baApp.v1", JSON.stringify(legacyState)]]);
        let allowNewKey = false;
        const context = {{
          console: {{ log: console.log, warn() {{}}, error: console.error }},
          structuredClone,
          window: {{}},
          fetch: async () => ({{ ok: false, status: 404 }}),
          document: {{ addEventListener() {{}} }},
          localStorage: {{
            getItem(key) {{
              return storage.has(key) ? storage.get(key) : null;
            }},
            setItem(key, value) {{
              if (key === "breakFree.v1" && !allowNewKey) {{
                throw new Error("QuotaExceededError");
              }}
              storage.set(key, String(value));
            }},
            removeItem(key) {{
              storage.delete(key);
            }}
          }}
        }};

        vm.createContext(context);
        vm.runInContext(
          fs.readFileSync({app_js!r}, "utf8") +
            "\\nglobalThis.__regression = {{ STATE, saveState, get activeStorageKey() {{ return activeStorageKey; }} }};",
          context
        );

        if (context.__regression.STATE.goals[0]?.id !== "legacy-goal") {{
          throw new Error("legacy state was discarded when migration write failed");
        }}
        if (context.__regression.activeStorageKey !== "baApp.v1") {{
          throw new Error("writes should stay on the legacy key until migration succeeds");
        }}

        context.__regression.STATE.goals.push({{
          id: "new-goal",
          title: "persist me",
          createdAt: "2026-01-02T00:00:00.000Z"
        }});
        context.__regression.saveState();

        const savedLegacy = JSON.parse(storage.get("baApp.v1"));
        if (!savedLegacy.goals.some((goal) => goal.id === "new-goal")) {{
          throw new Error("saveState did not preserve writes on the legacy key");
        }}

        allowNewKey = true;
        context.__regression.saveState();

        if (context.__regression.activeStorageKey !== "breakFree.v1") {{
          throw new Error("writes should promote to the new key after migration succeeds");
        }}
        if (storage.has("baApp.v1")) {{
          throw new Error("successful migration should remove the legacy duplicate");
        }}
        const savedCurrent = JSON.parse(storage.get("breakFree.v1"));
        if (!savedCurrent.goals.some((goal) => goal.id === "new-goal")) {{
          throw new Error("promoted state is missing legacy-key writes");
        }}
        """
    )
    subprocess.run(["node", "-e", script], check=True)


def main() -> None:
    assert_help_fallback_is_guarded(ROOT / "app.js")
    assert_help_fallback_is_guarded(ROOT / "dist" / "BreakFree.html")
    assert_legacy_migration_survives_quota_failure()
    print("OK regression checks passed")


if __name__ == "__main__":
    main()
