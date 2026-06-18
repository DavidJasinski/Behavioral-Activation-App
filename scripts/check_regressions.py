"""Focused regression checks for high-impact Break Free bugs.

Run from the repository root:
  python3 scripts/check_regressions.py
"""

import json
import subprocess
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


def run_app_storage_scenario(
    path: Path,
    legacy_state: dict,
    set_new_key_fails: bool,
    current_state: dict | None = None,
    expected_loaded_name: str | None = None,
    expected_struggle_note: str | None = None,
) -> str:
    source = path.read_text(encoding="utf-8")
    store_entries = {"baApp.v1": json.dumps(legacy_state)}
    if current_state is not None:
        store_entries["breakFree.v1"] = json.dumps(current_state)
    expected_name = expected_loaded_name or legacy_state["user"]["name"]
    failing_set_item = """
    if (key === "breakFree.v1") {
      const err = new Error("quota exceeded");
      err.name = "QuotaExceededError";
      throw err;
    }
""" if set_new_key_fails else ""
    script = f"""
const vm = require("node:vm");
const source = {json.dumps(source + "\nglobalThis.__STATE = STATE; globalThis.__saveState = saveState;")};
const store = new Map(Object.entries({json.dumps(store_entries)}));
const localStorage = {{
  getItem(key) {{
    return store.has(key) ? store.get(key) : null;
  }},
  setItem(key, value) {{
{failing_set_item}
    store.set(key, String(value));
  }},
  removeItem(key) {{
    store.delete(key);
  }}
}};
const context = {{
  console: {{ warn() {{}}, log() {{}}, error() {{}} }},
  localStorage,
  structuredClone,
  window: {{}},
  document: {{ addEventListener() {{}} }},
  fetch: () => Promise.reject(new Error("offline"))
}};
vm.createContext(context);
vm.runInContext(source, context, {{ filename: {json.dumps(str(path))} }});

if (context.__STATE.user.name !== {json.dumps(expected_name)}) {{
  throw new Error("loadState did not preserve readable legacy data");
}}
if (
  {json.dumps(expected_struggle_note)} !== null &&
  !(context.__STATE.profile.struggleNotes || []).includes({json.dumps(expected_struggle_note)})
) {{
  throw new Error("loadState did not recover legacy profile notes");
}}

context.__STATE.user.name = "Updated " + context.__STATE.user.name;
context.__saveState();

process.stdout.write(JSON.stringify(Object.fromEntries(store.entries())));
"""
    result = subprocess.run(
        ["node", "-e", script],
        cwd=ROOT,
        text=True,
        capture_output=True,
    )
    if result.returncode != 0:
        details = (result.stderr or result.stdout).strip()
        raise AssertionError(details)
    return result.stdout


def assert_legacy_state_survives_quota_failure(path: Path) -> None:
    legacy_state = {
        "user": {"name": "Legacy User"},
        "profile": {"name": "Legacy User"},
        "activations": [{"id": "legacy-step", "title": "kept"}],
        "goals": [],
        "logs": [],
        "coach": {"mode": "free", "memory": [], "topicCounts": {}, "facts": []},
    }
    store = json.loads(run_app_storage_scenario(path, legacy_state, set_new_key_fails=True))

    assert "breakFree.v1" not in store, "quota-failed migration wrote a shadow new key"
    saved_legacy = json.loads(store["baApp.v1"])
    assert saved_legacy["user"]["name"] == "Updated Legacy User", (
        "saveState did not preserve writes to the legacy key while promotion is blocked"
    )


def assert_successful_legacy_promotion_removes_duplicate(path: Path) -> None:
    legacy_state = {
        "user": {"name": "Promoted User"},
        "profile": {"name": "Promoted User"},
        "activations": [{"id": "promoted-step", "title": "kept"}],
        "goals": [],
        "logs": [],
        "coach": {"mode": "free", "memory": [], "topicCounts": {}, "facts": []},
    }
    store = json.loads(run_app_storage_scenario(path, legacy_state, set_new_key_fails=False))

    assert "baApp.v1" not in store, "successful migration left duplicate legacy data"
    assert "breakFree.v1" in store, "successful migration did not write the new key"
    saved_new = json.loads(store["breakFree.v1"])
    assert saved_new["user"]["name"] == "Updated Promoted User", (
        "saveState did not write promoted data to the new storage key"
    )


def assert_shadow_new_key_does_not_delete_richer_legacy(path: Path) -> None:
    current_shadow = {
        "user": {"name": ""},
        "profile": {"name": ""},
        "activations": [],
        "goals": [],
        "logs": [],
        "coach": {"mode": "free", "memory": [], "topicCounts": {}, "facts": []},
    }
    legacy_state = {
        "user": {"name": "Full Legacy User"},
        "profile": {"name": "Full Legacy User"},
        "activations": [{"id": "legacy-step", "title": "kept"}],
        "goals": [{"id": "legacy-goal", "title": "kept"}],
        "logs": [{"id": "legacy-log", "content": "kept"}],
        "coach": {
            "mode": "free",
            "memory": [{"role": "user", "text": "kept"}],
            "topicCounts": {"kept": 1},
            "facts": [{"fact": "kept"}],
        },
    }

    blocked_store = json.loads(
        run_app_storage_scenario(
            path,
            legacy_state,
            set_new_key_fails=True,
            current_state=current_shadow,
            expected_loaded_name="Full Legacy User",
        )
    )
    assert "baApp.v1" in blocked_store, (
        "quota-blocked repair deleted richer legacy data while a shadow new key existed"
    )
    blocked_legacy = json.loads(blocked_store["baApp.v1"])
    assert blocked_legacy["user"]["name"] == "Updated Full Legacy User", (
        "quota-blocked repair did not keep saving to the richer legacy key"
    )

    repaired_store = json.loads(
        run_app_storage_scenario(
            path,
            legacy_state,
            set_new_key_fails=False,
            current_state=current_shadow,
            expected_loaded_name="Full Legacy User",
        )
    )
    assert "baApp.v1" not in repaired_store, (
        "successful repair left duplicate legacy data after replacing the shadow new key"
    )
    repaired_new = json.loads(repaired_store["breakFree.v1"])
    assert repaired_new["user"]["name"] == "Updated Full Legacy User", (
        "successful repair did not replace the shadow new key with richer legacy data"
    )


def assert_different_legacy_backup_is_preserved_when_current_is_richer(path: Path) -> None:
    current_state = {
        "user": {"name": "Current User"},
        "profile": {"name": "Current User"},
        "activations": [{"id": "current-step", "title": "kept"}],
        "goals": [{"id": "current-goal", "title": "kept"}],
        "logs": [],
        "coach": {"mode": "free", "memory": [], "topicCounts": {}, "facts": []},
    }
    legacy_state = {
        "user": {"name": "Legacy Backup"},
        "profile": {"name": "Legacy Backup"},
        "activations": [],
        "goals": [],
        "logs": [],
        "coach": {"mode": "free", "memory": [], "topicCounts": {}, "facts": []},
    }

    store = json.loads(
        run_app_storage_scenario(
            path,
            legacy_state,
            set_new_key_fails=False,
            current_state=current_state,
            expected_loaded_name="Current User",
        )
    )
    assert "baApp.v1" in store, (
        "saveState deleted a different legacy backup without proving it was promoted"
    )


def assert_shadow_new_key_recovers_profile_only_legacy(path: Path) -> None:
    current_shadow = {
        "user": {"name": ""},
        "profile": {"name": ""},
        "activations": [],
        "goals": [],
        "logs": [],
        "coach": {
            "mode": "free",
            "memory": [{"role": "coach", "text": "welcome"}],
            "topicCounts": {},
            "facts": [],
        },
    }
    legacy_state = {
        "user": {"name": ""},
        "profile": {
            "name": "",
            "struggleNotes": ["legacy heaviness note"],
            "valueNotes": ["legacy values note"],
            "energizerNotes": ["legacy energizer note"],
            "bestTimes": ["morning"],
            "interviewNotes": ["legacy interview note"],
            "interviewStarted": True,
            "interviewComplete": True,
            "interviewProgress": {
                "askedTopics": ["whats_here", "values", "best_time"],
                "currentTopic": "open_close",
                "openCloseAsked": True,
            },
        },
        "activations": [],
        "goals": [],
        "logs": [],
        "coach": {"mode": "free", "memory": [], "topicCounts": {}, "facts": []},
    }

    store = json.loads(
        run_app_storage_scenario(
            path,
            legacy_state,
            set_new_key_fails=False,
            current_state=current_shadow,
            expected_loaded_name="",
            expected_struggle_note="legacy heaviness note",
        )
    )
    assert "baApp.v1" not in store, (
        "successful repair did not promote profile-only legacy data over a shadow key"
    )
    repaired_new = json.loads(store["breakFree.v1"])
    assert "legacy heaviness note" in repaired_new["profile"]["struggleNotes"], (
        "profile-only legacy data was not written to the repaired new key"
    )


def main() -> None:
    assert_help_fallback_is_guarded(ROOT / "app.js")
    assert_help_fallback_is_guarded(ROOT / "dist" / "BreakFree.html")
    assert_legacy_state_survives_quota_failure(ROOT / "app.js")
    assert_successful_legacy_promotion_removes_duplicate(ROOT / "app.js")
    assert_shadow_new_key_does_not_delete_richer_legacy(ROOT / "app.js")
    assert_different_legacy_backup_is_preserved_when_current_is_richer(ROOT / "app.js")
    assert_shadow_new_key_recovers_profile_only_legacy(ROOT / "app.js")
    print("OK regression checks passed")


if __name__ == "__main__":
    main()
