/**
 * Regressions: Coach create requests that name a weekday without
 * today/tonight/tomorrow must still land on that calendar day.
 *
 * extractWhen() only looked for tonight/tomorrow/today, so
 * "schedule a walk on Saturday" (also "this Monday", "next Friday")
 * persisted scheduledFor: null. Calendar marks and that day's agenda
 * then hid the step. There is no edit UI to attach a date.
 *
 * Distinct from PR #18 (display of *stored* date-only strings), PR #56
 * (tonight vs tomorrow negation), PR #59 (explicit YYYY-MM-DD), PR #60
 * (today after 23:00 overflowing to tomorrow), PR #61 (this
 * morning/afternoon/evening tokens), and PR #62 (clock times). Those
 * still leave "on Saturday" unscheduled.
 *
 * Keep explicit tonight / tomorrow / today first. "on"/"this" weekday
 * is the upcoming occurrence including today; "next" weekday skips
 * today when today already is that weekday.
 *
 * Run from repo root:
 *   node scripts/check_extract_when_weekday.js
 */

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const APP_SOURCE = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday"
];

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
      `\nthis.extractWhen = extractWhen;\nthis.extractWeekday = extractWeekday;\nthis.extractActionTitle = extractActionTitle;\nthis.executeIntent = executeIntent;\nthis.STATE = STATE;\nthis.todayKey = todayKey;\nthis.activationsOnDay = activationsOnDay;\n`,
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

function shiftKey(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function upcomingWeekdayDelta(wantDay, { skipToday = false } = {}) {
  const current = new Date().getDay();
  let delta = (wantDay - current + 7) % 7;
  if (skipToday && delta === 0) delta = 7;
  return delta;
}

async function main() {
  const app = loadApp();
  assert(typeof app.extractWhen === "function", "extractWhen must exist");
  assert(typeof app.extractWeekday === "function", "extractWeekday must exist");

  const today = shiftKey(0);
  const tomorrow = shiftKey(1);
  const satDelta = upcomingWeekdayDelta(6);
  const monDelta = upcomingWeekdayDelta(1);
  const friDelta = upcomingWeekdayDelta(5);
  const nextFriDelta = upcomingWeekdayDelta(5, { skipToday: true });
  const saturday = shiftKey(satDelta);
  const monday = shiftKey(monDelta);
  const friday = shiftKey(friDelta);
  const nextFriday = shiftKey(nextFriDelta);

  for (const text of [
    "schedule a walk on Saturday",
    "schedule a walk on saturday",
    "add a walk on Saturday",
    "plan a walk on Saturday"
  ]) {
    const when = app.extractWhen(text);
    assert(when, `extractWhen("${text}") should return a datetime, got ${when}`);
    assert(
      localKey(when) === saturday,
      `extractWhen("${text}") should be Saturday (${saturday}), got ${localKey(when)}`
    );
  }

  const thisMonday = app.extractWhen("schedule a walk this Monday");
  assert(thisMonday, 'extractWhen("this Monday") should return a datetime');
  assert(
    localKey(thisMonday) === monday,
    `"this Monday" should be ${monday}, got ${localKey(thisMonday)}`
  );

  const nextFri = app.extractWhen("schedule a walk next Friday");
  assert(nextFri, 'extractWhen("next Friday") should return a datetime');
  assert(
    localKey(nextFri) === nextFriday,
    `"next Friday" should be ${nextFriday}, got ${localKey(nextFri)}`
  );

  const onFri = app.extractWhen("schedule a walk on Friday");
  assert(onFri, 'extractWhen("on Friday") should return a datetime');
  assert(
    localKey(onFri) === friday,
    `"on Friday" should be ${friday}, got ${localKey(onFri)}`
  );

  const bareSat = app.extractWhen("schedule a walk Saturday");
  assert(bareSat, 'extractWhen("schedule a walk Saturday") should return a datetime');
  assert(
    localKey(bareSat) === saturday,
    `bare Saturday after the create verb should be ${saturday}, got ${localKey(bareSat)}`
  );

  const leading = app.extractWhen("On Saturday, schedule a walk");
  assert(leading, 'extractWhen("On Saturday, schedule a walk") should return a datetime');
  assert(
    localKey(leading) === saturday,
    `leading "On Saturday" should be ${saturday}, got ${localKey(leading)}`
  );

  const tonight = app.extractWhen("schedule a walk tonight");
  assert(tonight, 'extractWhen("tonight") should return a datetime');
  assert(localKey(tonight) === today, "tonight should stay today");

  const tom = app.extractWhen("schedule a walk tomorrow");
  assert(tom, 'extractWhen("tomorrow") should return a datetime');
  assert(localKey(tom) === tomorrow, "tomorrow should stay tomorrow");

  const todayWhen = app.extractWhen("schedule a walk today");
  assert(todayWhen, 'extractWhen("today") should return a datetime');
  assert(localKey(todayWhen) === today, "today should stay today");

  const tomorrowSat = app.extractWhen("schedule a walk tomorrow, not on Saturday");
  assert(
    localKey(tomorrowSat) === tomorrow,
    `"tomorrow, not on Saturday" should stay tomorrow, got ${localKey(tomorrowSat)}`
  );

  assert(
    app.extractWhen("just thinking about walking") === null,
    "no when token → null"
  );
  assert(
    app.extractWhen("schedule a walk") === null,
    "create request with no day token → null"
  );

  assert(
    app.extractActionTitle("schedule a walk on Saturday") === "walk",
    'title should be "walk", not "walk on Saturday"'
  );
  assert(
    app.extractActionTitle("schedule a walk this Monday") === "walk",
    'title should be "walk", not "walk this Monday"'
  );
  assert(
    app.extractActionTitle("schedule a walk next Friday") === "walk",
    'title should be "walk", not "walk next Friday"'
  );

  app.STATE.activations = [];
  const action = await app.executeIntent(
    "add_activation",
    "schedule a 15 minute walk on Saturday"
  );
  assert(action && action.kind === "added_activation", "executeIntent should add an activation");
  assert(action.a.title === "walk", `title should be "walk", got ${JSON.stringify(action.a.title)}`);
  assert(
    localKey(action.a.scheduledFor) === saturday,
    `added activation should be scheduled Saturday (${saturday}), got ${
      action.a.scheduledFor && localKey(action.a.scheduledFor)
    }`
  );

  const satDate = new Date(action.a.scheduledFor);
  const onSat = app.activationsOnDay(satDate);
  assert(
    onSat.some((a) => a.id === action.a.id),
    "Saturday's calendar agenda must include the scheduled walk"
  );
  if (satDelta !== 0) {
    const onToday = app.activationsOnDay(new Date());
    assert(
      !onToday.some((a) => a.id === action.a.id),
      "today's agenda must not show a Saturday-only walk"
    );
  }

  const exposure = await app.executeIntent(
    "add_exposure",
    "schedule an exposure to approach the store on Saturday"
  );
  assert(exposure && exposure.kind === "added_exposure", "executeIntent should add an exposure");
  assert(
    localKey(exposure.a.scheduledFor) === saturday,
    `exposure should be scheduled Saturday, got ${
      exposure.a.scheduledFor && localKey(exposure.a.scheduledFor)
    }`
  );

  void WEEKDAYS;
  console.log("OK extractWhen weekday tokens");
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
