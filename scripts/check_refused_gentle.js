/**
 * Regressions: interview answers that refuse a gentle pace must not invert
 * into gentle/warm personalization. The challenge parser matched the word
 * "gentle" as the easy-pace option, and the style parser fell through to
 * warm (the question's gentle option). challengeLevel has no free-chat write
 * path, so the inversion stuck for the rest of the session.
 *
 * Distinct from PR #40 (`refusesEasy` is easy-idiom only: "don't go easy on
 * me"). If merging with #33/#40/#44/#50, keep refusesGentle() in front of
 * the /gentle/ challenge branch and the style default-to-warm path.
 *
 * Run from repo root:
 *   node scripts/check_refused_gentle.js
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
      `\nthis.STATE = STATE;\nthis.INTERVIEW_TOPICS = INTERVIEW_TOPICS;\nthis.handleInterviewAnswer = handleInterviewAnswer;\nthis.refusesGentle = typeof refusesGentle === "function" ? refusesGentle : null;\n`,
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
  assert(typeof app.refusesGentle === "function", "refusesGentle helper is missing");

  for (const text of [
    "don't be gentle",
    "dont be gentle",
    "please don't be gentle",
    "do not be gentle",
    "never be gentle",
    "I don't want you to be gentle",
    "I don't want you gentle",
    "don't be so gentle",
    "don't be too gentle",
    "warm, not gentle",
    "please don't be gentle with me"
  ]) {
    assert(
      parseChallenge(text) === "push",
      `challenge parse of "${text}" should be push, got ${parseChallenge(text)}`
    );
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

  assert(parseChallenge("be gentle") === "gentle", 'challenge "be gentle" should stay gentle');
  assert(parseChallenge("gentle") === "gentle", 'challenge "gentle" should stay gentle');
  assert(
    parseChallenge("let me set the pace") === "gentle",
    'challenge "let me set the pace" should stay gentle'
  );
  assert(parseChallenge("push me") === "push", 'challenge "push me" should stay push');
  assert(
    parseChallenge("don't let me off easy") === "push",
    'challenge "don\'t let me off easy" should stay push'
  );
  assert(
    parseChallenge("go easy on me") === "gentle",
    'challenge "go easy on me" should stay gentle'
  );

  assert(parseStyle("be gentle").style === "warm", 'style "be gentle" should stay warm');
  assert(parseStyle("push me").style === "direct", 'style "push me" should stay direct');
  assert(parseStyle("be concise").style === "concise", 'style "be concise" should stay concise');

  const challengeProfile = answerTopic("challenge", "don't be gentle");
  assert(
    challengeProfile.challengeLevel === "push",
    `handleInterviewAnswer challenge "don't be gentle" should be push, got ${challengeProfile.challengeLevel}`
  );

  const styleProfile = answerTopic("style", "I don't want you to be gentle");
  assert(
    styleProfile.communicationStyle === "direct",
    `handleInterviewAnswer style refuse-gentle should be direct, got ${styleProfile.communicationStyle}`
  );

  console.log("OK refused-gentle interview checks passed");
}

main();
