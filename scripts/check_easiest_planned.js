/**
 * Regression: Coach chip "what's the easiest thing I have planned?" must
 * answer about an existing incomplete activation — never create a new one.
 *
 * Run from repo root:
 *   node scripts/check_easiest_planned.js
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
      `\nthis.STATE = STATE;\nthis.coachSend = coachSend;\nthis.classify = classify;\nthis.localStorage = localStorage;\n`,
    sandbox
  );
  return sandbox;
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  const CHIP = "what's the easiest thing I have planned?";
  assert(
    /easiest_planned/.test(APP_SOURCE),
    "easiest_planned intent must exist in app.js"
  );
  assert(
    !/first small step\|easiest thing/.test(APP_SOURCE),
    "suggest intent must not match bare 'easiest thing' (would mutate plans)"
  );

  const app = loadApp();
  assert(
    app.classify(CHIP) === "easiest_planned",
    `chip must classify as easiest_planned, got ${app.classify(CHIP)}`
  );
  assert(
    app.classify("suggest a 10-minute activation tied to a value") === "suggest",
    "explicit suggest prompts must still classify as suggest"
  );

  app.STATE.activations.push({
    id: "a-hard",
    modality: "ba",
    title: "Deep clean the garage",
    energy: 5,
    duration: 90,
    scheduledFor: null,
    createdAt: new Date().toISOString(),
    completed: false
  });
  app.STATE.activations.push({
    id: "a-easy",
    modality: "ba",
    title: "Drink a glass of water",
    energy: 1,
    duration: 2,
    scheduledFor: null,
    createdAt: new Date().toISOString(),
    completed: false
  });
  app.STATE.activations.push({
    id: "a-done",
    modality: "ivex",
    title: "Stand near the doorway",
    energy: 1,
    duration: 5,
    scheduledFor: null,
    createdAt: new Date().toISOString(),
    completed: true
  });

  const before = app.STATE.activations.length;
  await app.coachSend(CHIP);
  const after = app.STATE.activations.length;

  assert(after === before, `chip must not add activations (${before} -> ${after})`);
  assert(
    app.STATE.activations.filter((a) => a.id === "a-easy").length === 1,
    "existing easy activation must remain"
  );
  assert(
    !app.STATE.activations.some((a) => /5 minute walk|small kind step/i.test(a.title)),
    "must not invent a default suggested activation"
  );

  const last = app.STATE.coach.memory.filter((m) => m.role === "coach").slice(-1)[0];
  assert(last, "coach must reply");
  assert(
    /Drink a glass of water/i.test(last.text),
    `reply should name the easiest open step, got: ${last.text}`
  );
  assert(
    !/I added it to your plans/i.test(last.text),
    "reply must not claim a new plan was added"
  );

  // Empty-plan path: still no mutation.
  app.STATE.activations = [];
  const emptyBefore = 0;
  await app.coachSend(CHIP);
  assert(
    app.STATE.activations.length === emptyBefore,
    "empty-plan easiest query must not create activations"
  );

  console.log("OK easiest-planned checks passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
