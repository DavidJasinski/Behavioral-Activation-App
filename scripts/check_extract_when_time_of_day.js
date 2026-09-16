/**
 * Regressions: Coach create requests that name a time of day without
 * today/tonight/tomorrow must still land on today's calendar.
 *
 * extractWhen() only looked for tonight/tomorrow/today, so
 * "schedule a walk this afternoon" (also "this morning", "this evening",
 * "in the afternoon") persisted scheduledFor: null. Calendar marks and
 * today's agenda then hid the step. There is no edit UI to attach a day.
 *
 * "tonight" was already implemented; these are the sibling phrases the
 * interview best-time question itself uses (mornings, afternoons, evenings).
 *
 * Distinct from PR #18 (display of *stored* date-only strings), PR #56
 * (tonight vs tomorrow negation), PR #59 (explicit YYYY-MM-DD), and PR #60
 * (today after 23:00 overflowing to tomorrow). Those still leave
 * "this afternoon" unscheduled.
 *
 * Keep explicit tonight / tomorrow / today.
 *
 * Run from repo root:
 *   node scripts/check_extract_when_time_of_day.js
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

  const document = {
    body: { addEventListener() {} },
    addEventListener() {},
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
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

  const modified = APP_SOURCE.replace(
    /document\.addEventListener\("DOMContentLoaded", init\);/,
    ""
  );

  vm.runInNewContext(
    modified +
      `\nthis.extractWhen = extractWhen;\nthis.executeIntent = executeIntent;\nthis.STATE = STATE;\nthis.todayKey = todayKey;\nthis.activationsOnDay = activationsOnDay;\n`,
    sandbox
  );
  return sandbox;
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function localKey(iso) {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function localHour(iso) {
  return new Date(iso).getHours();
}

function shiftKey(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function main() {
  const app = loadApp();
  assert(typeof app.extractWhen === "function", "extractWhen must exist");

  const today = shiftKey(0);
  const tomorrow = shiftKey(1);

  for (const [text, hour] of [
    ["schedule a walk this morning", 9],
    ["add a 10 minute walk in the morning", 9],
    ["schedule a walk this afternoon", 15],
    ["plan a walk in the afternoon", 15],
    ["add a walk this evening", 18],
    ["schedule a walk in the evening", 18]
  ]) {
    const when = app.extractWhen(text);
    assert(when, `extractWhen("${text}") should return a datetime, got ${when}`);
    assert(
      localKey(when) === today,
      `extractWhen("${text}") should be today (${today}), got ${localKey(when)}`
    );
    assert(
      localHour(when) === hour,
      `extractWhen("${text}") should be ${hour}:00 local, got hour ${localHour(when)}`
    );
  }

  const tonight = app.extractWhen("schedule a walk tonight");
  assert(tonight, 'extractWhen("tonight") should return a datetime');
  assert(localKey(tonight) === today, "tonight should stay today");
  assert(localHour(tonight) === 20, "tonight should stay 20:00");

  const tom = app.extractWhen("schedule a walk tomorrow");
  assert(tom, 'extractWhen("tomorrow") should return a datetime');
  assert(localKey(tom) === tomorrow, "tomorrow should stay tomorrow");

  const todayWhen = app.extractWhen("schedule a walk today");
  assert(todayWhen, 'extractWhen("today") should return a datetime');
  assert(localKey(todayWhen) === today, "today should stay today");

  // Tomorrow still wins when both a day token and a time-of-day are present.
  const tomorrowMorning = app.extractWhen("schedule a walk tomorrow morning");
  assert(
    localKey(tomorrowMorning) === tomorrow,
    `"tomorrow morning" should be tomorrow, got ${localKey(tomorrowMorning)}`
  );

  assert(
    app.extractWhen("just thinking about walking") === null,
    "no when token → null"
  );

  app.STATE.activations = [];
  const action = await app.executeIntent(
    "add_activation",
    "schedule a walk this afternoon"
  );
  assert(action && action.kind === "added_activation", "executeIntent should add an activation");
  assert(
    localKey(action.a.scheduledFor) === today,
    `added activation should be scheduled today, got ${localKey(action.a.scheduledFor)}`
  );
  assert(
    localHour(action.a.scheduledFor) === 15,
    `added activation should be 15:00 local, got hour ${localHour(action.a.scheduledFor)}`
  );
  assert(
    localKey(app.STATE.activations[0].scheduledFor) === today,
    "persisted activation scheduledFor should be today"
  );

  const onToday = app.activationsOnDay(new Date());
  assert(
    onToday.some((a) => a.id === action.a.id),
    "today's calendar agenda must include the this-afternoon walk"
  );

  console.log("OK extractWhen time-of-day checks passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
