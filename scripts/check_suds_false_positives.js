/**
 * Regressions: mentioning SUDS must not silently create exposures.
 * Bare /\bsuds\b/ used to classify as add_exposure, and executeIntent always
 * persists — so "what does suds mean?" polluted the user's plan.
 *
 * Run from repo root:
 *   node scripts/check_suds_false_positives.js
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

async function assertNoSilentExposure(text) {
  const app = loadApp();
  const before = app.STATE.activations.length;
  assert(
    app.classify(text) !== "add_exposure",
    `"${text}" must not classify as add_exposure (got ${app.classify(text)})`
  );
  await app.coachSend(text);
  assert(
    app.STATE.activations.length === before,
    `"${text}" silently added ${
      app.STATE.activations.length - before
    } activation(s)`
  );
}

async function assertStillAddsExposure(text) {
  const app = loadApp();
  const before = app.STATE.activations.length;
  assert(
    app.classify(text) === "add_exposure",
    `"${text}" must still classify as add_exposure (got ${app.classify(text)})`
  );
  await app.coachSend(text);
  assert(
    app.STATE.activations.length === before + 1,
    `"${text}" should still create one exposure`
  );
  const added = app.STATE.activations[app.STATE.activations.length - 1];
  assert(added.modality === "ivex", `"${text}" should create an ivex modality item`);
}

async function main() {
  for (const text of [
    "what does suds mean?",
    "what is a suds rating?",
    "my therapist mentioned suds",
    "explain suds",
    "I hate high suds feelings",
    "how do I use suds during an exposure?",
    "suds went up to 70 yesterday"
  ]) {
    await assertNoSilentExposure(text);
  }

  for (const text of [
    "add an exposure with suds 40",
    "build me a small in-vivo exposure step",
    "schedule an exposure for tomorrow",
    "create a graded exposure hierarchy step",
    "add a step with suds 30"
  ]) {
    await assertStillAddsExposure(text);
  }

  console.log("OK suds false-positive checks passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
