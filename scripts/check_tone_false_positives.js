/**
 * Regressions: everyday Coach phrasing must not silently mutate tone /
 * communicationStyle via an over-broad `tone` intent (executeIntent always
 * writes preferences + profile).
 *
 * Run from repo root:
 *   node scripts/check_tone_false_positives.js
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

async function assertNoToneMutation(text) {
  const app = loadApp();
  app.STATE.preferences.tone = "warm";
  app.STATE.profile.communicationStyle = "warm";
  assert(
    app.classify(text) !== "tone",
    `"${text}" must not classify as tone (got ${app.classify(text)})`
  );
  await app.coachSend(text);
  assert(
    app.STATE.preferences.tone === "warm",
    `"${text}" mutated preferences.tone to ${app.STATE.preferences.tone}`
  );
  assert(
    app.STATE.profile.communicationStyle === "warm",
    `"${text}" mutated communicationStyle to ${app.STATE.profile.communicationStyle}`
  );
}

async function assertToneRequest(text, expectedTone, expectedStyle) {
  const app = loadApp();
  app.STATE.preferences.tone = "warm";
  app.STATE.profile.communicationStyle = "warm";
  assert(
    app.classify(text) === "tone",
    `"${text}" must still classify as tone (got ${app.classify(text)})`
  );
  await app.coachSend(text);
  assert(
    app.STATE.preferences.tone === expectedTone,
    `"${text}" should set tone=${expectedTone} (got ${app.STATE.preferences.tone})`
  );
  assert(
    app.STATE.profile.communicationStyle === expectedStyle,
    `"${text}" should set style=${expectedStyle} (got ${app.STATE.profile.communicationStyle})`
  );
}

async function main() {
  for (const text of [
    "I walked longer than usual today",
    "that was shorter than I expected",
    "I feel warmer after the walk",
    "stay with it longer",
    "my therapist said to push me more",
    "What I tried didn't help. Help me look at the data without judging it, and decide whether to change category, shrink the step, or stay with it longer."
  ]) {
    await assertNoToneMutation(text);
  }

  for (const [text, tone, style] of [
    ["can you use a warmer tone?", "warm", "warm"],
    ["please be more direct with me", "concise", "concise"],
    ["push me harder please", "concise", "direct"],
    ["make your replies shorter", "concise", "concise"],
    ["be gentler", "warm", "warm"],
    ["less wordy", "concise", "concise"]
  ]) {
    await assertToneRequest(text, tone, style);
  }

  console.log("OK tone false-positive checks passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
