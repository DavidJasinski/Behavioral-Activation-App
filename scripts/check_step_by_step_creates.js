/**
 * Regressions: "step-by-step" / "step by step" must not be treated as the
 * activity noun "step". Coach messages like "create a step-by-step plan"
 * matched add_activation and executeIntent always persisted a junk plan
 * item ("small kind step").
 *
 * Distinct from Help "plan … step" noun matching (PR #20). This is the
 * compound adjective matching \bstep\b.
 *
 * Run from repo root:
 *   node scripts/check_step_by_step_creates.js
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
      `\nthis.STATE = STATE;\nthis.classify = classify;\nthis.coachSend = coachSend;\n`,
    sandbox
  );
  return sandbox;
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function assertNoSilentWrite(text) {
  const app = loadApp();
  const beforeActs = app.STATE.activations.length;
  const beforeGoals = app.STATE.goals.length;
  const intent = app.classify(text);
  assert(
    intent !== "add_activation" && intent !== "add_exposure" && intent !== "add_goal",
    `"${text}" classified as ${intent}`
  );
  await app.coachSend(text);
  assert(
    app.STATE.activations.length === beforeActs,
    `"${text}" silently added an activation (${app.STATE.activations.length - beforeActs})`
  );
  assert(
    app.STATE.goals.length === beforeGoals,
    `"${text}" silently added a goal (${app.STATE.goals.length - beforeGoals})`
  );
}

async function assertCreates(text, intent, collection) {
  const app = loadApp();
  assert(
    app.classify(text) === intent,
    `"${text}" should classify as ${intent}, got ${app.classify(text)}`
  );
  const before = app.STATE[collection].length;
  await app.coachSend(text);
  assert(
    app.STATE[collection].length === before + 1,
    `"${text}" should persist one ${collection} item`
  );
}

async function main() {
  for (const text of [
    "I want to create a step-by-step plan",
    "create a step-by-step plan",
    "help me create a step by step plan",
    "can we create a step-by-step plan for getting out of the house",
    "let's create a step-by-step plan this week"
  ]) {
    await assertNoSilentWrite(text);
  }

  await assertCreates("add a 10 minute walk", "add_activation", "activations");
  await assertCreates("plan a walk for tonight", "add_activation", "activations");
  await assertCreates("add a step", "add_activation", "activations");
  await assertCreates("create a step for leaving the house", "add_activation", "activations");

  console.log("OK step-by-step create checks passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
