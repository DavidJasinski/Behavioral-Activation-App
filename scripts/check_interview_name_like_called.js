/**
 * Regressions: the name question must extract the actual name from
 * "I'd like to be called <name>" / "I like to be called <name>" /
 * "I would like to be called <name>". Those answers stored I'd / I,
 * because the parser only strips a start-anchored I'm / call me prefix
 * then takes the next token. There is no later UI to change the name,
 * and needs() then skips the topic forever.
 *
 * Distinct from interview consent words (yes/ok/sure), hedges
 * ("I'm not sure", "call me later"), call-me / I'm wrappers
 * ("Just call me Alex"), "this is ", called / named / I-go-by
 * ("I'm called" does not match "like to be called"), known-as, nickname,
 * and calls-me / prefer ("prefer to be called" does not match
 * "like to be called"). If merging with those extractors, run this
 * matcher before generic `call me` / `i am|i'm` captures and the
 * first-token fallback.
 *
 * Run from repo root:
 *   node scripts/check_interview_name_like_called.js
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
    ["call me Jordan", "Jordan"],
    ["I'd like to be called Maya", "Maya"],
    ["I like to be called Maya", "Maya"],
    ["I would like to be called Maya", "Maya"],
    ["Please, I'd like to be called Alex", "Alex"],
    ["I'd like to be called Priya.", "Priya"],
    ["I\u2019d like to be called Maya", "Maya"]
  ]) {
    const app = await startOnNameQuestion();
    await app.coachSend(text);
    assert(
      app.STATE.profile.name === expect,
      `"${text}" should persist name=${expect}, got ${JSON.stringify(app.STATE.profile.name)}`
    );
    assert(
      app.STATE.profile.interviewProgress.askedTopics.includes("name"),
      `"${text}" should consume the name topic only after storing it`
    );
  }

  const postponed = await startOnNameQuestion();
  await postponed.coachSend("I'd like to be called later");
  assert(
    postponed.STATE.profile.name === "",
    `postpone phrasing should not persist a name, got ${JSON.stringify(postponed.STATE.profile.name)}`
  );

  const skipped = await startOnNameQuestion();
  await skipped.coachSend("skip");
  assert(
    skipped.STATE.profile.name === "",
    "skip should still leave the name empty"
  );

  console.log("OK interview-name like-to-be-called checks passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
