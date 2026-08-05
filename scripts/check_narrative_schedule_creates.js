/**
 * Regressions: first-person narrative / self-talk about scheduling must not
 * silently invent activations or exposures. executeIntent/composeReply always
 * persist for add_activation / add_exposure — so "I already schedule a walk
 * every morning" used to pollute local plan state.
 *
 * Run from repo root:
 *   node scripts/check_narrative_schedule_creates.js
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
    reset() {}
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
      `\nthis.STATE = STATE;\nthis.coachSend = coachSend;\nthis.classify = classify;\n`,
    sandbox
  );
  return sandbox;
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function assertNoSilentWrite(text) {
  const app = loadApp();
  const beforeGoals = app.STATE.goals.length;
  const beforeActs = app.STATE.activations.length;
  const intent = app.classify(text);
  assert(
    intent !== "add_goal" &&
      intent !== "add_activation" &&
      intent !== "add_exposure",
    `"${text}" must not classify as a create intent (got ${intent})`
  );
  await app.coachSend(text);
  assert(
    app.STATE.goals.length === beforeGoals,
    `"${text}" silently added ${app.STATE.goals.length - beforeGoals} goal(s)`
  );
  assert(
    app.STATE.activations.length === beforeActs,
    `"${text}" silently added ${
      app.STATE.activations.length - beforeActs
    } activation(s)/exposure(s)`
  );
}

async function assertCreates(text, intent, field) {
  const app = loadApp();
  const before =
    field === "goals"
      ? app.STATE.goals.length
      : app.STATE.activations.length;
  assert(
    app.classify(text) === intent,
    `"${text}" must classify as ${intent} (got ${app.classify(text)})`
  );
  await app.coachSend(text);
  const after =
    field === "goals"
      ? app.STATE.goals.length
      : app.STATE.activations.length;
  assert(after === before + 1, `"${text}" should still create one ${field} item`);
}

async function main() {
  for (const text of [
    "I already schedule a walk every morning",
    "I used to schedule a walk after work",
    "I always schedule a nap after lunch",
    "I should schedule a walk more often",
    "I need to schedule a walk tomorrow",
    "I have to schedule a call this week",
    "did you schedule a walk for me?",
    "have you already scheduled a walk?",
    "remind me to add a walk later",
    "I already schedule exposure practice",
    "I used to schedule an exposure for crowds"
  ]) {
    await assertNoSilentWrite(text);
  }

  // Explicit create requests must still work.
  await assertCreates("schedule a walk for tonight", "add_activation", "activations");
  await assertCreates("please schedule a walk", "add_activation", "activations");
  await assertCreates("help me schedule a walk", "add_activation", "activations");
  await assertCreates(
    "I want you to schedule a walk",
    "add_activation",
    "activations"
  );
  await assertCreates("add a 10 minute walk", "add_activation", "activations");
  await assertCreates(
    "schedule an exposure for grocery shopping",
    "add_exposure",
    "activations"
  );

  console.log("OK narrative-schedule-create checks passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
