/**
 * Regressions: "two weeks from today/tomorrow" and "a week from tonight"
 * must schedule that many local days ahead.
 *
 * extractWhen() tested /tonight/, /tomorrow/, and /today/ before the longer
 * phrase. Those tokens sit inside the phrase, so on Fri Nov 6:
 *   "schedule a walk two weeks from today" persisted Nov 6 (now + 1 hour)
 *     instead of Nov 20 at 10:00
 *   "two weeks from tomorrow" persisted Nov 7 at 10:00 instead of Nov 21
 *   "a week from tonight" persisted Nov 6 at 20:00 instead of Nov 13 at 20:00
 * Calendar marks and the day agenda then showed the step on the wrong day.
 * There is no edit UI.
 *
 * Offsets: two weeks from today → +14 at 10:00, two weeks from tomorrow →
 * +15 at 10:00, a/one/1 week from tonight → +7 at 20:00 (tonight's hour).
 *
 * A refused phrase must not win: "schedule a walk tomorrow, not two weeks
 * from today" stays tomorrow. "I can't today — schedule a walk two weeks
 * from tomorrow" stays fifteen days out.
 *
 * "next week", "in a week", "in two weeks", and "this weekend" stay
 * unscheduled. Which weekday they mean is a guess.
 *
 * Run from repo root:
 *   node scripts/check_extract_when_two_weeks.js
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
      `\nthis.extractWhen = extractWhen;\nthis.extractActionTitle = extractActionTitle;\nthis.executeIntent = executeIntent;\nthis.STATE = STATE;\nthis.todayKey = todayKey;\nthis.firstExactOffset = firstExactOffset;\n`,
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
  assert(typeof app.firstExactOffset === "function", "firstExactOffset helper must exist");

  const now = atLocal(2026, 10, 6, 15, 30); // Fri Nov 6, 2026, 15:30 local
  const today = "2026-11-06";
  const tomorrow = "2026-11-07";
  const twoFromToday = "2026-11-20";
  const twoFromTomorrow = "2026-11-21";
  const weekFromTonight = "2026-11-13";

  for (const text of [
    "schedule a walk two weeks from today",
    "plan a walk 2 weeks from today",
    "add a 10 minute walk for two weeks from today",
    "create an activation to walk two weeks from today",
    "Two weeks from today, schedule a walk"
  ]) {
    const when = app.extractWhen(text, now);
    assert(when, `extractWhen(${JSON.stringify(text)}) must return a datetime`);
    assert(
      localKey(when) === twoFromToday,
      `extractWhen(${JSON.stringify(text)}) must be ${twoFromToday}, got ${localKey(when)} from ${when}`
    );
    assert(
      localHour(when) === 10,
      `two weeks from today should be 10:00 local, got hour ${localHour(when)}`
    );
  }

  for (const text of [
    "schedule a walk two weeks from tomorrow",
    "plan a walk 2 weeks from tomorrow"
  ]) {
    const when = app.extractWhen(text, now);
    assert(
      localKey(when) === twoFromTomorrow,
      `extractWhen(${JSON.stringify(text)}) must be ${twoFromTomorrow}, got ${localKey(when)} from ${when}`
    );
    assert(localHour(when) === 10, "two weeks from tomorrow should be 10:00 local");
  }

  for (const text of [
    "schedule a walk a week from tonight",
    "plan a walk one week from tonight",
    "add a walk 1 week from tonight",
    "A week from tonight, schedule a walk"
  ]) {
    const when = app.extractWhen(text, now);
    assert(
      localKey(when) === weekFromTonight,
      `extractWhen(${JSON.stringify(text)}) must be ${weekFromTonight}, got ${localKey(when)} from ${when}`
    );
    assert(
      localHour(when) === 20,
      `a week from tonight should stay 20:00 local, got hour ${localHour(when)}`
    );
  }

  const exposureToday = app.extractWhen(
    "add an exposure to approach the store two weeks from today",
    now
  );
  assert(
    localKey(exposureToday) === twoFromToday,
    `exposure two-weeks-from-today must be ${twoFromToday}, got ${localKey(exposureToday)}`
  );
  const exposureTonight = app.extractWhen(
    "add an exposure to approach the store a week from tonight",
    now
  );
  assert(
    localKey(exposureTonight) === weekFromTonight && localHour(exposureTonight) === 20,
    `exposure week-from-tonight must be ${weekFromTonight} at 20:00, got ${exposureTonight}`
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

  assert(app.extractWhen("schedule a walk next week", now) == null, "next week must stay unscheduled");
  assert(app.extractWhen("schedule a walk in a week", now) == null, "in a week must stay unscheduled");
  assert(app.extractWhen("schedule a walk in two weeks", now) == null, "in two weeks must stay unscheduled");
  assert(app.extractWhen("schedule a walk this weekend", now) == null, "this weekend must stay unscheduled");

  const refusedToday = app.extractWhen(
    "schedule a walk tomorrow, not two weeks from today",
    now
  );
  assert(
    localKey(refusedToday) === tomorrow,
    `negated two-weeks-from-today must stay tomorrow, got ${localKey(refusedToday)}`
  );
  const refusedTonight = app.extractWhen(
    "schedule a walk tonight, not a week from tonight",
    now
  );
  assert(
    localKey(refusedTonight) === today && localHour(refusedTonight) === 20,
    `negated week-from-tonight must stay tonight, got ${refusedTonight}`
  );
  const refusedCurly = app.extractWhen(
    "schedule a walk tomorrow. I can\u2019t do it two weeks from today",
    now
  );
  assert(
    localKey(refusedCurly) === tomorrow,
    `curly-apostrophe can't-do must stay tomorrow, got ${localKey(refusedCurly)}`
  );

  const cantToday = app.extractWhen(
    "I can't today — schedule a walk two weeks from tomorrow",
    now
  );
  assert(
    localKey(cantToday) === twoFromTomorrow,
    `can't today + two weeks from tomorrow must be ${twoFromTomorrow}, got ${localKey(cantToday)}`
  );
  const cantTomorrow = app.extractWhen(
    "I can't tomorrow — schedule a walk two weeks from today",
    now
  );
  assert(
    localKey(cantTomorrow) === twoFromToday,
    `can't tomorrow + two weeks from today must be ${twoFromToday}, got ${localKey(cantTomorrow)}`
  );
  const cantTonight = app.extractWhen(
    "I can't tonight, schedule a walk a week from tonight",
    now
  );
  assert(
    localKey(cantTonight) === weekFromTonight && localHour(cantTonight) === 20,
    `can't tonight + a week from tonight must be ${weekFromTonight} at 20:00, got ${cantTonight}`
  );

  const onlyNegated = app.extractWhen("schedule a walk, not two weeks from today", now);
  assert(
    onlyNegated == null,
    `a refused two-weeks phrase with no other day must stay unscheduled, got ${onlyNegated}`
  );
  const onlyNegatedTonight = app.extractWhen("schedule a walk, not a week from tonight", now);
  assert(
    onlyNegatedTonight == null,
    `a refused week-from-tonight with no other day must stay unscheduled, got ${onlyNegatedTonight}`
  );

  const firstOfTwo = app.extractWhen(
    "not two weeks from today. schedule a walk a week from tonight",
    now
  );
  assert(
    localKey(firstOfTwo) === weekFromTonight && localHour(firstOfTwo) === 20,
    `a later positive week-from-tonight must win, got ${firstOfTwo}`
  );
  const laterTwoWeeks = app.extractWhen(
    "not a week from tonight. schedule a walk two weeks from today",
    now
  );
  assert(
    localKey(laterTwoWeeks) === twoFromToday,
    `a later positive two-weeks must win, got ${localKey(laterTwoWeeks)}`
  );

  const monthEnd = atLocal(2026, 10, 30, 9, 0); // Nov 30
  assert(
    localKey(app.extractWhen("schedule a walk two weeks from today", monthEnd)) === "2026-12-14",
    "Nov 30 + 14 days must be Dec 14"
  );
  assert(
    localKey(app.extractWhen("schedule a walk two weeks from tomorrow", monthEnd)) === "2026-12-15",
    "Nov 30 + 15 days must be Dec 15"
  );
  assert(
    localKey(app.extractWhen("schedule a walk a week from tonight", monthEnd)) === "2026-12-07" &&
      localHour(app.extractWhen("schedule a walk a week from tonight", monthEnd)) === 20,
    "Nov 30 + 7 nights must be Dec 7 at 20:00"
  );
  assert(
    localKey(app.extractWhen("schedule a walk two weeks from today", atLocal(2026, 0, 31, 8, 0))) ===
      "2026-02-14",
    "Jan 31 + 14 days must be Feb 14"
  );

  assert(
    app.extractActionTitle("schedule a walk two weeks from today") === "walk",
    `title must stay walk, got ${JSON.stringify(app.extractActionTitle("schedule a walk two weeks from today"))}`
  );
  assert(
    app.extractActionTitle("schedule a walk 2 weeks from tomorrow") === "walk",
    "digit two-weeks phrase must drop out of the title"
  );
  assert(
    app.extractActionTitle("schedule a walk a week from tonight") === "walk",
    "week-from-tonight must drop out of the title"
  );
  assert(
    app.extractActionTitle("add an exposure to approach the store two weeks from today") ===
      "approach the store",
    "exposure title must keep the target and drop the two-weeks phrase"
  );
  assert(
    app.extractActionTitle("schedule a walk today") === "walk today",
    "bare today titles stay unchanged"
  );
  assert(
    app.extractActionTitle("schedule a walk tonight") === "walk tonight",
    "bare tonight titles stay unchanged"
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
      "add a 10 minute walk two weeks from today"
    );
    assert(action && action.kind === "added_activation", "executeIntent must persist an activation");
    assert(
      localKey(action.a.scheduledFor) === twoFromToday,
      `persisted local day must be ${twoFromToday}, got ${localKey(action.a.scheduledFor)}`
    );
    assert(
      app.todayKey(new RealDate(action.a.scheduledFor)) === twoFromToday,
      "todayKey of scheduledFor must match the requested local day (calendar marks/agenda)"
    );
    assert(action.a.title === "walk", `persisted title must be walk, got ${JSON.stringify(action.a.title)}`);
    assert(action.a.duration === 10, `duration must stay 10, got ${action.a.duration}`);
    assert(
      app.STATE.activations.some((a) => a.title === "walk" && localKey(a.scheduledFor) === twoFromToday),
      "STATE.activations must contain the two-weeks-from-today walk"
    );

    const later = await app.executeIntent(
      "add_activation",
      "schedule a walk two weeks from tomorrow"
    );
    assert(
      localKey(later.a.scheduledFor) === twoFromTomorrow,
      `persisted two-weeks-from-tomorrow must be ${twoFromTomorrow}, got ${localKey(later.a.scheduledFor)}`
    );

    const tonightWalk = await app.executeIntent(
      "add_activation",
      "schedule a walk a week from tonight"
    );
    assert(
      localKey(tonightWalk.a.scheduledFor) === weekFromTonight &&
        localHour(tonightWalk.a.scheduledFor) === 20,
      `persisted week-from-tonight must be ${weekFromTonight} at 20:00, got ${tonightWalk.a.scheduledFor}`
    );
    assert(tonightWalk.a.title === "walk", "week-from-tonight title must stay walk");

    const exposure = await app.executeIntent(
      "add_exposure",
      "add an exposure to approach the store two weeks from tomorrow"
    );
    assert(exposure && exposure.kind === "added_exposure", "exposure create must persist");
    assert(
      localKey(exposure.a.scheduledFor) === twoFromTomorrow,
      `persisted exposure day must be ${twoFromTomorrow}, got ${localKey(exposure.a.scheduledFor)}`
    );
    assert(
      exposure.a.title === "approach the store",
      `exposure title must drop the two-weeks phrase, got ${JSON.stringify(exposure.a.title)}`
    );
  } finally {
    app.Date = RealDate;
  }

  const bundle = fs.readFileSync(path.join(ROOT, "dist", "BreakFree.html"), "utf8");
  assert(
    bundle.includes("function firstExactOffset"),
    "dist/BreakFree.html must include the two-weeks / week-from-tonight guard"
  );

  console.log("OK extractWhen two-weeks and week-from-tonight checks passed");
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
