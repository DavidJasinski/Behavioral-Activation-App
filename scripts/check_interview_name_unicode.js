/**
 * Regressions: the name question must persist real given names that use
 * letters outside ASCII a-z (José, François, 李). The previous validator
 * was /^[a-z'-]{1,30}$/i, so those answers were dropped, the topic was
 * still marked asked, and there is no later UI to set a name.
 *
 * Distinct from consent words (PR #38), hedges (PR #41), call-me / I'm
 * wrappers (PR #43), "this is" (PR #46), and nickname / known-as extractors.
 * If merging with those, keep Unicode letters in every name-token capture
 * and do not mark `name` asked unless a name was stored or the user skipped.
 *
 * Run from repo root:
 *   node scripts/check_interview_name_unicode.js
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
      `\nthis.STATE = STATE;\nthis.coachSend = coachSend;\nthis.startInterview = startInterview;\nthis.isGivenNameToken = isGivenNameToken;\n`,
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
  assert(appTokenSanity(), "isGivenNameToken helper should accept Unicode letters");

  for (const [text, expect] of [
    ["Sam", "Sam"],
    ["I'm Maya", "Maya"],
    ["call me Jordan", "Jordan"],
    ["José", "José"],
    ["I'm José", "José"],
    ["call me José", "José"],
    ["François", "François"],
    ["I'm Renée", "Renée"],
    ["Siobhán", "Siobhán"],
    ["李", "李"],
    ["My name is 李", "李"]
  ]) {
    const app = await startOnNameQuestion();
    await app.coachSend(text);
    assert(
      app.STATE.profile.name === expect,
      `"${text}" should persist name=${expect}, got ${JSON.stringify(app.STATE.profile.name)}`
    );
    assert(
      app.STATE.profile.interviewProgress.askedTopics.includes("name"),
      `"${text}" should consume the name topic after a real name`
    );
  }

  const rejected = await startOnNameQuestion();
  await rejected.coachSend("😊");
  assert(
    rejected.STATE.profile.name === "",
    "emoji-only answers should not become a name"
  );
  assert(
    !rejected.STATE.profile.interviewProgress.askedTopics.includes("name"),
    "failed name parse must not mark the topic asked"
  );
  assert(
    rejected.STATE.profile.interviewProgress.currentTopic === "name",
    "failed name parse should stay on the name question"
  );

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

  console.log("OK interview-name unicode checks passed");
}

function appTokenSanity() {
  const app = loadApp();
  return (
    app.isGivenNameToken("José") &&
    app.isGivenNameToken("François") &&
    app.isGivenNameToken("李") &&
    app.isGivenNameToken("Sam") &&
    app.isGivenNameToken("O'Brien") &&
    !app.isGivenNameToken("😊") &&
    !app.isGivenNameToken("José Ann") &&
    !app.isGivenNameToken("")
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
