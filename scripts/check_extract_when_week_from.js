/**
 * Regressions: "a week from today/tomorrow" must schedule that many local days ahead.
 *
 * extractWhen() tested /today/ and /tomorrow/ before the longer phrase. Those
 * tokens sit inside "a week from today" and "a week from tomorrow", so
 * "schedule a walk a week from today" persisted today (now + 1 hour) and
 * "a week from tomorrow" persisted tomorrow at 10:00. Calendar marks and the
 * day agenda then showed the step on the wrong day. There is no edit UI.
 *
 * The offset is the named anchor plus seven days: today → +7, tomorrow → +8,
 * both at 10:00 local (the same default as a bare "tomorrow").
 *
 * A refused week-from must not win: "schedule a walk tomorrow, not a week
 * from today" stays tomorrow. "I can't today — schedule a walk a week from
 * tomorrow" stays eight days out.
 *
 * "next week" stays unscheduled. Which weekday it means is a guess.
 *
 * Run from repo root:
 *   node scripts/check_extract_when_week_from.js
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
      `\nthis.extractWhen = extractWhen;\nthis.extractActionTitle = extractActionTitle;\nthis.executeIntent = executeIntent;\nthis.STATE = STATE;\nthis.todayKey = todayKey;\nthis.requestsWeekFromAnchor = requestsWeekFromAnchor;\n`,
    sandbox
  );
  return sandbox;
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function localKey(isoOrDate) {
  const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function localHour(iso) {
  return new Date(iso).getHours();
}

function atLocal(y, mo, day, h, min) {
  return new Date(y, mo, day, h, min, 0, 0);
}

async function main() {
  const app = loadApp();
  assert(typeof app.extractWhen === "function", "extractWhen must exist");
  assert(
    typeof app.requestsWeekFromAnchor === "function",
    "requestsWeekFromAnchor helper must exist"
  );

  const now = atLocal(2026, 10, 4, 15, 30); // Wed Nov 4, 2026, 15:30 local
  const today = "2026-11-04";
  const tomorrow = "2026-11-05";
  const weekFromToday = "2026-11-11";
  const weekFromTomorrow = "2026-11-12";

  for (const text of [
    "schedule a walk a week from today",
    "plan a walk one week from today",
    "add a 10 minute walk for 1 week from today",
    "create an activation to walk a week from today",
    "A week from today, schedule a walk"
  ]) {
    const when = app.extractWhen(text, now);
    assert(when, `extractWhen(${JSON.stringify(text)}) must return a datetime`);
    assert(
      localKey(when) === weekFromToday,
      `extractWhen(${JSON.stringify(text)}) must be ${weekFromToday}, got ${localKey(when)} from ${when}`
    );
    assert(
      localHour(when) === 10,
      `a week from today should be 10:00 local, got hour ${localHour(when)}`
    );
  }

  for (const text of [
    "schedule a walk a week from tomorrow",
    "plan a walk one week from tomorrow",
    "add a walk 1 week from tomorrow"
  ]) {
    const when = app.extractWhen(text, now);
    assert(
      localKey(when) === weekFromTomorrow,
      `extractWhen(${JSON.stringify(text)}) must be ${weekFromTomorrow}, got ${localKey(when)} from ${when}`
    );
    assert(localHour(when) === 10, "a week from tomorrow should be 10:00 local");
  }

  const exposureWhen = app.extractWhen(
    "add an exposure to approach the store a week from today",
    now
  );
  assert(
    localKey(exposureWhen) === weekFromToday,
    `exposure week-from-today must be ${weekFromToday}, got ${localKey(exposureWhen)}`
  );
  const exposureTomorrow = app.extractWhen(
    "add an exposure to approach the store a week from tomorrow",
    now
  );
  assert(
    localKey(exposureTomorrow) === weekFromTomorrow,
    `exposure week-from-tomorrow must be ${weekFromTomorrow}, got ${localKey(exposureTomorrow)}`
  );

  assert(
    localKey(app.extractWhen("schedule a walk tomorrow", now)) === tomorrow,
    "bare tomorrow must stay one day ahead"
  );
  assert(
    localHour(app.extractWhen("schedule a walk tomorrow", now)) === 10,
    "bare tomorrow stays 10:00 local"
  );
  const tonight = app.extractWhen("schedule a walk tonight", now);
  assert(localKey(tonight) === today && localHour(tonight) === 20, "tonight stays today at 20:00");
  const todayWhen = app.extractWhen("schedule a walk today", now);
  assert(
    localKey(todayWhen) === today && localHour(todayWhen) === 16,
    "mid-afternoon today stays today at +1 hour"
  );

  assert(
    app.extractWhen("schedule a walk next week", now) == null,
    "next week must stay unscheduled"
  );
  assert(
    app.extractWhen("schedule a walk in a week", now) == null,
    "in a week must stay unscheduled"
  );
  assert(
    app.extractWhen("schedule a walk this weekend", now) == null,
    "this weekend must stay unscheduled"
  );

  const refusedToday = app.extractWhen(
    "schedule a walk tomorrow, not a week from today",
    now
  );
  assert(
    localKey(refusedToday) === tomorrow,
    `negated week-from-today must stay tomorrow, got ${localKey(refusedToday)}`
  );
  const refusedTomorrow = app.extractWhen(
    "schedule a walk today, not a week from tomorrow",
    now
  );
  assert(
    localKey(refusedTomorrow) === today && localHour(refusedTomorrow) === 16,
    `negated week-from-tomorrow must stay today, got ${refusedTomorrow}`
  );
  const refusedCurly = app.extractWhen(
    "schedule a walk tomorrow. I can\u2019t do it a week from today",
    now
  );
  assert(
    localKey(refusedCurly) === tomorrow,
    `curly-apostrophe can't-do must stay tomorrow, got ${localKey(refusedCurly)}`
  );

  const cantToday = app.extractWhen(
    "I can't today — schedule a walk a week from tomorrow",
    now
  );
  assert(
    localKey(cantToday) === weekFromTomorrow,
    `can't today + week from tomorrow must be ${weekFromTomorrow}, got ${localKey(cantToday)}`
  );
  const cantTomorrow = app.extractWhen(
    "I can't tomorrow — schedule a walk a week from today",
    now
  );
  assert(
    localKey(cantTomorrow) === weekFromToday,
    `can't tomorrow + week from today must be ${weekFromToday}, got ${localKey(cantTomorrow)}`
  );
  const cantTonight = app.extractWhen(
    "I can't tonight, schedule a walk a week from today",
    now
  );
  assert(
    localKey(cantTonight) === weekFromToday,
    `can't tonight + week from today must be ${weekFromToday}, got ${localKey(cantTonight)}`
  );

  const onlyNegated = app.extractWhen("schedule a walk, not a week from today", now);
  assert(
    onlyNegated == null,
    `a refused week-from with no other day must stay unscheduled, got ${onlyNegated}`
  );

  const firstOfTwo = app.extractWhen(
    "not a week from today. schedule a walk a week from tomorrow",
    now
  );
  assert(
    localKey(firstOfTwo) === weekFromTomorrow,
    `a later positive week-from must win, got ${localKey(firstOfTwo)}`
  );

  const monthEnd = atLocal(2026, 10, 30, 9, 0); // Nov 30
  assert(
    localKey(app.extractWhen("schedule a walk a week from today", monthEnd)) === "2026-12-07",
    "Nov 30 + 7 days must be Dec 7"
  );
  assert(
    localKey(app.extractWhen("schedule a walk a week from tomorrow", monthEnd)) === "2026-12-08",
    "Nov 30 + 8 days must be Dec 8"
  );
  assert(
    localKey(app.extractWhen("schedule a walk a week from today", atLocal(2026, 0, 31, 8, 0))) ===
      "2026-02-07",
    "Jan 31 + 7 days must be Feb 7"
  );

  assert(
    app.extractActionTitle("schedule a walk a week from today") === "walk",
    `title must stay walk, got ${JSON.stringify(app.extractActionTitle("schedule a walk a week from today"))}`
  );
  assert(
    app.extractActionTitle("schedule a walk a week from tomorrow") === "walk",
    "tomorrow week phrase must drop out of the title"
  );
  assert(
    app.extractActionTitle("add an exposure to approach the store a week from today") ===
      "approach the store",
    "exposure title must keep the target and drop the week phrase"
  );
  assert(
    app.extractActionTitle("schedule a walk today") === "walk today",
    "bare today titles stay unchanged"
  );
  assert(
    app.extractActionTitle("schedule a walk tomorrow") === "walk tomorrow",
    "bare tomorrow titles stay unchanged"
  );

  const RealDate = app.Date;
  const t = now.getTime();
  function MockDate(...args) {
    if (args.length === 0) return new RealDate(t);
    return new RealDate(...args);
  }
  MockDate.now = () => t;
  MockDate.parse = RealDate.parse;
  MockDate.UTC = RealDate.UTC;
  app.Date = MockDate;
  try {
    app.STATE.activations = [];
    const action = await app.executeIntent(
      "add_activation",
      "add a 10 minute walk a week from today"
    );
    assert(action && action.kind === "added_activation", "executeIntent must persist an activation");
    assert(
      localKey(action.a.scheduledFor) === weekFromToday,
      `persisted local day must be ${weekFromToday}, got ${localKey(action.a.scheduledFor)}`
    );
    assert(
      app.todayKey(new RealDate(action.a.scheduledFor)) === weekFromToday,
      "todayKey of scheduledFor must match the requested local day (calendar marks/agenda)"
    );
    assert(action.a.title === "walk", `persisted title must be walk, got ${JSON.stringify(action.a.title)}`);
    assert(action.a.duration === 10, `duration must stay 10, got ${action.a.duration}`);
    assert(
      app.STATE.activations.some((a) => a.title === "walk" && localKey(a.scheduledFor) === weekFromToday),
      "STATE.activations must contain the week-from-today walk"
    );

    const later = await app.executeIntent(
      "add_activation",
      "schedule a walk a week from tomorrow"
    );
    assert(
      localKey(later.a.scheduledFor) === weekFromTomorrow,
      `persisted week-from-tomorrow must be ${weekFromTomorrow}, got ${localKey(later.a.scheduledFor)}`
    );

    const exposure = await app.executeIntent(
      "add_exposure",
      "add an exposure to approach the store a week from tomorrow"
    );
    assert(exposure && exposure.kind === "added_exposure", "exposure create must persist");
    assert(
      localKey(exposure.a.scheduledFor) === weekFromTomorrow,
      `persisted exposure day must be ${weekFromTomorrow}, got ${localKey(exposure.a.scheduledFor)}`
    );
    assert(
      exposure.a.title === "approach the store",
      `exposure title must drop the week phrase, got ${JSON.stringify(exposure.a.title)}`
    );
  } finally {
    app.Date = RealDate;
  }

  const bundle = fs.readFileSync(path.join(ROOT, "dist", "BreakFree.html"), "utf8");
  assert(
    bundle.includes("function requestsWeekFromAnchor"),
    "dist/BreakFree.html must include the week-from guard"
  );

  console.log("OK extractWhen week-from checks passed");
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
