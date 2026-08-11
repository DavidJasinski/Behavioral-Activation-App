/**
 * Regressions: hedged / inability / attempt / past-emphatic create talk must
 * not silently invent activations, exposures, or goals. executeIntent always
 * persists for create intents — so "I can't schedule a walk right now" used
 * to add a walk titled "walk right now".
 *
 * Run from repo root:
 *   node scripts/check_tentative_creates.js
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
    field === "goals" ? app.STATE.goals.length : app.STATE.activations.length;
  assert(
    app.classify(text) === intent,
    `"${text}" must classify as ${intent} (got ${app.classify(text)})`
  );
  await app.coachSend(text);
  const after =
    field === "goals" ? app.STATE.goals.length : app.STATE.activations.length;
  assert(after === before + 1, `"${text}" should still create one ${field} item`);
}

async function main() {
  for (const text of [
    // Modal hedges
    "I might schedule a walk later",
    "I could schedule a walk",
    "I may create an exposure someday",
    "maybe schedule a walk",
    "maybe I schedule a nap",
    // Abandoned intention
    "I was going to schedule a walk",
    "I was about to create an exposure",
    "we were going to schedule a call",
    // Attempt / failure
    "I'm trying to schedule a walk",
    "I am trying to create an exposure",
    "I tried to schedule a walk",
    "I failed to schedule a walk",
    // Inability
    "I can't schedule a walk right now",
    "I cannot create an exposure today",
    "I'm unable to schedule a walk",
    "I am unable to add a walk",
    // Temporal self-talk
    "before I schedule a walk I need rest",
    "after I schedule a walk I feel better",
    "until I create an exposure I keep avoiding",
    // Past emphatic
    "I did schedule a walk yesterday",
    "I did create an exposure for that",
    "I did set a goal about sleeping",
    // Habitual
    "I schedule a walk every morning",
    "I create exposures whenever I'm anxious",
    "I plan a walk most days",
    "I add a walk whenever I can",
    // Desire without addressing Coach
    "I want to schedule a walk someday",
    "I'd like to schedule a walk someday",
    "I hope to schedule a walk",
    "I wish I could schedule a walk",
    "I would like to create an exposure someday",
    // Correction / contrast
    "I didn't mean to schedule a walk",
    "I did not mean to create an exposure",
    "rather than schedule a walk I'd nap"
  ]) {
    await assertNoSilentWrite(text);
  }

  // Explicit create requests must still work.
  await assertCreates("schedule a walk for tonight", "add_activation", "activations");
  await assertCreates("please schedule a walk", "add_activation", "activations");
  await assertCreates("add a 10 minute walk", "add_activation", "activations");
  await assertCreates("let's plan a walk", "add_activation", "activations");
  await assertCreates(
    "I want you to schedule a walk",
    "add_activation",
    "activations"
  );
  await assertCreates("help me schedule a walk", "add_activation", "activations");
  await assertCreates("create an exposure hierarchy", "add_exposure", "activations");
  await assertCreates("add a goal about sleeping better", "add_goal", "goals");

  console.log("OK tentative-create checks passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
