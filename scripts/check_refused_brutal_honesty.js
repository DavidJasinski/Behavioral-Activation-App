/**
 * Regressions: interview style answers that refuse brutal honesty must not
 * invert into direct + concise personalization.
 *
 * The style parser matches /honest/ and /brutal/ before negation. "brutally"
 * is not the word "brutal" (\bbrutal\b does not match), so "don't be brutally
 * honest" still hits /honest/ and persists communicationStyle=direct with a
 * concise tone. Every later reply is then truncated to two sentences, and
 * there is no settings screen to undo it.
 *
 * Distinct from PR #44 (don't be brutal / hard / tough — \bbrutal\b misses
 * "brutally") and PR #47 (honesty discourse markers like "honestly" / "I'll
 * be honest", which are not a negation of the request).
 *
 * Run from repo root:
 *   node scripts/check_refused_brutal_honesty.js
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
      `\nthis.STATE = STATE;\nthis.INTERVIEW_TOPICS = INTERVIEW_TOPICS;\nthis.handleInterviewAnswer = handleInterviewAnswer;\nthis.refusesBrutalHonesty = refusesBrutalHonesty;\nthis.tonal = tonal;\n`,
    sandbox
  );
  return sandbox;
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function topic(app, id) {
  const t = app.INTERVIEW_TOPICS.find((x) => x.id === id);
  assert(t, `missing interview topic ${id}`);
  return t;
}

function parseStyle(text) {
  const app = loadApp();
  app.STATE.profile.communicationStyle = null;
  topic(app, "style").parse(text);
  return {
    style: app.STATE.profile.communicationStyle,
    tone: app.STATE.preferences.tone,
    app
  };
}

function main() {
  assert(
    typeof loadApp().refusesBrutalHonesty === "function",
    "refusesBrutalHonesty helper is missing"
  );

  const warmAnswers = [
    "don't be brutally honest",
    "dont be brutally honest",
    "please don't be brutally honest",
    "do not be brutally honest",
    "never be brutally honest",
    "don't be so brutally honest",
    "don't be too honest",
    "don't be honest",
    "please don't be honest with me",
    "I don't want you to be brutally honest",
    "I don't want brutal honesty",
    "warm, not brutally honest",
    "gentle, not brutal honesty",
    "I'd rather you not be brutally honest"
  ];

  for (const text of warmAnswers) {
    const { style, tone } = parseStyle(text);
    assert(style === "warm", `style parse of "${text}" should be warm, got ${style}`);
    assert(tone === "warm", `style parse of "${text}" should keep warm tone, got ${tone}`);
  }

  const short = parseStyle("don't be brutally honest, keep it short");
  assert(
    short.style === "concise",
    `refusing brutal honesty while asking for short replies should be concise, got ${short.style}`
  );
  assert(short.tone === "concise", `short refusal should set concise tone, got ${short.tone}`);

  const keepDirect = [
    "be brutally honest",
    "please be brutally honest",
    "I want you to be honest",
    "be honest",
    "brutally honest",
    "push me",
    "I don't know, be honest",
    "don't sugarcoat, be honest"
  ];
  for (const text of keepDirect) {
    const { style, tone } = parseStyle(text);
    assert(style === "direct", `style parse of "${text}" should stay direct, got ${style}`);
    assert(tone === "concise", `direct style of "${text}" should use concise tone, got ${tone}`);
  }

  const answered = parseStyle("don't be brutally honest");
  answered.app.STATE.coach.mode = "interview";
  answered.app.STATE.profile.interviewProgress.currentTopic = "style";
  answered.app.STATE.profile.interviewProgress.askedTopics = [];
  answered.app.STATE.profile.communicationStyle = null;
  answered.app.handleInterviewAnswer("don't be brutally honest");
  assert(
    answered.app.STATE.profile.communicationStyle === "warm",
    "answering the style question with \"don't be brutally honest\" should persist warm"
  );
  assert(
    answered.app.STATE.profile.interviewProgress.askedTopics.includes("style"),
    "the style topic should be consumed so the warm answer sticks"
  );
  const sample = answered.app.tonal(
    "Saved a small step. Showing up is the work. Take your time with the rest of this.",
    answered.app.STATE.preferences.tone
  );
  assert(
    sample.includes("Take your time"),
    "a warm tone must not truncate later replies to two sentences"
  );

  console.log("OK refused brutal honesty");
}

main();
