/**
 * Regressions: interview abort phrases must pause before the name parser
 * runs. Exact "stop" already paused; "please stop" and "stop the interview"
 * were stored as profile.name (no UI to change it) and the interview continued.
 *
 * Run from repo root:
 *   node scripts/check_interview_pause.js
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
  assert(app.STATE.coach.mode === "interview", "startInterview should enter interview mode");
  assert(
    app.STATE.profile.interviewProgress.currentTopic === "name",
    `expected name topic, got ${app.STATE.profile.interviewProgress.currentTopic}`
  );
  return app;
}

async function main() {
  const pauses = [
    "please stop",
    "Please stop.",
    "stop please",
    "stop the interview",
    "Stop the interview.",
    "please stop the interview",
    "pause the interview",
    "please pause",
    "stop now",
    "stop it",
    "just stop",
    "can we stop",
    "can you please stop",
    "could you stop asking",
    "let's stop",
    "let's pause",
    "I want to stop",
    "I'd like to pause",
    "stop asking",
    "stop asking me questions",
    "okay stop",
    "stop",
    "later"
  ];

  for (const text of pauses) {
    const app = await startOnNameQuestion();
    await app.coachSend(text);
    assert(
      app.STATE.profile.name === "",
      `name question + "${text}" persisted profile.name=${JSON.stringify(app.STATE.profile.name)}`
    );
    assert(
      app.STATE.coach.mode === "free",
      `"${text}" should pause the interview, mode=${app.STATE.coach.mode}`
    );
    const asked = app.STATE.profile.interviewProgress.askedTopics || [];
    assert(
      !asked.includes("name"),
      `"${text}" consumed the name topic: ${JSON.stringify(asked)}`
    );
    if (text === "I want to stop") {
      assert(
        !(app.STATE.profile.values || []).length,
        `"I want to stop" wrote values=${JSON.stringify(app.STATE.profile.values)}`
      );
    }
  }

  const keepGoing = ["I can't stop worrying", "I cannot stop avoiding the store", "don't stop"];
  for (const text of keepGoing) {
    const app = await startOnNameQuestion();
    await app.coachSend(text);
    assert(
      app.STATE.coach.mode === "interview",
      `"${text}" should stay in the interview, mode=${app.STATE.coach.mode}`
    );
  }

  {
    const app = await startOnNameQuestion();
    await app.coachSend("please stop");
    await app.coachSend("continue interview");
    assert(app.STATE.coach.mode === "interview", "continue interview should resume");
    assert(
      app.STATE.profile.interviewProgress.currentTopic === "name",
      `resume should re-ask name, got ${app.STATE.profile.interviewProgress.currentTopic}`
    );
    await app.coachSend("Maya");
    assert(app.STATE.profile.name === "Maya", `expected Maya, got ${JSON.stringify(app.STATE.profile.name)}`);
  }

  {
    const app = await startOnNameQuestion();
    await app.coachSend("I'm Maya");
    assert(app.STATE.profile.name === "Maya", `I'm Maya should persist, got ${JSON.stringify(app.STATE.profile.name)}`);
    assert(app.STATE.coach.mode === "interview", "a real name should advance the interview");
    assert(
      app.STATE.profile.communicationStyle == null,
      "style should still be unset on the style question"
    );
    await app.coachSend("please stop");
    assert(app.STATE.coach.mode === "free", "please stop on the style question should pause");
    assert(
      app.STATE.profile.communicationStyle == null,
      `please stop set communicationStyle=${JSON.stringify(app.STATE.profile.communicationStyle)}`
    );
    assert(app.STATE.profile.name === "Maya", "pausing must keep the name already stored");
  }

  {
    const app = await startOnNameQuestion();
    await app.coachSend("Alex");
    assert(app.STATE.profile.name === "Alex", `Alex should persist, got ${JSON.stringify(app.STATE.profile.name)}`);
  }

  console.log("OK interview pause phrases do not become the user's name");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
