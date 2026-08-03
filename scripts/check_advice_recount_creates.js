/**
 * Regressions: recounting therapist/doctor advice (or casual Maslow-style
 * "hierarchy of needs" chat) must not silently create activations/exposures.
 * executeIntent/composeReply always persist for add_activation / add_exposure.
 *
 * Run from repo root:
 *   node scripts/check_advice_recount_creates.js
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
  const beforeActs = app.STATE.activations.length;
  const intent = app.classify(text);
  assert(
    intent !== "add_activation" && intent !== "add_exposure",
    `"${text}" must not classify as a create intent (got ${intent})`
  );
  await app.coachSend(text);
  assert(
    app.STATE.activations.length === beforeActs,
    `"${text}" silently added ${
      app.STATE.activations.length - beforeActs
    } activation(s)/exposure(s)`
  );
}

async function assertCreates(text, intent) {
  const app = loadApp();
  const before = app.STATE.activations.length;
  assert(
    app.classify(text) === intent,
    `"${text}" must classify as ${intent} (got ${app.classify(text)})`
  );
  await app.coachSend(text);
  assert(
    app.STATE.activations.length === before + 1,
    `"${text}" should still create one plan item`
  );
}

async function main() {
  for (const text of [
    "my therapist said to schedule an activity",
    "my therapist told me to schedule a walk",
    "my doctor said I should plan a walk today",
    "she advised me to schedule a walk",
    "they told me to create an exposure hierarchy",
    "they want me to create an activity",
    "I was told to add an exposure",
    "build hierarchy of needs",
    "I want to build a hierarchy of needs",
    "build Maslow's hierarchy"
  ]) {
    await assertNoSilentWrite(text);
  }

  // Explicit create requests (including exposure hierarchies) must still work.
  await assertCreates("add a 10 minute walk", "add_activation");
  await assertCreates("plan a walk for tonight", "add_activation");
  await assertCreates(
    "create an exposure for grocery shopping",
    "add_exposure"
  );
  await assertCreates(
    "schedule an exposure for tomorrow",
    "add_exposure"
  );
  await assertCreates(
    "can you build a hierarchy of my avoidances",
    "add_exposure"
  );
  await assertCreates(
    "let's build a hierarchy for my fears",
    "add_exposure"
  );

  console.log("OK advice-recount / hierarchy create checks passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
