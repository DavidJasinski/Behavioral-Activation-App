/**
 * Regressions: interview answers must not run free-chat profile inference.
 * inferProfileFromMessage() can fill values/avoiding/energizers from a
 * struggle answer, which makes later interview topics' needs() return false
 * so those questions are skipped and the Coach personalizes from the wrong
 * fields. There is no UI to edit them.
 *
 * Run from repo root:
 *   node scripts/check_interview_inference.js
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
      `\nthis.STATE = STATE;\nthis.coachSend = coachSend;\nthis.startInterview = startInterview;\nthis.inferProfileFromMessage = inferProfileFromMessage;\n`,
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

async function interviewThroughStyle() {
  const app = loadApp();
  app.startInterview();
  assert(app.STATE.coach.mode === "interview", "startInterview should enter interview mode");
  assert(
    app.STATE.profile.interviewProgress.currentTopic === "name",
    "first topic should be name"
  );
  await app.coachSend("Alex");
  assert(app.STATE.profile.name === "Alex", "name answer should persist");
  await app.coachSend("warm and gentle");
  assert(
    app.STATE.profile.communicationStyle === "warm",
    "style answer should persist as warm"
  );
  assert(
    app.STATE.profile.interviewProgress.currentTopic === "whats_here",
    `expected whats_here, got ${app.STATE.profile.interviewProgress.currentTopic}`
  );
  return app;
}

async function main() {
  // Free-chat inference must still enrich profile outside the interview.
  const free = loadApp();
  free.inferProfileFromMessage("I want to cook more with my family");
  assert(
    (free.STATE.profile.values || []).length > 0,
    "free-chat inference should still fill values"
  );
  free.inferProfileFromMessage("I can't leave the house");
  assert(
    (free.STATE.profile.avoiding || []).some((s) => /leave the house/i.test(s)),
    "free-chat inference should still fill avoiding"
  );

  const cantLeave = await interviewThroughStyle();
  await cantLeave.coachSend("I can't leave the house");
  assert(
    cantLeave.STATE.profile.struggles.includes("avoidance"),
    "whats_here parser should still record avoidance"
  );
  assert(
    !(cantLeave.STATE.profile.avoiding || []).length,
    "struggle answer must not pre-fill avoiding via free-chat inference"
  );
  assert(
    cantLeave.STATE.profile.interviewProgress.currentTopic === "avoiding",
    `avoidance struggle should still ask the avoiding follow-up, got ${cantLeave.STATE.profile.interviewProgress.currentTopic}`
  );
  assert(
    /what comes up first/i.test(lastCoachText(cantLeave)),
    "Coach should ask what is being avoided, not skip ahead"
  );
  assert(
    !(cantLeave.STATE.profile.interviewProgress.askedTopics || []).includes("avoiding"),
    "avoiding topic must not be marked asked before the user answers it"
  );
  await cantLeave.coachSend("phone calls and leaving the house");
  assert(
    (cantLeave.STATE.profile.avoiding || []).some((s) => /phone calls/i.test(s)),
    "the dedicated avoiding answer should still be stored"
  );
  assert(
    cantLeave.STATE.profile.interviewProgress.currentTopic === "values",
    `after avoiding, expected values, got ${cantLeave.STATE.profile.interviewProgress.currentTopic}`
  );

  const wantTo = await interviewThroughStyle();
  await wantTo.coachSend("I want to feel like myself again");
  assert(
    !(wantTo.STATE.profile.values || []).length,
    "struggle answer must not pre-fill values via free-chat inference"
  );
  assert(
    wantTo.STATE.profile.interviewProgress.currentTopic === "values",
    `values question was skipped; currentTopic=${wantTo.STATE.profile.interviewProgress.currentTopic}`
  );
  assert(
    /what would you want to be doing more of/i.test(lastCoachText(wantTo)),
    "Coach should still ask the values question after a struggle answer that contains 'I want to'"
  );

  const namedWant = loadApp();
  namedWant.startInterview();
  await namedWant.coachSend("I want to be called Maya");
  assert(
    !(namedWant.STATE.profile.values || []).length,
    "name answers containing 'I want to' must not fill values and skip that topic later"
  );

  console.log("OK interview inference no longer skips later topics");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
