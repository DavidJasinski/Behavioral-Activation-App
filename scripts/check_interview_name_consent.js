/**
 * Regressions: the welcome copy tells people to say "yes", and the Interview
 * button starts the name question immediately. A follow-up yes/ok/sure must
 * not persist as profile.name — there is no UI to change it later.
 *
 * Run from repo root:
 *   node scripts/check_interview_name_consent.js
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
      `\nthis.STATE = STATE;\nthis.coachSend = coachSend;\nthis.startInterview = startInterview;\n`,
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

async function startOnNameQuestion() {
  const app = loadApp();
  app.startInterview();
  assert(
    app.STATE.coach.mode === "interview",
    "startInterview should enter interview mode"
  );
  assert(
    app.STATE.profile.interviewProgress.currentTopic === "name",
    `expected name topic, got ${app.STATE.profile.interviewProgress.currentTopic}`
  );
  return app;
}

async function main() {
  for (const text of ["yes", "Yes", "yes.", "yeah", "yep", "sure", "ok", "okay", "Okay!"]) {
    const app = await startOnNameQuestion();
    await app.coachSend(text);
    assert(
      app.STATE.profile.name === "",
      `name question + "${text}" persisted profile.name=${JSON.stringify(app.STATE.profile.name)}`
    );
    assert(
      !app.STATE.profile.interviewProgress.askedTopics.includes("name"),
      `name question + "${text}" consumed the name topic`
    );
    assert(
      app.STATE.coach.mode === "interview",
      `name question + "${text}" left interview mode`
    );
    assert(
      app.STATE.profile.interviewProgress.currentTopic === "name",
      `name question + "${text}" advanced off the name topic`
    );
  }

  const welcomeYes = loadApp();
  await welcomeYes.coachSend("yes");
  await welcomeYes.coachSend("yes");
  assert(
    welcomeYes.STATE.profile.name === "",
    `welcome "yes" then another "yes" persisted name=${JSON.stringify(welcomeYes.STATE.profile.name)}`
  );
  assert(
    welcomeYes.STATE.profile.interviewProgress.currentTopic === "name",
    "double yes should still be asking for a name"
  );

  const named = await startOnNameQuestion();
  await named.coachSend("yes");
  await named.coachSend("Alex");
  assert(
    named.STATE.profile.name === "Alex",
    `after rejecting yes, "Alex" should stick, got ${JSON.stringify(named.STATE.profile.name)}`
  );

  for (const [text, expect] of [
    ["Sam", "Sam"],
    ["I'm Maya", "Maya"],
    ["call me Jordan", "Jordan"],
    ["my name is Priya", "Priya"]
  ]) {
    const app = await startOnNameQuestion();
    await app.coachSend(text);
    assert(
      app.STATE.profile.name === expect,
      `"${text}" should persist name=${expect}, got ${JSON.stringify(app.STATE.profile.name)}`
    );
  }

  const skipped = await startOnNameQuestion();
  await skipped.coachSend("skip");
  assert(
    skipped.STATE.profile.name === "",
    "skip should still leave the name empty"
  );
  assert(
    skipped.STATE.profile.interviewProgress.askedTopics.includes("name"),
    "skip should still consume the name topic"
  );
  assert(
    skipped.STATE.profile.interviewProgress.currentTopic !== "name",
    "skip should advance past the name topic"
  );
  assert(
    lastCoachText(skipped).length > 0,
    "skip should still get a coach follow-up"
  );

  console.log("OK interview-name consent checks passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
