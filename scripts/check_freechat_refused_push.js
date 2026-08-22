/**
 * Regressions: free-chat refusals of being pushed must not invert into
 * direct/push personalization. The tone intent matches "\bpush me\b" and
 * executeIntent then treats any "push" as a request to be blunt, so
 * "don't push me" persisted the opposite of what the user asked for.
 *
 * Run from repo root:
 *   node scripts/check_freechat_refused_push.js
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
      `\nthis.STATE = STATE;\nthis.classify = classify;\nthis.executeIntent = executeIntent;\nthis.coachSend = coachSend;\nthis.refusesPush = typeof refusesPush === "function" ? refusesPush : null;\n`,
    sandbox
  );
  return sandbox;
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function applyTone(text) {
  const app = loadApp();
  app.STATE.coach.mode = "free";
  app.STATE.profile.interviewStarted = true;
  app.STATE.profile.interviewComplete = true;
  app.STATE.profile.communicationStyle = "warm";
  app.STATE.profile.challengeLevel = "moderate";
  app.STATE.preferences.tone = "warm";
  const intent = app.classify(text);
  await app.executeIntent(intent, text);
  return {
    intent,
    style: app.STATE.profile.communicationStyle,
    tone: app.STATE.preferences.tone,
    challenge: app.STATE.profile.challengeLevel
  };
}

async function sendFree(text) {
  const app = loadApp();
  app.STATE.coach.mode = "free";
  app.STATE.profile.interviewStarted = true;
  app.STATE.profile.interviewComplete = true;
  app.STATE.profile.communicationStyle = "warm";
  app.STATE.profile.challengeLevel = "moderate";
  app.STATE.preferences.tone = "warm";
  await app.coachSend(text);
  const saved = JSON.parse(app.localStorage.getItem("breakFree.v1"));
  return {
    style: app.STATE.profile.communicationStyle,
    tone: app.STATE.preferences.tone,
    challenge: app.STATE.profile.challengeLevel,
    persistedStyle: saved.profile.communicationStyle,
    persistedTone: saved.preferences.tone,
    persistedChallenge: saved.profile.challengeLevel
  };
}

async function main() {
  assert(typeof loadApp().refusesPush === "function", "missing refusesPush");

  for (const text of [
    "don't push me",
    "dont push me",
    "please don't push me",
    "do not push me",
    "never push me",
    "I don't want you to push me"
  ]) {
    const got = await applyTone(text);
    assert(
      got.style !== "direct",
      `executeIntent("${text}") inverted communicationStyle to ${got.style}`
    );
    assert(
      got.tone !== "concise" || /short|concise|brief|less wordy/.test(text),
      `executeIntent("${text}") inverted tone to ${got.tone}`
    );
    assert(
      got.challenge === "gentle",
      `executeIntent("${text}") should set challengeLevel=gentle, got ${got.challenge}`
    );
    assert(
      got.style === "warm",
      `executeIntent("${text}") should set communicationStyle=warm, got ${got.style}`
    );
  }

  const short = await applyTone("don't push me, keep it short");
  assert(
    short.style === "concise",
    `refusing push while asking for short replies should be concise, got ${short.style}`
  );
  assert(
    short.challenge === "gentle",
    `refusing push while asking for short replies should stay gentle, got ${short.challenge}`
  );

  const push = await applyTone("push me");
  assert(push.style === "direct", `executeIntent("push me") should stay direct, got ${push.style}`);
  assert(push.tone === "concise", `executeIntent("push me") should stay concise, got ${push.tone}`);

  const pleasePush = await applyTone("please push me");
  assert(
    pleasePush.style === "direct",
    `executeIntent("please push me") should stay direct, got ${pleasePush.style}`
  );

  const sent = await sendFree("don't push me");
  assert(
    sent.style === "warm" && sent.persistedStyle === "warm",
    `coachSend("don't push me") persisted communicationStyle=${sent.persistedStyle}`
  );
  assert(
    sent.tone === "warm" && sent.persistedTone === "warm",
    `coachSend("don't push me") persisted tone=${sent.persistedTone}`
  );
  assert(
    sent.challenge === "gentle" && sent.persistedChallenge === "gentle",
    `coachSend("don't push me") persisted challengeLevel=${sent.persistedChallenge}`
  );

  console.log("OK free-chat refused-push checks passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
