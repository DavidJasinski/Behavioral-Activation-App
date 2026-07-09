"""Focused regression checks for high-impact Break Free bugs.

Run from the repository root:
  python3 scripts/check_regressions.py
"""

from pathlib import Path
import subprocess


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


def assert_storage_migration_preserves_legacy_data() -> None:
    script = r"""
const fs = require("fs");
const vm = require("vm");

const appJs = fs.readFileSync("app.js", "utf8");
const STORAGE_KEY = "breakFree.v1";
const LEGACY_KEY = "baApp.v1";

function boot(initialStorage, failNewKeyWrites = false) {
  const storage = { ...initialStorage };
  const sandbox = {
    console: { warn() {}, log() {}, error() {} },
    document: { addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; } },
    fetch: async () => { throw new Error("no fetch in regression harness"); },
    localStorage: {
      getItem(key) {
        return Object.prototype.hasOwnProperty.call(storage, key) ? storage[key] : null;
      },
      setItem(key, value) {
        if (failNewKeyWrites && key === STORAGE_KEY) {
          const err = new Error("quota exceeded");
          err.name = "QuotaExceededError";
          throw err;
        }
        storage[key] = String(value);
      },
      removeItem(key) {
        delete storage[key];
      }
    },
    setTimeout() {},
    structuredClone
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(
    appJs + "\nglobalThis.__STATE__ = STATE; globalThis.__saveState__ = saveState;",
    sandbox
  );
  return { state: sandbox.__STATE__, saveState: sandbox.__saveState__, storage };
}

const richLegacy = JSON.stringify({
  createdAt: "2026-01-01T00:00:00.000Z",
  user: { name: "" },
  preferences: { tone: "warm", reminders: true, theme: "warm" },
  goals: [{ id: "goal-1", title: "Keep my data", createdAt: "2026-01-01T00:00:00.000Z" }],
  activations: [{ id: "act-1", title: "Walk", createdAt: "2026-01-01T00:00:00.000Z" }],
  logs: [{ id: "log-1", type: "reflection", content: "Important", ts: "2026-01-01T00:00:00.000Z" }],
  coach: { memory: [{ ts: "2026-01-01T00:00:00.000Z", role: "user", text: "remember me" }], topicCounts: {}, facts: [] }
});

const sparseNew = JSON.stringify({
  createdAt: "2026-01-02T00:00:00.000Z",
  goals: [],
  activations: [],
  logs: [],
  coach: { memory: [], topicCounts: {}, facts: [] }
});

const divergentNew = JSON.stringify({
  createdAt: "2026-01-03T00:00:00.000Z",
  goals: [],
  activations: [{ id: "act-new", title: "New current-key plan", createdAt: "2026-01-03T00:00:00.000Z" }],
  logs: [{ id: "log-new", type: "reflection", content: "New current-key log", ts: "2026-01-03T00:00:00.000Z" }],
  coach: { memory: [], topicCounts: {}, facts: [] }
});

const equalLegacy = JSON.stringify({
  createdAt: "2026-01-04T00:00:00.000Z",
  goals: [],
  activations: [{ id: "act-old-equal", title: "Old equal-score plan", createdAt: "2026-01-04T00:00:00.000Z" }],
  logs: [],
  coach: { memory: [], topicCounts: {}, facts: [] }
});

const equalNew = JSON.stringify({
  createdAt: "2026-01-05T00:00:00.000Z",
  goals: [],
  activations: [{ id: "act-new-equal", title: "New equal-score plan", createdAt: "2026-01-05T00:00:00.000Z" }],
  logs: [],
  coach: { memory: [], topicCounts: {}, facts: [] }
});

const currentPreferred = JSON.stringify({
  createdAt: "2026-01-06T00:00:00.000Z",
  preferences: { tone: "concise", reminders: true, theme: "warm" },
  profile: {
    name: "Alice",
    communicationStyle: "concise",
    interviewProgress: { askedTopics: [], currentTopic: null, openCloseAsked: false }
  },
  goals: [],
  activations: [
    { id: "act-current-1", title: "Current plan 1", createdAt: "2026-01-06T00:00:00.000Z" },
    { id: "act-current-2", title: "Current plan 2", createdAt: "2026-01-06T00:00:00.000Z" }
  ],
  logs: [{ id: "log-current", type: "reflection", content: "current", ts: "2026-01-06T00:00:00.000Z" }],
  coach: { mode: "free", memory: [], topicCounts: {}, facts: [] }
});

const staleLegacyProfile = JSON.stringify({
  createdAt: "2026-01-04T00:00:00.000Z",
  preferences: { tone: "warm", reminders: true, theme: "warm" },
  profile: {
    name: "Bob",
    communicationStyle: "warm",
    interviewProgress: { askedTopics: ["name"], currentTopic: "style", openCloseAsked: false }
  },
  goals: [],
  activations: [{ id: "act-legacy-profile", title: "Legacy profile plan", createdAt: "2026-01-04T00:00:00.000Z" }],
  logs: [],
  coach: { mode: "interview", memory: [], topicCounts: {}, facts: [] }
});

let booted = boot({ [LEGACY_KEY]: richLegacy }, true);
if (booted.state.activations.length !== 1 || booted.state.goals.length !== 1) {
  throw new Error("legacy data was not loaded when new-key promotion hit quota");
}

booted.state.activations.push({
  id: "act-2",
  title: "Saved after failed promotion",
  createdAt: "2026-01-02T00:00:00.000Z"
});
booted.saveState();
if (!booted.storage[LEGACY_KEY].includes("Saved after failed promotion")) {
  throw new Error("saveState did not keep writing to legacy storage after promotion failed");
}

booted = boot({ [STORAGE_KEY]: sparseNew, [LEGACY_KEY]: richLegacy });
if (booted.state.activations.length !== 1 || booted.state.goals.length !== 1) {
  throw new Error("sparse new storage shadowed richer legacy user data");
}
if (!booted.storage[STORAGE_KEY].includes("remember me")) {
  throw new Error("richer legacy data was not promoted into the current storage key");
}

booted = boot({ [STORAGE_KEY]: divergentNew, [LEGACY_KEY]: richLegacy });
const activationIds = booted.state.activations.map((item) => item.id).sort().join(",");
if (activationIds !== "act-1,act-new") {
  throw new Error(`divergent current and legacy activations were not merged: ${activationIds}`);
}
if (!booted.storage[STORAGE_KEY].includes("New current-key plan")) {
  throw new Error("current-key data was overwritten during legacy promotion");
}

booted = boot({ [STORAGE_KEY]: equalNew, [LEGACY_KEY]: equalLegacy });
const equalActivationIds = booted.state.activations.map((item) => item.id).sort().join(",");
if (equalActivationIds !== "act-new-equal,act-old-equal") {
  throw new Error(`equal-score current and legacy activations were not merged: ${equalActivationIds}`);
}

booted = boot({ [STORAGE_KEY]: currentPreferred, [LEGACY_KEY]: staleLegacyProfile });
if (booted.state.profile.name !== "Alice") {
  throw new Error(`stale legacy profile name overrode current profile: ${booted.state.profile.name}`);
}
if (booted.state.preferences.tone !== "concise") {
  throw new Error(`stale legacy tone overrode current tone: ${booted.state.preferences.tone}`);
}
if (booted.state.coach.mode !== "free") {
  throw new Error(`stale legacy interview mode overrode current mode: ${booted.state.coach.mode}`);
}
if (booted.state.profile.interviewProgress.currentTopic !== null) {
  throw new Error("stale legacy interview progress overrode current progress");
}
"""
    subprocess.run(["node", "-e", script], cwd=ROOT, check=True)


def assert_storage_migration_is_bundled(path: Path) -> None:
    text = path.read_text(encoding="utf-8")
    assert "function storedStateScore(parsed)" in text, (
        f"{path} does not include the legacy/current storage richness check"
    )
    assert "Could not promote legacy state; continuing with legacy fallback" in text, (
        f"{path} does not include the failed-promotion legacy fallback"
    )


def main() -> None:
    assert_help_fallback_is_guarded(ROOT / "app.js")
    assert_help_fallback_is_guarded(ROOT / "dist" / "BreakFree.html")
    assert_storage_migration_preserves_legacy_data()
    assert_storage_migration_is_bundled(ROOT / "dist" / "BreakFree.html")
    print("OK regression checks passed")


if __name__ == "__main__":
    main()
