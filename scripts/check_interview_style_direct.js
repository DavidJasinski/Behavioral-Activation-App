/**
 * Regressions: the interview style question offers "direct" as an option,
 * but the parser never looked for that word and treated bare "hard" as a
 * request to be blunt. Echoing the question (or saying the work is hard
 * and asking for gentle) persisted the opposite voice into localStorage.
 *
 * Run from repo root:
 *   node scripts/check_interview_style_direct.js
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
      `\nthis.STATE = STATE;\nthis.INTERVIEW_TOPICS = INTERVIEW_TOPICS;\nthis.handleInterviewAnswer = handleInterviewAnswer;\nthis.interviewCommunicationStyle = typeof interviewCommunicationStyle === "function" ? interviewCommunicationStyle : null;\nthis.saveState = saveState;\n`,
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
    persisted: JSON.parse(app.localStorage.getItem("breakFree.v1") || "null")
  };
}

function answerStyle(text) {
  const app = loadApp();
  app.STATE.coach.mode = "interview";
  app.STATE.profile.communicationStyle = null;
  app.STATE.profile.interviewProgress.currentTopic = "style";
  app.STATE.profile.interviewProgress.askedTopics = ["name"];
  app.handleInterviewAnswer(text);
  app.saveState();
  const stored = JSON.parse(app.localStorage.getItem("breakFree.v1"));
  return {
    style: app.STATE.profile.communicationStyle,
    tone: app.STATE.preferences.tone,
    storedStyle: stored.profile.communicationStyle,
    storedTone: stored.preferences.tone,
    confirm: app.STATE.coach.memory.filter((m) => m.role === "coach").slice(-1)[0]?.text || ""
  };
}

function main() {
  assert(
    typeof loadApp().interviewCommunicationStyle === "function",
    "interviewCommunicationStyle helper is missing"
  );

  for (const text of ["direct", "be direct", "I want you to be direct", "more direct"]) {
    const { style, tone } = parseStyle(text);
    assert(
      style === "direct",
      `style parse of "${text}" should be direct, got ${style}`
    );
    assert(
      tone === "concise",
      `style parse of "${text}" should use concise tone, got ${tone}`
    );
  }

  for (const text of [
    "this is hard for me, be gentle",
    "talking about this is hard, please be gentle",
    "gentle please, this is hard",
    "warm and gentle"
  ]) {
    const { style, tone } = parseStyle(text);
    assert(
      style === "warm",
      `style parse of "${text}" should be warm, got ${style}`
    );
    assert(
      tone === "warm",
      `style parse of "${text}" should keep warm tone, got ${tone}`
    );
  }

  assert(parseStyle("push me").style === "direct", 'style "push me" should stay direct');
  assert(parseStyle("be concise").style === "concise", 'style "be concise" should stay concise');
  assert(parseStyle("short and to the point").style === "concise", 'style "short and to the point" should stay concise');
  assert(parseStyle("be hard on me").style === "direct", 'style "be hard on me" should stay direct');
  assert(
    parseStyle("don't be direct, be warm").style === "warm",
    'style "don\'t be direct, be warm" should be warm'
  );

  const echoed = answerStyle("direct");
  assert(
    echoed.style === "direct",
    `handleInterviewAnswer "direct" should persist direct, got ${echoed.style}`
  );
  assert(
    echoed.storedStyle === "direct",
    `saved profile.communicationStyle should be direct, got ${echoed.storedStyle}`
  );
  assert(
    echoed.storedTone === "concise",
    `saved preferences.tone should be concise for direct, got ${echoed.storedTone}`
  );
  assert(
    /Direct it is/i.test(echoed.confirm),
    `confirm after "direct" should acknowledge direct, got ${JSON.stringify(echoed.confirm)}`
  );

  const hardGentle = answerStyle("this is hard for me, be gentle");
  assert(
    hardGentle.style === "warm",
    `handleInterviewAnswer "this is hard for me, be gentle" should be warm, got ${hardGentle.style}`
  );
  assert(
    hardGentle.storedStyle === "warm",
    `saved style for hard+gentle should be warm, got ${hardGentle.storedStyle}`
  );
  assert(
    /Warm it is/i.test(hardGentle.confirm),
    `confirm after hard+gentle should acknowledge warm, got ${JSON.stringify(hardGentle.confirm)}`
  );

  console.log("OK interview style-direct checks passed");
}

main();
