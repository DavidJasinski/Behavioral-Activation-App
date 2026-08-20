/**
 * Regressions: free-chat phrases that mention interviewing must not restart
 * the interview unless the user is actually asking to continue it.
 *
 * The old matcher was:
 *   /(continue|resume).*interview|interview me( again)?|ask me more about/i
 * so "don't interview me" and "ask me more about why I freeze" called
 * startInterview(), after which the next recap was parsed as an answer
 * (often profile.name).
 *
 * Run from repo root:
 *   node scripts/check_interview_resume.js
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
      `\nthis.STATE = STATE;\nthis.coachSend = coachSend;\nthis.isInterviewResumeRequest = isInterviewResumeRequest;\nthis.refusesInterviewRequest = refusesInterviewRequest;\nthis.startInterview = startInterview;\n`,
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

async function pausedApp() {
  const app = loadApp();
  await app.coachSend("interview me");
  assert(app.STATE.coach.mode === "interview", "interview me should start the interview");
  await app.coachSend("enough");
  assert(app.STATE.coach.mode === "free", "enough should pause back to free chat");
  return app;
}

async function main() {
  assert(typeof loadApp().isInterviewResumeRequest === "function", "missing isInterviewResumeRequest");
  assert(typeof loadApp().refusesInterviewRequest === "function", "missing refusesInterviewRequest");

  for (const text of [
    "continue interview",
    "resume interview",
    "can we continue the interview?",
    "please resume the interview",
    "interview me",
    "interview me again",
    "please interview me",
    "please interview me again"
  ]) {
    assert(
      loadApp().isInterviewResumeRequest(text),
      `"${text}" should still count as an interview resume/start request`
    );
  }

  for (const text of [
    "don't interview me",
    "please don't interview me",
    "do not interview me",
    "I don't want you to interview me",
    "never interview me",
    "don't continue the interview",
    "please don't resume the interview",
    "I don't want to continue the interview",
    "stop the interview",
    "I'm not going to interview today",
    "ask me more about why I freeze",
    "ask me more about exposure",
    "can you ask me more about my week?"
  ]) {
    assert(
      !loadApp().isInterviewResumeRequest(text),
      `"${text}" must not count as an interview resume/start request`
    );
  }

  const refused = await sendFresh("don't interview me");
  assert(
    refused.STATE.profile.interviewStarted === false,
    'coachSend("don\'t interview me") started the interview'
  );
  assert(
    refused.STATE.coach.mode === "free",
    `coachSend("don\'t interview me") left mode=${refused.STATE.coach.mode}`
  );
  assert(
    !/what should I call you/i.test(lastCoachText(refused)),
    'coachSend("don\'t interview me") asked for a name instead of staying in free chat'
  );

  const pleaseDont = await sendFresh("please don't interview me");
  assert(
    pleaseDont.STATE.profile.interviewStarted === false,
    'coachSend("please don\'t interview me") started the interview'
  );

  const topical = await sendFresh("ask me more about why I freeze");
  assert(
    topical.STATE.profile.interviewStarted === false,
    'coachSend("ask me more about why I freeze") started the interview'
  );
  assert(
    topical.STATE.coach.mode === "free",
    `coachSend("ask me more about why I freeze") left mode=${topical.STATE.coach.mode}`
  );

  const paused = await pausedApp();
  await paused.coachSend("don't continue the interview");
  assert(
    paused.STATE.coach.mode === "free",
    'paused coachSend("don\'t continue the interview") resumed the interview'
  );
  await paused.coachSend("Yesterday I could not leave the house");
  assert(
    paused.STATE.profile.name !== "Yesterday",
    "refused resume must not parse the next recap as a name"
  );
  assert(
    paused.STATE.coach.mode === "free",
    "follow-up recap after a refused resume must stay in free chat"
  );

  const resume = await pausedApp();
  await resume.coachSend("continue interview");
  assert(
    resume.STATE.coach.mode === "interview",
    'coachSend("continue interview") should still resume a paused interview'
  );
  assert(
    /what should I call you/i.test(lastCoachText(resume)),
    'coachSend("continue interview") should still ask the next interview question'
  );

  const named = await sendFresh("interview me");
  assert(
    named.STATE.profile.interviewStarted === true,
    'coachSend("interview me") should still start the interview'
  );

  const please = await sendFresh("please interview me");
  assert(
    please.STATE.profile.interviewStarted === true,
    'coachSend("please interview me") should still start the interview'
  );

  console.log("OK interview-resume refusal checks passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
