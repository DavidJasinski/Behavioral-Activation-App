/**
 * Regressions: the name question must not persist greeting/politeness wrappers
 * as profile.name. "Just call me Alex" / "Hi I'm Maya" historically stored
 * Just / Hi because prefixes were only stripped at the start of the string,
 * and there is no later UI to change the name.
 *
 * Distinct from interview consent words (yes/ok/sure, PR #38) and hedges
 * ("I'm not sure", "call me later", PR #41). This is phrase-in-the-middle
 * extraction: call me / I'm / my name is anywhere in the reply.
 *
 * Run from repo root:
 *   node scripts/check_interview_name_wrappers.js
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
      `\nthis.STATE = STATE;\nthis.coachSend = coachSend;\nthis.startInterview = startInterview;\nthis.interviewNameToken = interviewNameToken;\n`,
    sandbox
  );
  return sandbox;
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
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
  for (const [text, expect] of [
    ["Sam", "Sam"],
    ["I'm Maya", "Maya"],
    ["I am Maya", "Maya"],
    ["call me Jordan", "Jordan"],
    ["my name is Priya", "Priya"],
    ["Just call me Alex", "Alex"],
    ["just call me Alex", "Alex"],
    ["Please call me Maya", "Maya"],
    ["You can call me Sam", "Sam"],
    ["My friends call me Alex", "Alex"],
    ["Hi I'm Jordan", "Jordan"],
    ["Hi, I'm Jordan", "Jordan"],
    ["Hey I'm Priya", "Priya"],
    ["Hello, my name is Maya", "Maya"],
    ["Hi Alex", "Alex"]
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

  console.log("OK interview-name wrapper checks passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
