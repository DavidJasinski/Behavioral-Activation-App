/**
 * Regressions: the name question must extract the actual name from
 * "known as" / "know me as" introductions. "I'm known as Maya" stored
 * Known, and "People know me as Alex" stored People, because the parser
 * only strips a start-anchored I'm / call me prefix then takes the next
 * token. There is no later UI to change the name, and needs() then
 * skips the topic forever.
 *
 * Distinct from interview consent words (yes/ok/sure, PR #38), hedges
 * ("I'm not sure", "call me later", PR #41), call-me / I'm wrappers
 * ("Just call me Alex", PR #43), "this is " (PR #46), and
 * called / named / I-go-by (PR #48). Those still leave "known as"
 * / "know me as" as first-token captures (Known / People).
 *
 * Run from repo root:
 * node scripts/check_interview_name_known_as.js
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
    ["call me Jordan", "Jordan"],
    ["I'm known as Maya", "Maya"],
    ["I am known as Alex", "Alex"],
    ["I'm known as Priya.", "Priya"],
    ["People know me as Alex", "Alex"],
    ["Friends know me as Sam", "Sam"],
    ["Everyone knows me as Jordan", "Jordan"],
    ["My friends know me as Maya", "Maya"],
    ["they know me as Priya", "Priya"]
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

  console.log("OK interview-name known-as checks passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
