/**
 * Regressions: Coach create requests that name a clock time without
 * today/tonight/tomorrow must still land on today's calendar.
 *
 * extractWhen() only looked for tonight/tomorrow/today, so
 * "schedule a walk at 3pm" (also "at 3:30pm", "at 15:00", "at noon")
 * persisted scheduledFor: null. Calendar marks and today's agenda then
 * hid the step. There is no edit UI to attach a time.
 *
 * Distinct from PR #18 (display of *stored* date-only strings), PR #56
 * (tonight vs tomorrow negation), PR #59 (explicit YYYY-MM-DD), PR #60
 * (today after 23:00 overflowing to tomorrow), and PR #61 (this
 * morning/afternoon/evening tokens). Those still leave "at 3pm"
 * unscheduled.
 *
 * Keep explicit tonight / tomorrow / today. Do not treat durations
 * ("15 minutes") or bare "at 3" as a clock time.
 *
 * Run from repo root:
 *   node scripts/check_extract_when_clock_time.js
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
      `\nthis.extractWhen = extractWhen;\nthis.extractClockTime = extractClockTime;\nthis.extractActionTitle = extractActionTitle;\nthis.extractMinutes = extractMinutes;\nthis.executeIntent = executeIntent;\nthis.STATE = STATE;\nthis.todayKey = todayKey;\nthis.activationsOnDay = activationsOnDay;\n`,
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

function localMinute(iso) {
  return new Date(iso).getMinutes();
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
  assert(typeof app.extractClockTime === "function", "extractClockTime must exist");

  const today = shiftKey(0);
  const tomorrow = shiftKey(1);

  for (const [text, hour, minute] of [
    ["schedule a walk at 3pm", 15, 0],
    ["schedule a walk at 3 pm", 15, 0],
    ["schedule a walk at 3:30pm", 15, 30],
    ["schedule a walk at 3:30 p.m.", 15, 30],
    ["add a walk at 11am", 11, 0],
    ["plan a walk at 12pm", 12, 0],
    ["schedule a walk at 12am", 0, 0],
    ["schedule a walk at 15:00", 15, 0],
    ["schedule a walk at 21:45", 21, 45],
    ["schedule a walk at noon", 12, 0],
    ["schedule a walk at midnight", 0, 0]
  ]) {
    const when = app.extractWhen(text);
    assert(when, `extractWhen("${text}") should return a datetime, got ${when}`);
    assert(
      localKey(when) === today,
      `extractWhen("${text}") should be today (${today}), got ${localKey(when)}`
    );
    assert(
      localHour(when) === hour && localMinute(when) === minute,
      `extractWhen("${text}") should be ${hour}:${String(minute).padStart(2, "0")} local, got ${localHour(when)}:${String(localMinute(when)).padStart(2, "0")}`
    );
  }

  const tonight = app.extractWhen("schedule a walk tonight");
  assert(tonight, 'extractWhen("tonight") should return a datetime');
  assert(localKey(tonight) === today, "tonight should stay today");
  assert(localHour(tonight) === 20, "tonight should stay 20:00");

  const tom = app.extractWhen("schedule a walk tomorrow");
  assert(tom, 'extractWhen("tomorrow") should return a datetime');
  assert(localKey(tom) === tomorrow, "tomorrow should stay tomorrow");
  assert(localHour(tom) === 10, "tomorrow without a clock should stay 10:00");

  const todayWhen = app.extractWhen("schedule a walk today");
  assert(todayWhen, 'extractWhen("today") should return a datetime');
  assert(localKey(todayWhen) === today, "today should stay today");

  const tomorrowAtThree = app.extractWhen("schedule a walk tomorrow at 3pm");
  assert(
    localKey(tomorrowAtThree) === tomorrow,
    `"tomorrow at 3pm" should be tomorrow, got ${localKey(tomorrowAtThree)}`
  );
  assert(
    localHour(tomorrowAtThree) === 15 && localMinute(tomorrowAtThree) === 0,
    `"tomorrow at 3pm" should be 15:00, got ${localHour(tomorrowAtThree)}:${String(localMinute(tomorrowAtThree)).padStart(2, "0")}`
  );

  const tonightAtNine = app.extractWhen("schedule a walk tonight at 9pm");
  assert(localKey(tonightAtNine) === today, "tonight at 9pm should stay today");
  assert(
    localHour(tonightAtNine) === 21,
    `"tonight at 9pm" should be 21:00, got hour ${localHour(tonightAtNine)}`
  );

  assert(
    app.extractWhen("schedule a 15 minute walk") === null,
    "duration-only '15 minute' must not be treated as 15:00"
  );
  assert(
    app.extractWhen("schedule a walk at 3") === null,
    "bare 'at 3' without am/pm is ambiguous and must stay null"
  );
  assert(
    app.extractWhen("just thinking about walking") === null,
    "no when token → null"
  );

  assert(
    app.extractMinutes("schedule a 15 minute walk at 3pm") === 15,
    "3pm must not steal the duration from '15 minute'"
  );
  assert(
    app.extractActionTitle("schedule a walk at 3pm") === "walk",
    'title should be "walk", not "walk at 3pm"'
  );

  app.STATE.activations = [];
  const action = await app.executeIntent(
    "add_activation",
    "schedule a 15 minute walk at 3pm"
  );
  assert(action && action.kind === "added_activation", "executeIntent should add an activation");
  assert(action.a.title === "walk", `title should be "walk", got ${JSON.stringify(action.a.title)}`);
  assert(action.a.duration === 15, `duration should stay 15, got ${action.a.duration}`);
  assert(
    localKey(action.a.scheduledFor) === today,
    `added activation should be scheduled today, got ${localKey(action.a.scheduledFor)}`
  );
  assert(
    localHour(action.a.scheduledFor) === 15 && localMinute(action.a.scheduledFor) === 0,
    `added activation should be 15:00 local, got ${localHour(action.a.scheduledFor)}:${String(localMinute(action.a.scheduledFor)).padStart(2, "0")}`
  );
  assert(
    localKey(app.STATE.activations[0].scheduledFor) === today,
    "persisted activation scheduledFor should be today"
  );

  const onToday = app.activationsOnDay(new Date());
  assert(
    onToday.some((a) => a.id === action.a.id),
    "today's calendar agenda must include the 3pm walk"
  );

  console.log("OK extractWhen clock-time checks passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
