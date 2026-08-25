/**
 * Regressions: welcome copy invites people to jump into chat before the
 * interview. Opportunistic inferProfileFromMessage must not fill
 * values/energizers/avoiding in a way that permanently skips those interview
 * topics, and must not mint suggestion chips that persist junk plan items.
 *
 * Run from repo root:
 *   node scripts/check_pre_interview_inference.js
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
      `\nthis.STATE = STATE;\nthis.coachSend = coachSend;\nthis.startInterview = startInterview;\nthis.nextInterviewTopic = nextInterviewTopic;\nthis.generateSuggestions = generateSuggestions;\nthis.handleInterviewAnswer = handleInterviewAnswer;\n`,
    sandbox
  );
  return sandbox;
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function remainingTopicIds(app) {
  const remaining = [];
  // Walk a copy of askedTopics via nextInterviewTopic without permanently
  // consuming later topics: snapshot, probe, restore.
  const snap = JSON.stringify(app.STATE.profile.interviewProgress);
  let guard = 0;
  while (guard++ < 20) {
    const topic = app.nextInterviewTopic();
    if (!topic) break;
    remaining.push(topic.id);
    const asked = app.STATE.profile.interviewProgress.askedTopics;
    if (!asked.includes(topic.id)) asked.push(topic.id);
  }
  app.STATE.profile.interviewProgress = JSON.parse(snap);
  return remaining;
}

async function main() {
  const wantTo = loadApp();
  await wantTo.coachSend("I want to feel like myself again");
  assert(
    !(wantTo.STATE.profile.values || []).length,
    `pre-interview "I want to…" filled values=${JSON.stringify(wantTo.STATE.profile.values)}`
  );
  assert(
    !wantTo.generateSuggestions().some((s) => /around want\b/i.test(s)),
    `pre-interview "I want to…" offered junk value chip: ${wantTo.generateSuggestions().join(" | ")}`
  );

  wantTo.STATE.profile.name = "Alex";
  wantTo.STATE.profile.communicationStyle = "warm";
  wantTo.STATE.profile.struggles = ["depression"];
  wantTo.STATE.profile.interviewProgress.askedTopics = ["name", "style", "whats_here"];
  const afterWantTo = remainingTopicIds(wantTo);
  assert(
    afterWantTo.includes("values"),
    `pre-interview "I want to…" skipped the values interview topic; remaining=${afterWantTo.join(",")}`
  );

  const likeTo = loadApp();
  await likeTo.coachSend("I like to walk by the river");
  assert(
    !(likeTo.STATE.profile.energizers || []).length,
    `pre-interview "I like to…" filled energizers=${JSON.stringify(likeTo.STATE.profile.energizers)}`
  );
  likeTo.STATE.profile.name = "Alex";
  likeTo.STATE.profile.communicationStyle = "warm";
  likeTo.STATE.profile.struggles = ["depression"];
  likeTo.STATE.profile.interviewProgress.askedTopics = ["name", "style", "whats_here", "values"];
  const afterLikeTo = remainingTopicIds(likeTo);
  assert(
    afterLikeTo.includes("energizers"),
    `pre-interview "I like to…" skipped energizers; remaining=${afterLikeTo.join(",")}`
  );

  const cantLeave = loadApp();
  await cantLeave.coachSend("I can't leave the house");
  cantLeave.STATE.profile.name = "Alex";
  cantLeave.STATE.profile.communicationStyle = "warm";
  cantLeave.STATE.profile.struggles = ["anxiety", "avoidance"];
  cantLeave.STATE.profile.interviewProgress.askedTopics = ["name", "style", "whats_here"];
  const afterCantLeave = remainingTopicIds(cantLeave);
  assert(
    afterCantLeave.includes("avoiding"),
    `pre-interview "I can't leave…" skipped avoiding; remaining=${afterCantLeave.join(",")}`
  );

  const paused = loadApp();
  paused.startInterview();
  await paused.coachSend("Alex");
  await paused.coachSend("enough");
  assert(paused.STATE.coach.mode === "free", "enough should pause the interview");
  await paused.coachSend("I want to feel like myself again");
  assert(
    !(paused.STATE.profile.valueNotes || []).length,
    "paused-interview free chat should not count as a values answer"
  );
  paused.STATE.profile.communicationStyle = "warm";
  paused.STATE.profile.struggles = ["depression"];
  const asked = new Set(paused.STATE.profile.interviewProgress.askedTopics || []);
  ["name", "style", "whats_here"].forEach((id) => asked.add(id));
  paused.STATE.profile.interviewProgress.askedTopics = Array.from(asked);
  const afterPause = remainingTopicIds(paused);
  assert(
    afterPause.includes("values"),
    `paused-interview "I want to…" skipped values; remaining=${afterPause.join(",")}`
  );

  const skipped = loadApp();
  await skipped.coachSend("not now");
  await skipped.coachSend("I want to feel like myself again");
  assert(
    (skipped.STATE.profile.values || []).length > 0,
    "after an explicit interview skip, slow-path inference should still learn values"
  );

  const complete = loadApp();
  complete.STATE.profile.interviewComplete = true;
  complete.STATE.profile.interviewStarted = true;
  complete.STATE.coach.mode = "free";
  await complete.coachSend("I want to feel like myself again");
  assert(
    (complete.STATE.profile.values || []).length > 0,
    "after interview completion, supplementary value inference should still run"
  );

  const persisted = loadApp();
  persisted.STATE.profile.values = ["want", "feel", "like", "myself"];
  persisted.STATE.profile.energizers = ["like", "walk"];
  persisted.STATE.profile.avoiding = ["I can't leave the house"];
  persisted.STATE.profile.name = "Alex";
  persisted.STATE.profile.communicationStyle = "warm";
  persisted.STATE.profile.struggles = ["anxiety", "avoidance"];
  persisted.STATE.profile.interviewProgress.askedTopics = ["name", "style", "whats_here"];
  const afterPersisted = remainingTopicIds(persisted);
  assert(
    afterPersisted.includes("values"),
    `inferred-only values skipped the values topic; remaining=${afterPersisted.join(",")}`
  );
  assert(
    afterPersisted.includes("energizers"),
    `inferred-only energizers skipped the energizers topic; remaining=${afterPersisted.join(",")}`
  );
  assert(
    afterPersisted.includes("avoiding"),
    `inferred-only avoiding skipped the avoiding topic; remaining=${afterPersisted.join(",")}`
  );

  const named = loadApp();
  named.startInterview();
  await named.coachSend("Maya");
  assert(
    named.STATE.profile.name === "Maya",
    `real names must still parse, got ${JSON.stringify(named.STATE.profile.name)}`
  );

  console.log("OK pre-interview inference checks passed");
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
