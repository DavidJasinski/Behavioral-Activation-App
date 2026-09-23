/**
 * Regressions: interview answers and stored profile topics must not treat
 * preference verbs as the activity. "I like walking" used to store values
 * ["like", "walking"]; the Coach chip then persisted "5 minutes of like"
 * (or "5 minutes around like") with no edit/delete UI.
 *
 * Run from repo root:
 *   node scripts/check_profile_topic_fillers.js
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
      `\nthis.STATE = STATE;\nthis.coachSend = coachSend;\nthis.generateSuggestions = generateSuggestions;\nthis.profileTopics = profileTopics;\nthis.firstContentTopic = firstContentTopic;\n`,
    sandbox
  );
  return sandbox;
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function titles(app) {
  return app.STATE.activations.map((a) => a.title);
}

async function answerTopic(app, topicId, text) {
  app.STATE.coach.mode = "interview";
  app.STATE.profile.interviewStarted = true;
  app.STATE.profile.interviewProgress.currentTopic = topicId;
  await app.coachSend(text);
}

async function main() {
  assert(
    JSON.stringify(loadApp().profileTopics("I like walking and cooking")) ===
      JSON.stringify(["walking", "cooking"]),
    "profileTopics kept the preference verb"
  );
  assert(
    JSON.stringify(loadApp().profileTopics("I want to cook")) ===
      JSON.stringify(["cook"]),
    "profileTopics kept want"
  );
  assert(
    JSON.stringify(loadApp().profileTopics("I love walking")) ===
      JSON.stringify(["walking"]),
    "leading love should yield the activity"
  );
  assert(
    JSON.stringify(loadApp().profileTopics("love")) === JSON.stringify(["love"]),
    "love alone is a value and must be kept"
  );
  assert(
    JSON.stringify(loadApp().profileTopics("friendship and love")) ===
      JSON.stringify(["friendship", "love"]),
    "love after a real topic must be kept"
  );
  assert(
    JSON.stringify(loadApp().profileTopics("reading and music")) ===
      JSON.stringify(["reading", "music"]),
    "plain activities should pass through"
  );
  assert(
    JSON.stringify(
      loadApp().profileTopics("I feel most like myself when I paint")
    ) === JSON.stringify(["paint"]),
    "feel/like/myself discourse should leave the activity"
  );

  const values = loadApp();
  await answerTopic(values, "values", "I like walking and cooking");
  assert(
    JSON.stringify(values.STATE.profile.values) ===
      JSON.stringify(["walking", "cooking"]),
    `values parse stored ${JSON.stringify(values.STATE.profile.values)}`
  );
  assert(
    (values.STATE.profile.valueNotes || []).some((n) => /walking/.test(n)),
    "value notes should keep the original answer"
  );
  values.STATE.coach.mode = "free";
  values.STATE.profile.interviewComplete = true;
  values.STATE.profile.energizers = [];
  const valueChips = values.generateSuggestions();
  assert(
    valueChips.some((s) => s === "suggest an activation around walking"),
    `expected walking chip, got ${valueChips.join(" | ")}`
  );
  assert(
    !valueChips.some((s) => /around like\b|around want\b/.test(s)),
    `junk value chip: ${valueChips.join(" | ")}`
  );
  await values.coachSend("suggest an activation around walking");
  assert(
    titles(values).some((t) => t === "5 minutes around walking"),
    `expected walking plan, got ${titles(values).join(" | ")}`
  );
  assert(
    !titles(values).some((t) => /\b(like|want|enjoy)\b/i.test(t)),
    `persisted a filler title: ${titles(values).join(" | ")}`
  );

  const energizers = loadApp();
  await answerTopic(energizers, "energizers", "I want to cook");
  assert(
    JSON.stringify(energizers.STATE.profile.energizers) ===
      JSON.stringify(["cook"]),
    `energizers parse stored ${JSON.stringify(energizers.STATE.profile.energizers)}`
  );
  energizers.STATE.coach.mode = "free";
  energizers.STATE.profile.interviewComplete = true;
  await energizers.coachSend("suggest something to do");
  assert(
    titles(energizers).some((t) => t === "5 minutes of cook"),
    `expected cook plan, got ${titles(energizers).join(" | ")}`
  );
  assert(
    !titles(energizers).some((t) => /\b(like|want|enjoy)\b/i.test(t)),
    `persisted a filler title from energizers: ${titles(energizers).join(" | ")}`
  );

  // Already-saved filler-first topics must not title a new plan item.
  const stored = loadApp();
  stored.STATE.coach.mode = "free";
  stored.STATE.profile.interviewComplete = true;
  stored.STATE.profile.values = ["like", "walking"];
  stored.STATE.profile.energizers = ["want", "cook"];
  const storedChips = stored.generateSuggestions();
  assert(
    storedChips.some((s) => s === "suggest an activation around walking"),
    `stored filler values still chipped wrong: ${storedChips.join(" | ")}`
  );
  assert(
    !storedChips.some((s) => /around like\b|around want\b/.test(s)),
    `stored fillers still offered: ${storedChips.join(" | ")}`
  );
  await stored.coachSend("suggest an activation around walking");
  assert(
    titles(stored).some((t) => t === "5 minutes of cook"),
    `expected cook from stored energizers, got ${titles(stored).join(" | ")}`
  );
  assert(
    !titles(stored).some((t) => /\b(like|want)\b/i.test(t)),
    `stored fillers were persisted: ${titles(stored).join(" | ")}`
  );

  const enjoy = loadApp();
  await answerTopic(enjoy, "values", "I enjoy gardening");
  assert(
    JSON.stringify(enjoy.STATE.profile.values) === JSON.stringify(["gardening"]),
    `enjoy should not be the value, got ${JSON.stringify(enjoy.STATE.profile.values)}`
  );

  console.log("OK profile topic fillers");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
