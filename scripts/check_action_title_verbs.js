/**
 * Regressions: Coach create titles must come from the requested activity,
 * not from an earlier narrative verb or a substring match.
 *
 * extractActionTitle() used to scan the whole message without word
 * boundaries. executeIntent always persists, and there is no edit UI, so
 * "I already read the workbook. Schedule a walk tomorrow" saved a plan
 * titled "read y read the workbook" (read inside "already") instead of
 * "walk". Same class: "I went for a run… schedule a walk" → "run this
 * morning"; "I cooked dinner. Please schedule a walk" → "cook ed dinner".
 *
 * Run from repo root:
 *   node scripts/check_action_title_verbs.js
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
      `\nthis.STATE = STATE;\nthis.classify = classify;\nthis.extractActionTitle = extractActionTitle;\nthis.executeIntent = executeIntent;\n`,
    sandbox
  );
  return sandbox;
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function assertTitle(text, expected) {
  const app = loadApp();
  const got = app.extractActionTitle(text);
  assert(
    got === expected,
    `extractActionTitle(${JSON.stringify(text)}) => ${JSON.stringify(got)}, expected ${JSON.stringify(expected)}`
  );
}

async function assertPersistedTitle(text, intent, expectedTitle) {
  const app = loadApp();
  assert(
    app.classify(text) === intent,
    `"${text}" should classify as ${intent}, got ${app.classify(text)}`
  );
  const before = app.STATE.activations.length;
  await app.executeIntent(intent, text);
  assert(
    app.STATE.activations.length === before + 1,
    `"${text}" should persist one activation`
  );
  const title = app.STATE.activations[app.STATE.activations.length - 1].title;
  assert(
    title === expectedTitle,
    `"${text}" persisted title ${JSON.stringify(title)}, expected ${JSON.stringify(expectedTitle)}`
  );
}

async function main() {
  // Prior narrative / substring verbs must not steal the requested activity.
  assertTitle(
    "I already read the workbook. Schedule a walk tomorrow",
    "walk"
  );
  assertTitle(
    "I went for a run this morning. Schedule a walk tonight",
    "walk"
  );
  assertTitle("Don't call it exposure, just schedule a walk", "walk");
  assertTitle("I cooked dinner. Please schedule a walk", "walk");
  assertTitle(
    "I used to run every day. Please schedule a walk tomorrow",
    "walk"
  );
  assertTitle("I called my mom earlier. Add a walk tonight", "walk");

  // Explicit create requests still extract the activity.
  assertTitle("schedule a walk tomorrow", "walk");
  assertTitle("add a 10 minute walk", "walk");
  assertTitle("create an activation to walk", "walk");
  assertTitle("plan a walk for tonight", "walk");
  assertTitle("let's plan a walk", "walk");
  assertTitle("schedule a walk around the block", "walk around the block");
  assertTitle("add an exposure to approach the store", "approach the store");
  assertTitle("schedule a reading session", "reading session");

  await assertPersistedTitle(
    "I already read the workbook. Schedule a walk tomorrow",
    "add_activation",
    "walk"
  );
  await assertPersistedTitle(
    "I went for a run this morning. Schedule a walk tonight",
    "add_activation",
    "walk"
  );
  await assertPersistedTitle(
    "I cooked dinner. Please schedule a walk",
    "add_activation",
    "walk"
  );
  await assertPersistedTitle("add a 10 minute walk", "add_activation", "walk");
  await assertPersistedTitle(
    "add an exposure to approach the store",
    "add_exposure",
    "approach the store"
  );

  console.log("OK action-title verb checks passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
