/**
 * Regressions: narrative Coach chat about goals must not silently create goals.
 * Over-broad /\b(add|create|set)\b.*\bgoal\b/ used to classify as add_goal, and
 * executeIntent always persists — so "I set a goal of sleeping better last year"
 * polluted STATE.goals.
 *
 * Run from repo root:
 *   node scripts/check_add_goal_false_positives.js
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

async function assertNoSilentGoal(text) {
  const app = loadApp();
  const beforeGoals = app.STATE.goals.length;
  const beforeActs = app.STATE.activations.length;
  assert(
    app.classify(text) !== "add_goal",
    `"${text}" must not classify as add_goal (got ${app.classify(text)})`
  );
  await app.coachSend(text);
  assert(
    app.STATE.goals.length === beforeGoals,
    `"${text}" silently added ${
      app.STATE.goals.length - beforeGoals
    } goal(s)`
  );
  assert(
    app.STATE.activations.length === beforeActs,
    `"${text}" unexpectedly added ${
      app.STATE.activations.length - beforeActs
    } activation(s)`
  );
}

async function assertStillAddsGoal(text) {
  const app = loadApp();
  const before = app.STATE.goals.length;
  assert(
    app.classify(text) === "add_goal",
    `"${text}" must still classify as add_goal (got ${app.classify(text)})`
  );
  await app.coachSend(text);
  assert(
    app.STATE.goals.length === before + 1,
    `"${text}" should still create one goal`
  );
}

async function main() {
  for (const text of [
    "I set a goal of sleeping better last year",
    "I already set that goal yesterday",
    "my therapist said I should set a goal around going outside",
    "we set a goal in therapy last week",
    "my doctor told me to set a goal about sleep"
  ]) {
    await assertNoSilentGoal(text);
  }

  for (const text of [
    "add a goal to walk more",
    "create a goal about connecting with friends",
    "set a goal of reading every day",
    "set goal: exercise 3x a week",
    "can you add a goal for mornings",
    "please create a goal to call a friend",
    "help me set a goal of leaving the house",
    "I want to set a goal",
    "I'd like to set a goal about rest",
    "Can I set a goal of walking outside",
    "let's set a goal for this week",
    "set me a goal to stretch more"
  ]) {
    await assertStillAddsGoal(text);
  }

  console.log("OK add_goal false-positive checks passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
