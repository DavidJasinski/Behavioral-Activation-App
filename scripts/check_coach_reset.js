/**
 * Regressions: Coach "Forget the recent conversation" must clear
 * conversation-derived indexes and pause an active interview so forgotten
 * user text cannot resurface via recall or continue mutating the profile.
 *
 * Run from repo root:
 *   node scripts/check_coach_reset.js
 */

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const APP_SOURCE = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");

function loadApp() {
  const localStorage = {
    _s: Object.create(null),
    getItem(k) {
      return Object.prototype.hasOwnProperty.call(this._s, k) ? this._s[k] : null;
    },
    setItem(k, v) {
      this._s[k] = String(v);
    },
    removeItem(k) {
      delete this._s[k];
    }
  };

  const noopEl = () => ({
    addEventListener() {},
    focus() {},
    hidden: true,
    value: "",
    innerHTML: "",
    textContent: "",
    appendChild() {},
    classList: { add() {}, toggle() {} },
    style: {},
    dataset: {},
    scrollTop: 0,
    reset() {},
    closest() {
      return null;
    }
  });

  const document = {
    body: { addEventListener() {} },
    addEventListener() {},
    querySelector() {
      return noopEl();
    },
    querySelectorAll() {
      return [];
    },
    createElement() {
      return noopEl();
    }
  };

  const sandbox = {
    window: {
      localStorage,
      __KNOWLEDGE_INLINE: { modalities: {}, docs: [], chunks: [] }
    },
    document,
    localStorage,
    console,
    Math,
    Date,
    Set,
    Array,
    Object,
    String,
    Number,
    JSON,
    Promise,
    structuredClone: (o) => JSON.parse(JSON.stringify(o)),
    fetch: async () => ({
      ok: true,
      json: async () => ({ modalities: {}, docs: [], chunks: [] })
    })
  };
  sandbox.window.document = document;
  sandbox.globalThis = sandbox;

  let modified = APP_SOURCE.replace(
    /document\.addEventListener\("DOMContentLoaded", init\);/,
    ""
  );
  for (const fn of [
    "wire",
    "render",
    "drawCoach",
    "drawSuggestions",
    "openCoach",
    "closeCoach",
    "navigate",
    "toast",
    "renderHome",
    "renderCalendar",
    "renderCreate",
    "renderHelp",
    "drawCalendar"
  ]) {
    modified = modified.replace(
      new RegExp(`function ${fn}\\([\\s\\S]*?\\n\\}`),
      `function ${fn}(){}`
    );
  }

  vm.runInNewContext(
    modified +
      `\nthis.STATE = STATE;\nthis.coachSend = coachSend;\nthis.recallSnippets = recallSnippets;\nthis.pushMemory = pushMemory;\nthis.resetCoachConversation = resetCoachConversation;\nthis.saveState = saveState;\n`,
    sandbox
  );
  return sandbox;
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  const app = loadApp();
  const secret =
    "I hate going to the grocery store alone after dark near Maple Street";

  app.pushMemory({ role: "user", text: secret });
  app.pushMemory({
    role: "coach",
    text: "Thanks for telling me. We can work with that gently."
  });

  assert(app.STATE.coach.facts.length >= 1, "expected user fact to be indexed");
  assert(
    Object.keys(app.STATE.coach.topicCounts).length >= 1,
    "expected topicCounts to be populated"
  );
  assert(
    app.recallSnippets("grocery shopping anxiety").some((s) => s.includes("grocery")),
    "recall should surface the indexed fact before reset"
  );

  app.STATE.coach.mode = "interview";
  app.STATE.profile.interviewStarted = true;
  app.STATE.profile.name = "Alex";
  app.STATE.profile.interviewProgress = {
    askedTopics: ["name"],
    currentTopic: "style",
    openCloseAsked: false
  };
  app.STATE.goals.push({
    id: "g1",
    title: "Walk more",
    createdAt: new Date().toISOString(),
    status: "open"
  });

  assert(
    /function resetCoachConversation\(/.test(APP_SOURCE),
    "resetCoachConversation helper must exist"
  );

  app.resetCoachConversation();
  app.saveState();

  assert(app.STATE.coach.memory.length === 1, "reset should keep only the last bubble");
  assert(app.STATE.coach.facts.length === 0, "reset must clear coach.facts");
  assert(
    Object.keys(app.STATE.coach.topicCounts).length === 0,
    "reset must clear coach.topicCounts"
  );
  assert(
    app.recallSnippets("grocery shopping anxiety").length === 0,
    "recall must not resurface forgotten conversation text after reset"
  );
  assert(app.STATE.coach.mode === "free", "reset must pause an active interview");
  assert(
    app.STATE.profile.interviewProgress.currentTopic === null,
    "reset must clear the active interview topic"
  );
  assert(app.STATE.profile.name === "Alex", "reset must not clear interview profile");
  assert(app.STATE.goals.length === 1, "reset must not clear goals");

  // Persisted state must match the cleared indexes.
  const stored = JSON.parse(app.localStorage.getItem("breakFree.v1"));
  assert(stored.coach.facts.length === 0, "saved state must clear facts");
  assert(
    Object.keys(stored.coach.topicCounts || {}).length === 0,
    "saved state must clear topicCounts"
  );
  assert(stored.coach.mode === "free", "saved state must exit interview mode");

  console.log("OK coach reset checks passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
