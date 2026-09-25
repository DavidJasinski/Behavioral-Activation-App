/**
 * Regressions: situational "tough" must not invert Coach personalization.
 * The style and challenge parsers matched the adjective inside "a tough week"
 * / "this is tough" and persisted direct + push — the opposite of "be gentle"
 * / "let me set the pace". challengeLevel has no free-chat write path, and
 * direct style truncates every later reply to two sentences.
 *
 * Distinct from PR #36 (bare "hard" / missing "direct") and PR #44
 * (refusesHard covers "don't be tough", not "this is tough"). If merging
 * with those, keep requestsTough() instead of a bare /tough/ alternative,
 * and keep refusesHard() in front so "don't be tough" stays gentle.
 *
 * Keep explicit "be tough" / "tough on me" / "push me".
 *
 * Run from repo root:
 *   node scripts/check_situational_tough.js
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
      `\nthis.STATE = STATE;\nthis.INTERVIEW_TOPICS = INTERVIEW_TOPICS;\nthis.handleInterviewAnswer = handleInterviewAnswer;\nthis.requestsTough = typeof requestsTough === "function" ? requestsTough : null;\n`,
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
    tone: app.STATE.preferences.tone
  };
}

function parseChallenge(text) {
  const app = loadApp();
  app.STATE.profile.challengeLevel = null;
  topic(app, "challenge").parse(text);
  return app.STATE.profile.challengeLevel;
}

function answerTopic(id, text) {
  const app = loadApp();
  app.STATE.coach.mode = "interview";
  app.STATE.profile.interviewProgress.currentTopic = id;
  app.STATE.profile.interviewProgress.askedTopics = [];
  app.handleInterviewAnswer(text);
  return app.STATE.profile;
}

function main() {
  const app = loadApp();
  assert(typeof app.requestsTough === "function", "requestsTough helper is missing");

  for (const text of [
    "it's been a tough week, please be gentle",
    "this is tough, let me set the pace",
    "this is tough for me, be gentle",
    "I'm having a tough time, please be gentle",
    "tough week — be gentle",
    "a tough day, let me set the pace"
  ]) {
    const { style, tone } = parseStyle(text);
    assert(style === "warm", `style parse of "${text}" should be warm, got ${style}`);
    assert(tone === "warm", `style parse of "${text}" should keep warm tone, got ${tone}`);
    assert(
      parseChallenge(text) === "gentle",
      `challenge parse of "${text}" should be gentle, got ${parseChallenge(text)}`
    );
  }

  for (const text of [
    "this is tough",
    "it's been a tough week",
    "I'm having a tough time",
    "tough week"
  ]) {
    const { style, tone } = parseStyle(text);
    assert(style === "warm", `style parse of "${text}" should be warm, got ${style}`);
    assert(tone === "warm", `style parse of "${text}" should keep warm tone, got ${tone}`);
    assert(
      parseChallenge(text) === "moderate",
      `challenge parse of "${text}" should be moderate, got ${parseChallenge(text)}`
    );
  }

  for (const text of [
    "be tough",
    "please be tough",
    "be tougher",
    "I want you to be tough",
    "tough on me",
    "tougher on me",
    "please be tough with me",
    "being tough is what I need"
  ]) {
    const { style, tone } = parseStyle(text);
    assert(style === "direct", `style parse of "${text}" should be direct, got ${style}`);
    assert(tone === "concise", `style parse of "${text}" should use concise tone, got ${tone}`);
    assert(
      parseChallenge(text) === "push",
      `challenge parse of "${text}" should be push, got ${parseChallenge(text)}`
    );
  }

  assert(parseChallenge("be gentle") === "gentle", 'challenge "be gentle" should stay gentle');
  assert(parseChallenge("push me") === "push", 'challenge "push me" should stay push');
  assert(
    parseChallenge("don't let me off easy") === "push",
    'challenge "don\'t let me off easy" should stay push'
  );
  assert(
    parseChallenge("hold accountable") === "push",
    'challenge "hold accountable" should stay push'
  );
  assert(parseStyle("be gentle").style === "warm", 'style "be gentle" should stay warm');
  assert(parseStyle("push me").style === "direct", 'style "push me" should stay direct');
  assert(parseStyle("be concise").style === "concise", 'style "be concise" should stay concise');
  assert(
    parseStyle("it's tough, be concise").style === "concise",
    'style "it\'s tough, be concise" should stay concise'
  );

  const { style, tone } = parseStyle("don't be tough");
  assert(style !== "direct", `style "don't be tough" must not be direct, got ${style}`);
  assert(tone !== "concise", `style "don't be tough" must not truncate, got ${tone}`);
  assert(
    parseChallenge("don't be tough") !== "push",
    'challenge "don\'t be tough" must not be push'
  );

  const styleProfile = answerTopic("style", "it's been a tough week, please be gentle");
  assert(
    styleProfile.communicationStyle === "warm",
    `handleInterviewAnswer style should be warm, got ${styleProfile.communicationStyle}`
  );
  const styleApp = loadApp();
  styleApp.STATE.coach.mode = "interview";
  styleApp.STATE.profile.interviewProgress.currentTopic = "style";
  styleApp.STATE.profile.interviewProgress.askedTopics = [];
  styleApp.handleInterviewAnswer("it's been a tough week, please be gentle");
  assert(
    styleApp.STATE.preferences.tone === "warm",
    `saved tone should be warm, got ${styleApp.STATE.preferences.tone}`
  );

  const challengeProfile = answerTopic("challenge", "this is tough, let me set the pace");
  assert(
    challengeProfile.challengeLevel === "gentle",
    `handleInterviewAnswer challenge should be gentle, got ${challengeProfile.challengeLevel}`
  );

  console.log("OK situational tough checks passed");
}

main();
