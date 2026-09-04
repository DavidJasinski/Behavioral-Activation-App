/**
 * Regressions: interview style (and free-chat tone) parsers must check
 * negation before concise/short/brief.
 *
 * The style question itself offers "concise and direct". Answers like
 * "don't be concise" / "warm, not concise" / "don't be short with me"
 * historically matched /concise|short|brief/ and persisted
 * communicationStyle=concise + concise tone. There is no interview UI to
 * undo that, and every later reply is truncated to two sentences.
 *
 * Distinct from PR #33 (refusesPush), PR #36 (bare hard / missing direct),
 * PR #40 (refusesEasy), PR #44 (refusesHard), PR #45 (\bless\b inside
 * unless/hopeless/blessing), and PR #47 (honestyDiscourse). If merging
 * with interviewCommunicationStyle(), keep refusesConcise() in front of
 * any /concise|short|brief/ test — including the nested one in PR #36's
 * refuse-push branch.
 *
 * Do not treat "don't ramble" as a refusal; that is a concise request.
 *
 * Run from repo root:
 *   node scripts/check_refused_concise.js
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
      `\nthis.STATE = STATE;\nthis.coachSend = coachSend;\nthis.startInterview = startInterview;\nthis.refusesConcise = typeof refusesConcise === "function" ? refusesConcise : null;\n`,
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
  assert(
    typeof loadApp().refusesConcise === "function",
    "refusesConcise helper is missing"
  );

  // Negated concise/short/brief answers must stay warm, not flip to concise.
  for (const text of [
    "don't be concise",
    "please don't be concise",
    "do not be concise",
    "warm, not concise",
    "don't be short with me",
    "I don't want you to be brief",
    "never be so short"
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

  // Explicit concise requests (including "don't ramble") must still land.
  for (const [text, expectStyle] of [
    ["concise", "concise"],
    ["be shorter", "concise"],
    ["brief", "concise"],
    ["don't ramble", "concise"],
    ["to the point", "concise"],
    ["I don't know, be short", "concise"],
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

  // Free-chat tone path: "don't be shorter" matched \bshorter\b then /short/
  // and persisted concise — the opposite request.
  {
    const app = loadApp();
    await app.coachSend("don't be shorter");
    assert(
      app.STATE.preferences.tone === "warm",
      `free-chat "don't be shorter" should persist tone=warm, got ${JSON.stringify(
        app.STATE.preferences.tone
      )}`
    );
    assert(
      app.STATE.profile.communicationStyle === "warm",
      `free-chat "don't be shorter" should persist communicationStyle=warm, got ${JSON.stringify(
        app.STATE.profile.communicationStyle
      )}`
    );
  }

  {
    const app = loadApp();
    await app.coachSend("be shorter");
    assert(
      app.STATE.preferences.tone === "concise",
      `free-chat "be shorter" should persist tone=concise, got ${JSON.stringify(
        app.STATE.preferences.tone
      )}`
    );
  }

  console.log("OK refused-concise checks passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
