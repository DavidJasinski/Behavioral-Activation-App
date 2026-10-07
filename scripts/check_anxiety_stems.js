/**
 * Regressions: interview struggle answers that use the common adjective
 * forms of anxiety must record anxiety and ask what the user is avoiding.
 *
 * "anxiet" does not match "anxious", and "worry" does not match "worried"
 * or "worries". Those answers left struggles empty, marked the topic asked,
 * and permanently skipped the avoiding follow-up. There is no UI to edit
 * struggles afterward, so exposure suggestions never learned the fear.
 *
 * Direct negation must not start that follow-up ("I'm not anxious, I'm just
 * tired"). "I'm not just anxious" still is anxiety.
 *
 * Run from repo root:
 *   node scripts/check_anxiety_stems.js
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

async function answerStruggles(text) {
  const app = loadApp();
  app.startInterview();
  await app.coachSend("Maya");
  await app.coachSend("warm");
  assert(
    app.STATE.profile.interviewProgress.currentTopic === "whats_here",
    `expected struggles question, got ${app.STATE.profile.interviewProgress.currentTopic}`
  );
  await app.coachSend(text);
  return app;
}

async function main() {
  const anxietyAnswers = [
    "I'm anxious",
    "I've been really anxious about leaving the house",
    "I've been worried",
    "My worries keep me from making phone calls",
    "I feel anxious"
  ];

  for (const text of anxietyAnswers) {
    const app = await answerStruggles(text);
    assert(
      (app.STATE.profile.struggles || []).includes("anxiety"),
      `"${text}" did not record anxiety: ${JSON.stringify(app.STATE.profile.struggles)}`
    );
    assert(
      app.STATE.profile.interviewProgress.currentTopic === "avoiding",
      `"${text}" skipped the avoiding question (topic=${app.STATE.profile.interviewProgress.currentTopic})`
    );
    assert(app.STATE.coach.mode === "interview", `"${text}" ended the interview`);
    const asked = app.STATE.profile.interviewProgress.askedTopics || [];
    assert(
      !asked.includes("avoiding"),
      `"${text}" marked avoiding asked before it was answered: ${JSON.stringify(asked)}`
    );
  }

  {
    const app = await answerStruggles("I have anxiety");
    assert(
      app.STATE.profile.struggles.includes("anxiety"),
      "noun anxiety should still record anxiety"
    );
    assert(
      app.STATE.profile.interviewProgress.currentTopic === "avoiding",
      "noun anxiety should still ask what they are avoiding"
    );
  }

  {
    const app = await answerStruggles("I'm overwhelmed");
    assert(
      app.STATE.profile.struggles.includes("anxiety"),
      "overwhelmed should still record anxiety"
    );
  }

  const notAnxiety = [
    "I'm not anxious, I'm just tired",
    "I don't feel anxious",
    "I’m not worried",
    "I have no worries, I'm just tired",
    "I'm just tired",
    "I'm stuck"
  ];

  for (const text of notAnxiety) {
    const app = await answerStruggles(text);
    assert(
      !(app.STATE.profile.struggles || []).includes("anxiety"),
      `"${text}" recorded anxiety: ${JSON.stringify(app.STATE.profile.struggles)}`
    );
    assert(
      app.STATE.profile.interviewProgress.currentTopic !== "avoiding",
      `"${text}" asked the avoiding question`
    );
  }

  {
    const app = await answerStruggles("I'm not anxious, I'm just tired");
    assert(
      app.STATE.profile.struggles.includes("depression"),
      "tired should still record depression when anxiety is negated"
    );
    assert(
      app.STATE.profile.interviewProgress.currentTopic === "values",
      `negated anxiety should continue to values, got ${app.STATE.profile.interviewProgress.currentTopic}`
    );
  }

  {
    const app = await answerStruggles("I'm not just anxious");
    assert(
      app.STATE.profile.struggles.includes("anxiety"),
      `"I'm not just anxious" should still record anxiety`
    );
    assert(
      app.STATE.profile.interviewProgress.currentTopic === "avoiding",
      `"I'm not just anxious" should ask what they are avoiding`
    );
  }

  console.log("OK anxiety adjective answers ask the avoiding follow-up");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
