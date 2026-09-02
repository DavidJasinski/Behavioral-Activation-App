/**
 * Regressions: interview style parser must not treat honesty discourse
 * markers as a request to be blunt.
 *
 * The style question is open-ended. Hedged warm answers like
 * "I'll be honest, I want you warm and gentle" and "Honestly, be gentle"
 * historically matched /honest/ (including inside "honestly") and persisted
 * communicationStyle=direct + concise tone. There is no interview UI to
 * undo that, and every later reply is truncated to two sentences.
 *
 * Distinct from PR #33 (refuse-push), PR #36 (bare "hard" / missing
 * "direct"), PR #40 (refuse-easy), PR #44 (refuse-hard), and PR #45
 * (unanchored "less"). If those merge with interviewCommunicationStyle(),
 * keep honestyDiscourse() in front of the honest branch rather than a
 * bare /honest/ alternative.
 *
 * Run from repo root:
 *   node scripts/check_interview_style_honestly.js
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
      `\nthis.STATE = STATE;\nthis.coachSend = coachSend;\nthis.startInterview = startInterview;\nthis.handleInterviewAnswer = handleInterviewAnswer;\nthis.INTERVIEW_TOPICS = INTERVIEW_TOPICS;\nthis.honestyDiscourse = typeof honestyDiscourse === "function" ? honestyDiscourse : null;\nthis.saveState = saveState;\n`,
    sandbox
  );
  return sandbox;
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function topic(app, id) {
  return app.INTERVIEW_TOPICS.find((t) => t.id === id);
}

function parseStyle(text) {
  const app = loadApp();
  app.STATE.profile.communicationStyle = null;
  app.STATE.preferences.tone = "warm";
  topic(app, "style").parse(text);
  return {
    style: app.STATE.profile.communicationStyle,
    tone: app.STATE.preferences.tone
  };
}

async function startOnStyleQuestion() {
  const app = loadApp();
  app.startInterview();
  assert(
    app.STATE.profile.interviewProgress.currentTopic === "name",
    `expected name topic, got ${app.STATE.profile.interviewProgress.currentTopic}`
  );
  await app.coachSend("Sam");
  assert(
    app.STATE.profile.interviewProgress.currentTopic === "style",
    `expected style topic after name, got ${app.STATE.profile.interviewProgress.currentTopic}`
  );
  return app;
}

async function main() {
  assert(
    typeof loadApp().honestyDiscourse === "function",
    "honestyDiscourse helper is missing"
  );

  // Discourse markers plus a warm/gentle request must stay warm, not flip
  // to direct because /honest/ also matches "honestly" / "be honest".
  for (const text of [
    "Honestly, I want you warm and gentle",
    "honestly I'd like you to be warm",
    "I'll be honest, I want you warm and gentle",
    "I will be honest, please be gentle",
    "To be honest, be gentle",
    "to be honest I prefer warm",
    "Let me be honest, warm please",
    "If I'm honest, I want you gentle"
  ]) {
    const parsed = parseStyle(text);
    assert(
      parsed.style === "warm",
      `style parse of "${text}" should be warm, got ${parsed.style}`
    );
    assert(
      parsed.tone === "warm",
      `style parse of "${text}" should keep tone=warm, got ${parsed.tone}`
    );

    const app = await startOnStyleQuestion();
    await app.coachSend(text);
    assert(
      app.STATE.profile.communicationStyle === "warm",
      `handleInterviewAnswer "${text}" should persist communicationStyle=warm, got ${JSON.stringify(
        app.STATE.profile.communicationStyle
      )}`
    );
    assert(
      app.STATE.preferences.tone === "warm",
      `handleInterviewAnswer "${text}" should persist tone=warm, got ${JSON.stringify(
        app.STATE.preferences.tone
      )}`
    );
    const last = app.STATE.coach.memory.filter((m) => m.role === "coach").slice(-1)[0];
    assert(
      /Warm it is/i.test(last.text),
      `confirm after "${text}" should acknowledge warm, got ${JSON.stringify(last.text)}`
    );
  }

  // Hedged concise still lands on concise (discourse must not force direct).
  const conciseApp = await startOnStyleQuestion();
  await conciseApp.coachSend("I'll be honest, be concise");
  assert(
    conciseApp.STATE.profile.communicationStyle === "concise",
    `hedged concise should stay concise, got ${conciseApp.STATE.profile.communicationStyle}`
  );

  // Explicit honesty-as-request / blunt requests must still land on direct.
  for (const text of [
    "be honest with me",
    "be honest",
    "I want you to be honest",
    "please be honest with me",
    "push me"
  ]) {
    const parsed = parseStyle(text);
    assert(
      parsed.style === "direct",
      `style parse of "${text}" should stay direct, got ${parsed.style}`
    );
  }

  assert(parseStyle("warm").style === "warm", 'style "warm" should stay warm');
  assert(parseStyle("concise").style === "concise", 'style "concise" should stay concise');

  console.log("OK interview-style honestly checks passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
