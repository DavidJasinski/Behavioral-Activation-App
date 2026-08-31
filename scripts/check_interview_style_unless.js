/**
 * Regressions: the interview style parser must not treat the substring
 * "less" inside unless / hopeless / blessing as a concise-style request.
 *
 * The style question is open-ended. Hedged warm answers like
 * "Warm, unless you have a better default" historically matched /less/
 * and persisted communicationStyle=concise + concise tone. There is no
 * interview UI to undo that, and every later reply is truncated to two
 * sentences.
 *
 * Distinct from PR #36 (bare "hard" / missing "direct") and PR #33
 * (refuse-push). If those merge with interviewCommunicationStyle(),
 * keep \bless\b rather than a bare `less` alternative.
 *
 * Run from repo root:
 *   node scripts/check_interview_style_unless.js
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

async function startOnStyleQuestion() {
  const app = loadApp();
  app.startInterview();
  assert(
    app.STATE.profile.interviewProgress.currentTopic === "name",
    `expected name topic, got ${app.STATE.profile.interviewProgress.currentTopic}`
  );
  await app.coachSend("Sam");
  assert(
    app.STATE.profile.interviewProgress.currentTopic === "style",
    `expected style topic after name, got ${app.STATE.profile.interviewProgress.currentTopic}`
  );
  return app;
}

async function main() {
  // Hedged / embedded-"less" warm answers must stay warm, not flip to concise.
  for (const text of [
    "Warm, unless you have a better default",
    "I like warm unless you recommend otherwise",
    "warm and gentle unless I ask otherwise",
    "I feel hopeless, please be warm",
    "Warm is a blessing"
  ]) {
    const app = await startOnStyleQuestion();
    await app.coachSend(text);
    assert(
      app.STATE.profile.communicationStyle === "warm",
      `"${text}" should persist communicationStyle=warm, got ${JSON.stringify(
        app.STATE.profile.communicationStyle
      )}`
    );
    assert(
      app.STATE.preferences.tone === "warm",
      `"${text}" should persist tone=warm, got ${JSON.stringify(
        app.STATE.preferences.tone
      )}`
    );
  }

  // Explicit concise / less-wordy requests must still land on concise.
  for (const [text, expectStyle] of [
    ["concise", "concise"],
    ["be shorter", "concise"],
    ["less wordy", "concise"],
    ["I want less", "concise"],
    ["warm", "warm"],
    ["push me", "direct"]
  ]) {
    const app = await startOnStyleQuestion();
    await app.coachSend(text);
    assert(
      app.STATE.profile.communicationStyle === expectStyle,
      `"${text}" should persist communicationStyle=${expectStyle}, got ${JSON.stringify(
        app.STATE.profile.communicationStyle
      )}`
    );
  }

  console.log("OK interview-style unless checks passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
