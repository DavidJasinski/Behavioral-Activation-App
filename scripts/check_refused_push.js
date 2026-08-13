/**
 * Regressions: interview answers that refuse being pushed must not invert
 * into push/direct personalization. The style and challenge parsers matched
 * the word "push" before negation, so "don't push me" persisted the opposite
 * of what the user asked for.
 *
 * Run from repo root:
 *   node scripts/check_refused_push.js
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
      `\nthis.STATE = STATE;\nthis.INTERVIEW_TOPICS = INTERVIEW_TOPICS;\nthis.handleInterviewAnswer = handleInterviewAnswer;\nthis.refusesPush = typeof refusesPush === "function" ? refusesPush : null;\n`,
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
  for (const text of [
    "don't push me",
    "dont push me",
    "please don't push",
    "do not push me",
    "never push me",
    "I don't want you to push me",
    "don't push, be gentle"
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

  const short = parseStyle("don't push me, keep it short");
  assert(
    short.style === "concise",
    `refusing push while asking for short replies should be concise, got ${short.style}`
  );

  assert(parseStyle("push me").style === "direct", 'style "push me" should stay direct');
  assert(parseStyle("please push me").style === "direct", 'style "please push me" should stay direct');
  assert(parseStyle("be concise").style === "concise", 'style "be concise" should stay concise');
  assert(parseChallenge("push me") === "push", 'challenge "push me" should stay push');
  assert(
    parseChallenge("please push me") === "push",
    'challenge "please push me" should stay push'
  );
  assert(
    parseChallenge("don't let me off easy") === "push",
    'challenge "don\'t let me off easy" should stay push'
  );
  assert(
    parseChallenge("let me set the pace") === "gentle",
    'challenge "let me set the pace" should stay gentle'
  );

  const styleProfile = answerTopic("style", "don't push me");
  assert(
    styleProfile.communicationStyle === "warm",
    `handleInterviewAnswer style "don't push me" should be warm, got ${styleProfile.communicationStyle}`
  );

  const challengeProfile = answerTopic("challenge", "I don't want you to push me");
  assert(
    challengeProfile.challengeLevel === "gentle",
    `handleInterviewAnswer challenge refuse-push should be gentle, got ${challengeProfile.challengeLevel}`
  );

  console.log("OK refused-push interview checks passed");
}

main();
