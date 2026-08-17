/**
 * Regressions: first-run Coach chat that merely starts with the letters of a
 * consent word must not start the interview. The old regex used
 * /^(yes|sure|ok(ay)?|...)/ without a word boundary, so "Yesterday I couldn't
 * leave the house" was treated as "yes" and the user's message was swallowed.
 *
 * Run from repo root:
 *   node scripts/check_interview_consent.js
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
      `\nthis.STATE = STATE;\nthis.coachSend = coachSend;\nthis.isInterviewConsent = isInterviewConsent;\nthis.startInterview = startInterview;\n`,
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

  for (const text of [
    "yes",
    "Yes",
    "yes please",
    "Yes.",
    "sure",
    "Sure, let's go",
    "ok",
    "okay",
    "Okay!",
    "let's start",
    "let's do it",
    "let's do this",
    "start interview",
    "interview me",
    "tell me about you",
    "onboard me"
  ]) {
    assert(
      loadApp().isInterviewConsent(text),
      `"${text}" should still count as interview consent`
    );
  }

  for (const text of [
    "Yesterday I could not leave the house",
    "Yesterday I walked for twenty minutes",
    "Surely I felt worse after staying in",
    "Okra recipes help me cook",
    "Oklahoma is far from my family",
    "tell me about your day",
    "tell me about your walk yesterday",
    "yestermorning was heavy",
    "let's do a walk",
    "I said yes to a friend already"
  ]) {
    assert(
      !loadApp().isInterviewConsent(text),
      `"${text}" must not count as interview consent`
    );
  }

  const swallowed = await sendFresh("Yesterday I could not leave the house");
  assert(
    swallowed.STATE.profile.interviewStarted === false,
    'coachSend("Yesterday…") started the interview'
  );
  assert(
    swallowed.STATE.coach.mode === "free",
    `coachSend("Yesterday…") left mode=${swallowed.STATE.coach.mode}`
  );
  assert(
    !/what should I call you/i.test(lastCoachText(swallowed)),
    'coachSend("Yesterday…") asked for a name instead of hearing the recap'
  );
  assert(
    swallowed.STATE.profile.name !== "Yesterday",
    "Yesterday-prefix chat must not become the profile name"
  );

  const aboutYour = await sendFresh("tell me about your day");
  assert(
    aboutYour.STATE.profile.interviewStarted === false,
    'coachSend("tell me about your day") started the interview'
  );

  const surely = await sendFresh("Surely staying in made it worse");
  assert(
    surely.STATE.profile.interviewStarted === false,
    'coachSend("Surely…") started the interview'
  );

  const yes = await sendFresh("yes");
  assert(
    yes.STATE.profile.interviewStarted === true,
    'coachSend("yes") should still start the interview'
  );
  assert(
    yes.STATE.coach.mode === "interview",
    `coachSend("yes") left mode=${yes.STATE.coach.mode}`
  );
  assert(
    /what should I call you/i.test(lastCoachText(yes)),
    'coachSend("yes") should still ask for a name'
  );

  const named = await sendFresh("interview me");
  assert(
    named.STATE.profile.interviewStarted === true,
    'coachSend("interview me") should still start the interview'
  );

  console.log("OK interview-consent prefix checks passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
