/**
 * Regressions: first-run Coach chat that starts with "let's start" plus an
 * activity must not be treated as interview consent. The old regex matched
 * /^let's (start|do (it|this))/ as a prefix, so "let's start walking" and
 * "let's start small" started the interview. Repeating the message on the
 * name question permanently stored profile.name = "Let's" with no UI to change it.
 *
 * Distinct from PR #34 (Yesterday/Surely/Okra prefix matching of yes/sure/ok).
 * That fix kept /^let's start\b/, which still matches "let's start walking".
 *
 * Run from repo root:
 *   node scripts/check_lets_start_consent.js
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
      `\nthis.STATE = STATE;\nthis.coachSend = coachSend;\nthis.isInterviewConsent = isInterviewConsent;\nthis.isLetsStartActivityTalk = isLetsStartActivityTalk;\nthis.startInterview = startInterview;\n`,
    sandbox
  );
  return sandbox;
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function lastCoachText(app) {
  const mem = app.STATE.coach.memory.filter((m) => m.role === "coach");
  return mem.length ? mem[mem.length - 1].text : "";
}

async function sendFresh(text) {
  const app = loadApp();
  assert(
    app.STATE.profile.interviewStarted === false,
    "fresh state should not have started the interview"
  );
  await app.coachSend(text);
  return app;
}

async function main() {
  assert(typeof loadApp().isInterviewConsent === "function", "missing isInterviewConsent");
  assert(
    typeof loadApp().isLetsStartActivityTalk === "function",
    "missing isLetsStartActivityTalk"
  );

  for (const text of [
    "yes",
    "let's start",
    "Let's start.",
    "let's start!",
    "let's start the interview",
    "let's do it",
    "let's do this",
    "interview me"
  ]) {
    assert(
      loadApp().isInterviewConsent(text) === true,
      `"${text}" should still count as interview consent`
    );
  }

  for (const text of [
    "let's start walking",
    "let's start small",
    "let's start with a walk",
    "Let's start with a 10-minute walk",
    "let's start a walk tomorrow",
    "let's do this walk"
  ]) {
    assert(
      loadApp().isLetsStartActivityTalk(text) === true,
      `"${text}" should be plan talk, not consent`
    );
    assert(
      loadApp().isInterviewConsent(text) === false,
      `"${text}" must not count as interview consent`
    );
  }

  for (const text of [
    "let's start walking",
    "let's start small",
    "let's start with a walk",
    "let's do this walk"
  ]) {
    const app = await sendFresh(text);
    assert(
      app.STATE.profile.interviewStarted === false,
      `"${text}" should not start the interview`
    );
    assert(
      app.STATE.coach.mode === "free",
      `"${text}" should stay in free chat, got mode=${app.STATE.coach.mode}`
    );
    assert(
      app.STATE.profile.name === "",
      `"${text}" must not persist a name, got ${JSON.stringify(app.STATE.profile.name)}`
    );
    assert(
      !/what should I call you/i.test(lastCoachText(app)),
      `"${text}" must not ask the name question`
    );
  }

  const repeat = await sendFresh("let's start walking");
  await repeat.coachSend("let's start walking");
  assert(
    repeat.STATE.profile.name !== "Let's",
    'repeating "let\'s start walking" must not persist name=Let\'s'
  );
  assert(
    repeat.STATE.profile.interviewStarted === false,
    "repeating plan talk still must not start the interview"
  );

  const consent = await sendFresh("let's start");
  assert(
    consent.STATE.profile.interviewStarted === true,
    'bare "let\'s start" should still start the interview'
  );
  assert(
    consent.STATE.profile.interviewProgress.currentTopic === "name",
    'bare "let\'s start" should land on the name question'
  );

  const named = await sendFresh("yes");
  await named.coachSend("Maya");
  assert(
    named.STATE.profile.name === "Maya",
    `real name answers should still persist, got ${JSON.stringify(named.STATE.profile.name)}`
  );

  console.log("OK let's-start activity consent checks passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
