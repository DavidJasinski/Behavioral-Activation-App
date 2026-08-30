/**
 * Regressions: interview answers that refuse being treated harshly must not
 * invert into direct/push personalization. The style parser matches `hard` /
 * `tough` / `brutal` before negation, so "don't be hard on me" persisted the
 * opposite of what the user asked for. The challenge parser does the same
 * with `tough`, and challengeLevel has no later free-chat write path.
 *
 * Distinct from PR #33 (don't push), PR #36 (bare "hard" / missing "direct"),
 * and PR #40 (don't go easy). Those still leave "don't be hard on me" and
 * "don't be tough" inverted.
 *
 * Run from repo root:
 *   node scripts/check_refused_hard.js
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
      `\nthis.STATE = STATE;\nthis.INTERVIEW_TOPICS = INTERVIEW_TOPICS;\nthis.handleInterviewAnswer = handleInterviewAnswer;\nthis.refusesHard = typeof refusesHard === "function" ? refusesHard : null;\n`,
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
  assert(typeof loadApp().refusesHard === "function", "refusesHard helper is missing");

  for (const text of [
    "don't be hard on me",
    "dont be hard on me",
    "please don't be hard on me",
    "do not be hard on me",
    "never be hard on me",
    "I don't want you to be hard on me",
    "don't be too hard on me",
    "don't be tough",
    "please don't be tough on me",
    "I don't want you to be tough",
    "don't be brutal",
    "don't be so brutal with me"
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
    assert(
      parseChallenge(text) === "gentle",
      `challenge parse of "${text}" should be gentle, got ${parseChallenge(text)}`
    );
  }

  const short = parseStyle("don't be hard on me, keep it short");
  assert(
    short.style === "concise",
    `refusing hard while asking for short replies should be concise, got ${short.style}`
  );

  assert(
    parseStyle("be hard on me").style === "direct",
    'style "be hard on me" should stay direct'
  );
  assert(
    parseStyle("push me").style === "direct",
    'style "push me" should stay direct'
  );
  assert(
    parseStyle("be concise").style === "concise",
    'style "be concise" should stay concise'
  );
  assert(
    parseChallenge("push me") === "push",
    'challenge "push me" should stay push'
  );
  assert(
    parseChallenge("don't let me off easy") === "push",
    'challenge "don\'t let me off easy" should stay push'
  );
  assert(
    parseChallenge("let me set the pace") === "gentle",
    'challenge "let me set the pace" should stay gentle'
  );

  const styleProfile = answerTopic("style", "don't be hard on me");
  assert(
    styleProfile.communicationStyle === "warm",
    `handleInterviewAnswer style "don't be hard on me" should be warm, got ${styleProfile.communicationStyle}`
  );

  const challengeProfile = answerTopic("challenge", "don't be tough");
  assert(
    challengeProfile.challengeLevel === "gentle",
    `handleInterviewAnswer challenge "don't be tough" should be gentle, got ${challengeProfile.challengeLevel}`
  );

  console.log("OK refused-hard interview checks passed");
}

main();
