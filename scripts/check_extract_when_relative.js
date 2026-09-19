/**
 * Regressions: Coach create requests that name a relative offset without
 * today/tonight/tomorrow must still land on the resulting calendar day.
 *
 * extractWhen() only looked for tonight/tomorrow/today, so
 * "schedule a walk in an hour" (also "in 30 minutes", "in 2 hours",
 * "in 2 days", "an hour from now") persisted scheduledFor: null.
 * Calendar marks and that day's agenda then hid the step. There is no
 * edit UI to attach a time.
 *
 * Distinct from PR #18 (display of *stored* date-only strings), PR #56
 * (tonight vs tomorrow negation), PR #59 (explicit YYYY-MM-DD), PR #60
 * (today after 23:00 overflowing to tomorrow), PR #61 (this
 * morning/afternoon/evening tokens), PR #62 (clock times), and PR #63
 * (weekday names). Those still leave "in an hour" unscheduled.
 *
 * Keep explicit tonight / tomorrow / today first. Do not treat a duration
 * ("a 15 minute walk") as a delay from now.
 *
 * Run from repo root:
 *   node scripts/check_extract_when_relative.js
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
      `\nthis.extractWhen = extractWhen;\nthis.extractRelativeOffset = extractRelativeOffset;\nthis.extractActionTitle = extractActionTitle;\nthis.extractMinutes = extractMinutes;\nthis.executeIntent = executeIntent;\nthis.STATE = STATE;\nthis.todayKey = todayKey;\nthis.activationsOnDay = activationsOnDay;\n`,
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

function shiftDate(base, days) {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

function keyOf(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function main() {
  const app = loadApp();
  assert(typeof app.extractWhen === "function", "extractWhen must exist");
  assert(
    typeof app.extractRelativeOffset === "function",
    "extractRelativeOffset must exist"
  );

  const now = new Date(2026, 8, 19, 15, 0, 0, 0); // Sat 19 Sep 2026, 15:00 local
  const today = keyOf(now);
  const tomorrow = keyOf(shiftDate(now, 1));
  const inTwoDays = keyOf(shiftDate(now, 2));

  for (const [text, hour, minute, dayKey] of [
    ["schedule a walk in an hour", 16, 0, today],
    ["schedule a walk in a hour", 16, 0, today],
    ["schedule a walk in 1 hour", 16, 0, today],
    ["add a walk in 2 hours", 17, 0, today],
    ["plan a walk in 30 minutes", 15, 30, today],
    ["schedule a walk in 30 min", 15, 30, today],
    ["schedule a walk an hour from now", 16, 0, today],
    ["schedule a walk 30 minutes from now", 15, 30, today],
    ["schedule a walk in 2 days", 15, 0, inTwoDays]
  ]) {
    const when = app.extractWhen(text, now);
    assert(when, `extractWhen("${text}") should return a datetime, got ${when}`);
    assert(
      localKey(when) === dayKey,
      `extractWhen("${text}") should be ${dayKey}, got ${localKey(when)}`
    );
    assert(
      localHour(when) === hour && localMinute(when) === minute,
      `extractWhen("${text}") should be ${hour}:${String(minute).padStart(2, "0")} local, got ${localHour(when)}:${String(localMinute(when)).padStart(2, "0")}`
    );
  }

  const late = new Date(2026, 8, 19, 23, 30, 0, 0);
  const lateWhen = app.extractWhen("schedule a walk in an hour", late);
  assert(lateWhen, "in an hour after 23:00 should still schedule");
  assert(
    localKey(lateWhen) === keyOf(shiftDate(late, 1)),
    "in an hour after 23:00 should roll to the next local day"
  );
  assert(localHour(lateWhen) === 0 && localMinute(lateWhen) === 30, "23:30 + 1h → 00:30");

  const tonight = app.extractWhen("schedule a walk tonight", now);
  assert(tonight, 'extractWhen("tonight") should return a datetime');
  assert(localKey(tonight) === today, "tonight should stay today");
  assert(localHour(tonight) === 20, "tonight should stay 20:00");

  const tom = app.extractWhen("schedule a walk tomorrow", now);
  assert(tom, 'extractWhen("tomorrow") should return a datetime');
  assert(localKey(tom) === tomorrow, "tomorrow should stay tomorrow");
  assert(localHour(tom) === 10, "tomorrow should stay 10:00");

  const todayWhen = app.extractWhen("schedule a walk today", now);
  assert(todayWhen, 'extractWhen("today") should return a datetime');
  assert(localKey(todayWhen) === today, "today should stay today");

  const tomorrowInAnHour = app.extractWhen("schedule a walk tomorrow in an hour", now);
  assert(
    localKey(tomorrowInAnHour) === tomorrow,
    `"tomorrow in an hour" should stay tomorrow, got ${localKey(tomorrowInAnHour)}`
  );
  assert(
    localHour(tomorrowInAnHour) === 10,
    "tonight/tomorrow/today still win over a relative offset"
  );

  assert(
    app.extractWhen("schedule a 15 minute walk", now) === null,
    "duration-only '15 minute' must not be treated as a delay from now"
  );
  assert(
    app.extractWhen("just thinking about walking", now) === null,
    "no when token → null"
  );
  assert(
    app.extractWhen("schedule a walk in 0 minutes", now) === null,
    "zero-length offsets must stay null"
  );

  assert(
    app.extractMinutes("schedule a 15 minute walk in 30 minutes") === 15,
    "'in 30 minutes' must not steal the duration from '15 minute'"
  );
  assert(
    app.extractMinutes("schedule a walk in 30 minutes") === null,
    "'in 30 minutes' is a delay, not a duration"
  );
  assert(
    app.extractActionTitle("schedule a walk in an hour") === "walk",
    'title should be "walk", not "walk in an hour"'
  );
  assert(
    app.extractActionTitle("schedule a walk 30 minutes from now") === "walk",
    'title should be "walk", not "walk 30 minutes from now"'
  );

  app.STATE.activations = [];
  const action = await app.executeIntent(
    "add_activation",
    "schedule a 10 minute walk in an hour"
  );
  assert(action && action.kind === "added_activation", "executeIntent should add an activation");
  assert(action.a.title === "walk", `title should be "walk", got ${JSON.stringify(action.a.title)}`);
  assert(action.a.duration === 10, `duration should stay 10, got ${action.a.duration}`);
  assert(action.a.scheduledFor, "scheduledFor must not be null for 'in an hour'");
  const expectedKey = localKey(action.a.scheduledFor);
  const onDay = app.activationsOnDay(new Date(action.a.scheduledFor));
  assert(
    onDay.some((a) => a.id === action.a.id),
    `activation should appear on ${expectedKey} calendar agenda`
  );

  console.log("OK extractWhen relative offsets");
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
