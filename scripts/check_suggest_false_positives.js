/**
 * Regressions: everyday Coach phrasing must not silently create activations
 * via an over-broad `suggest` intent (composeReply always persists suggestions).
 *
 * Run from repo root:
 *   node scripts/check_suggest_false_positives.js
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

async function assertNoSilentCreate(text) {
  const app = loadApp();
  const before = app.STATE.activations.length;
  assert(
    app.classify(text) !== "suggest",
    `"${text}" must not classify as suggest (got ${app.classify(text)})`
  );
  await app.coachSend(text);
  assert(
    app.STATE.activations.length === before,
    `"${text}" silently added ${
      app.STATE.activations.length - before
    } activation(s)`
  );
}

async function assertStillSuggests(text) {
  const app = loadApp();
  const before = app.STATE.activations.length;
  assert(
    app.classify(text) === "suggest",
    `"${text}" must still classify as suggest (got ${app.classify(text)})`
  );
  await app.coachSend(text);
  assert(
    app.STATE.activations.length === before + 1,
    `"${text}" should still create one suggested activation`
  );
}

async function main() {
  for (const text of [
    "give me a minute",
    "give me some space",
    "just give me a second",
    "can you give me a minute to think",
    "give me advice",
    "that was my first small step",
    "I already did a first small step today",
    "what should i wear today",
    "recommend a restaurant",
    "I need something to do with my hands"
  ]) {
    await assertNoSilentCreate(text);
  }

  for (const text of [
    "suggest a 10-minute activation tied to a value",
    "suggest an activation around connection",
    "help me pick something to do",
    "what should i do",
    "give me a suggestion",
    "give me something to do",
    "I want a first small step"
  ]) {
    await assertStillSuggests(text);
  }

  console.log("OK suggest false-positive checks passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
