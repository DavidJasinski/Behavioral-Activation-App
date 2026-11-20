/**
 * Regression: "fifteen weeks from tonight/today/tomorrow" must schedule the
 * named offset, not the shorter token inside the phrase.
 *
 * extractWhen() tested /tonight/, then /tomorrow/, then /today/. Each token
 * sits inside the longer phrase, so on Fri Nov 20:
 *   "schedule a walk fifteen weeks from tonight" persisted Nov 20 at 20:00
 *     instead of Mar 5 at 20:00
 *   "schedule a walk fifteen weeks from today" persisted Nov 20 (now + 1 hour)
 *     instead of Mar 5 at 10:00
 *   "schedule a walk fifteen weeks from tomorrow" persisted Nov 21 at 10:00
 *     instead of Mar 6 at 10:00
 * Calendar marks and that day's agenda then showed the step on the wrong
 * day. There is no edit UI. The same miss hit exposures.
 *
 * Offsets:
 *   fifteen/15 weeks from tonight  → +105 local days at 20:00
 *   fifteen/15 weeks from today    → +105 local days at 10:00
 *   fifteen/15 weeks from tomorrow → +106 local days at 10:00
 *
 * A refused phrase must not win: "schedule a walk tonight, not fifteen weeks
 * from tonight" stays tonight. "I can't tonight — schedule a walk fifteen
 * weeks from tonight" stays one hundred five nights out.
 *
 * "next week", "in fifteen weeks", "in fourteen weeks", and "this weekend"
 * stay unscheduled. "fourteen weeks from …" stays on the shorter token (its
 * own draft).
 *
 * Run from repo root:
 *   node scripts/check_extract_when_fifteen_weeks.js
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
      `\nthis.extractWhen = extractWhen;\nthis.extractActionTitle = extractActionTitle;\nthis.executeIntent = executeIntent;\nthis.STATE = STATE;\nthis.todayKey = todayKey;\nthis.firstFifteenWeeksOffset = firstFifteenWeeksOffset;\n`,
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

function expectWhen(app, text, now, key, hour) {
  const when = app.extractWhen(text, now);
  assert(when, `extractWhen(${JSON.stringify(text)}) must return a datetime`);
  assert(
    localKey(when) === key,
    `extractWhen(${JSON.stringify(text)}) must be ${key}, got ${localKey(when)} from ${when}`
  );
  assert(
    localHour(when) === hour,
    `extractWhen(${JSON.stringify(text)}) must be ${hour}:00 local, got hour ${localHour(when)}`
  );
}

async function main() {
  const app = loadApp();
  assert(typeof app.extractWhen === "function", "extractWhen must exist");
  assert(
    typeof app.firstFifteenWeeksOffset === "function",
    "firstFifteenWeeksOffset helper must exist"
  );

  const now = atLocal(2026, 10, 20, 15, 30); // Fri Nov 20, 2026, 15:30 local
  const today = "2026-11-20";
  const tomorrow = "2026-11-21";
  const fifteenFromTonight = "2027-03-05";
  const fifteenFromToday = "2027-03-05";
  const fifteenFromTomorrow = "2027-03-06";

  for (const text of [
    "schedule a walk fifteen weeks from tonight",
    "plan a walk 15 weeks from tonight",
    "add a 10 minute walk for fifteen weeks from tonight",
    "create an activation to walk fifteen weeks from tonight",
    "Fifteen weeks from tonight, schedule a walk",
    "schedule a walk in fifteen weeks from tonight",
    "FIFTEEN WEEKS FROM TONIGHT schedule a walk"
  ]) {
    expectWhen(app, text, now, fifteenFromTonight, 20);
    assert(
      app.firstFifteenWeeksOffset(text)?.anchor === "tonight",
      `positive tonight phrase must be recognized: ${text}`
    );
  }

  for (const text of [
    "schedule a walk fifteen weeks from today",
    "plan a walk 15 weeks from today",
    "add a 10 minute walk for fifteen weeks from today"
  ]) {
    expectWhen(app, text, now, fifteenFromToday, 10);
    assert(
      app.firstFifteenWeeksOffset(text)?.anchor === "today",
      `positive today phrase must be recognized: ${text}`
    );
  }

  for (const text of [
    "schedule a walk fifteen weeks from tomorrow",
    "plan a walk 15 weeks from tomorrow",
    "create an activation to walk fifteen weeks from tomorrow"
  ]) {
    expectWhen(app, text, now, fifteenFromTomorrow, 10);
    assert(
      app.firstFifteenWeeksOffset(text)?.anchor === "tomorrow",
      `positive tomorrow phrase must be recognized: ${text}`
    );
  }

  const exposureTonight = app.extractWhen(
    "add an exposure to approach the store fifteen weeks from tonight",
    now
  );
  assert(
    localKey(exposureTonight) === fifteenFromTonight && localHour(exposureTonight) === 20,
    `exposure fifteen-weeks-from-tonight must be ${fifteenFromTonight} at 20:00, got ${exposureTonight}`
  );
  const exposureToday = app.extractWhen(
    "add an exposure to approach the store fifteen weeks from today",
    now
  );
  assert(
    localKey(exposureToday) === fifteenFromToday && localHour(exposureToday) === 10,
    `exposure fifteen-weeks-from-today must be ${fifteenFromToday} at 10:00, got ${exposureToday}`
  );
  const exposureTomorrow = app.extractWhen(
    "add an exposure to approach the store fifteen weeks from tomorrow",
    now
  );
  assert(
    localKey(exposureTomorrow) === fifteenFromTomorrow && localHour(exposureTomorrow) === 10,
    `exposure fifteen-weeks-from-tomorrow must be ${fifteenFromTomorrow} at 10:00, got ${exposureTomorrow}`
  );

  const tonight = app.extractWhen("schedule a walk tonight", now);
  assert(localKey(tonight) === today && localHour(tonight) === 20, "tonight stays today at 20:00");
  assert(
    localKey(app.extractWhen("schedule a walk tomorrow", now)) === tomorrow,
    "bare tomorrow must stay one day ahead"
  );
  assert(
    localHour(app.extractWhen("schedule a walk tomorrow", now)) === 10,
    "bare tomorrow stays 10:00 local"
  );
  const todayWhen = app.extractWhen("schedule a walk today", now);
  assert(
    localKey(todayWhen) === today && localHour(todayWhen) === 16,
    "mid-afternoon today stays today at +1 hour"
  );

  assert(app.extractWhen("schedule a walk next week", now) == null, "next week must stay unscheduled");
  assert(
    app.extractWhen("schedule a walk in fifteen weeks", now) == null,
    "in fifteen weeks must stay unscheduled"
  );
  assert(
    app.extractWhen("schedule a walk in fourteen weeks", now) == null,
    "in fourteen weeks must stay unscheduled"
  );
  assert(app.extractWhen("schedule a walk this weekend", now) == null, "this weekend must stay unscheduled");
  assert(
    app.firstFifteenWeeksOffset("schedule a walk in fifteen weeks") == null,
    "in fifteen weeks is not an exact fifteen-weeks-from anchor"
  );
  assert(
    app.firstFifteenWeeksOffset("schedule a walk fourteen weeks from tonight") == null,
    "fourteen weeks from tonight is not this offset"
  );
  assert(
    app.firstFifteenWeeksOffset("schedule a walk sixteen weeks from tonight") == null,
    "sixteen weeks from tonight is not this offset"
  );
  assert(
    app.firstFifteenWeeksOffset("schedule a walk 16 weeks from tonight") == null,
    "16 weeks from tonight is not this offset"
  );
  assert(
    app.firstFifteenWeeksOffset("schedule a walk 115 weeks from tonight") == null,
    "115 weeks from tonight is not this offset"
  );
  assert(
    localKey(app.extractWhen("schedule a walk fourteen weeks from tonight", now)) === today &&
      localHour(app.extractWhen("schedule a walk fourteen weeks from tonight", now)) === 20,
    "fourteen weeks from tonight stays on the shorter tonight token"
  );
  assert(
    localKey(app.extractWhen("schedule a walk sixteen weeks from tonight", now)) === today &&
      localHour(app.extractWhen("schedule a walk sixteen weeks from tonight", now)) === 20,
    "sixteen weeks from tonight stays on the shorter tonight token"
  );
  assert(
    localKey(app.extractWhen("schedule a walk 115 weeks from tonight", now)) === today &&
      localHour(app.extractWhen("schedule a walk 115 weeks from tonight", now)) === 20,
    "115 weeks from tonight stays on the shorter tonight token"
  );

  const refusedTonight = app.extractWhen(
    "schedule a walk tonight, not fifteen weeks from tonight",
    now
  );
  assert(
    localKey(refusedTonight) === today && localHour(refusedTonight) === 20,
    `negated fifteen-weeks-from-tonight must stay tonight, got ${refusedTonight}`
  );
  const refusedToday = app.extractWhen(
    "schedule a walk today, not fifteen weeks from today",
    now
  );
  assert(
    localKey(refusedToday) === today && localHour(refusedToday) === 16,
    `negated fifteen-weeks-from-today must stay today, got ${refusedToday}`
  );
  const refusedTomorrow = app.extractWhen(
    "schedule a walk tomorrow, not fifteen weeks from tomorrow",
    now
  );
  assert(
    localKey(refusedTomorrow) === tomorrow && localHour(refusedTomorrow) === 10,
    `negated fifteen-weeks-from-tomorrow must stay tomorrow, got ${refusedTomorrow}`
  );
  const refusedOtherNight = app.extractWhen(
    "schedule a walk tomorrow, not fifteen weeks from tonight",
    now
  );
  assert(
    localKey(refusedOtherNight) === tomorrow && localHour(refusedOtherNight) === 10,
    `negated phrase must not steal tomorrow, got ${refusedOtherNight}`
  );
  const refusedCurly = app.extractWhen(
    "schedule a walk tonight. I can\u2019t do it fifteen weeks from tonight",
    now
  );
  assert(
    localKey(refusedCurly) === today && localHour(refusedCurly) === 20,
    `curly-apostrophe can't-do must stay tonight, got ${refusedCurly}`
  );
  assert(
    app.firstFifteenWeeksOffset("I can\u2019t fifteen weeks from tonight") == null,
    "curly-apostrophe can't immediately before the phrase is a refusal"
  );
  assert(
    app.firstFifteenWeeksOffset("not 15 weeks from today") == null,
    "digit refusal must not count as a request"
  );

  const cantTonight = app.extractWhen(
    "I can't tonight — schedule a walk fifteen weeks from tonight",
    now
  );
  assert(
    localKey(cantTonight) === fifteenFromTonight && localHour(cantTonight) === 20,
    `can't tonight + fifteen weeks from tonight must be ${fifteenFromTonight} at 20:00, got ${cantTonight}`
  );
  const cantToday = app.extractWhen(
    "I can't today — schedule a walk fifteen weeks from today",
    now
  );
  assert(
    localKey(cantToday) === fifteenFromToday && localHour(cantToday) === 10,
    `can't today + fifteen weeks from today must be ${fifteenFromToday} at 10:00, got ${cantToday}`
  );
  const cantTomorrow = app.extractWhen(
    "I can't tomorrow — schedule a walk fifteen weeks from tomorrow",
    now
  );
  assert(
    localKey(cantTomorrow) === fifteenFromTomorrow && localHour(cantTomorrow) === 10,
    `can't tomorrow + fifteen weeks from tomorrow must be ${fifteenFromTomorrow} at 10:00, got ${cantTomorrow}`
  );

  const onlyNegated = app.extractWhen("schedule a walk, not fifteen weeks from tonight", now);
  assert(
    onlyNegated == null,
    `a refused fifteen-weeks phrase with no other day must stay unscheduled, got ${onlyNegated}`
  );

  const laterPositive = app.extractWhen(
    "not fifteen weeks from tonight. schedule a walk fifteen weeks from tomorrow",
    now
  );
  assert(
    localKey(laterPositive) === fifteenFromTomorrow && localHour(laterPositive) === 10,
    `a later positive phrase must win, got ${laterPositive}`
  );
  assert(
    app.firstFifteenWeeksOffset(
      "schedule a walk fifteen weeks from today, not fifteen weeks from tomorrow"
    )?.anchor === "today",
    "the first positive anchor wins when a later one is refused"
  );

  const late = atLocal(2026, 10, 20, 23, 30);
  expectWhen(app, "schedule a walk fifteen weeks from today", late, fifteenFromToday, 10);
  expectWhen(app, "schedule a walk fifteen weeks from tonight", late, fifteenFromTonight, 20);

  const monthEnd = atLocal(2026, 11, 31, 21, 0); // Thu Dec 31, after 20:00
  expectWhen(app, "schedule a walk fifteen weeks from tonight", monthEnd, "2027-04-15", 20);
  expectWhen(app, "schedule a walk fifteen weeks from tomorrow", monthEnd, "2027-04-16", 10);
  assert(
    localKey(app.extractWhen("schedule a walk 15 weeks from today", atLocal(2027, 0, 31, 8, 0))) ===
      "2027-05-16",
    "Jan 31 + 105 days must be May 16"
  );
  assert(
    localKey(app.extractWhen("schedule a walk 15 weeks from tomorrow", atLocal(2027, 0, 31, 8, 0))) ===
      "2027-05-17",
    "Jan 31 + 106 days must be May 17"
  );

  assert(
    app.extractActionTitle("schedule a walk fifteen weeks from tonight") === "walk",
    `title must stay walk, got ${JSON.stringify(app.extractActionTitle("schedule a walk fifteen weeks from tonight"))}`
  );
  assert(
    app.extractActionTitle("schedule a walk 15 weeks from today") === "walk",
    "digit fifteen-weeks phrase must drop out of the title"
  );
  assert(
    app.extractActionTitle("schedule a walk fifteen weeks from tomorrow") === "walk",
    "tomorrow phrase must drop out of the title"
  );
  assert(
    app.extractActionTitle("add an exposure to approach the store fifteen weeks from tonight") ===
      "approach the store",
    "exposure title must keep the target and drop the fifteen-weeks phrase"
  );
  assert(
    app.extractActionTitle("schedule a walk tonight") === "walk tonight",
    "bare tonight titles stay unchanged"
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
      "add a 10 minute walk fifteen weeks from tonight"
    );
    assert(action && action.kind === "added_activation", "executeIntent must persist an activation");
    assert(
      localKey(action.a.scheduledFor) === fifteenFromTonight,
      `persisted local day must be ${fifteenFromTonight}, got ${localKey(action.a.scheduledFor)}`
    );
    assert(
      app.todayKey(new RealDate(action.a.scheduledFor)) === fifteenFromTonight,
      "todayKey of scheduledFor must match the requested local day (calendar marks/agenda)"
    );
    assert(localHour(action.a.scheduledFor) === 20, "persisted hour must stay 20:00 local");
    assert(action.a.title === "walk", `persisted title must be walk, got ${JSON.stringify(action.a.title)}`);
    assert(action.a.duration === 10, `duration must stay 10, got ${action.a.duration}`);
    assert(
      app.STATE.activations.some(
        (a) => a.title === "walk" && localKey(a.scheduledFor) === fifteenFromTonight
      ),
      "STATE.activations must contain the fifteen-weeks-from-tonight walk"
    );

    const todayAction = await app.executeIntent(
      "add_activation",
      "schedule a walk fifteen weeks from today"
    );
    assert(
      localKey(todayAction.a.scheduledFor) === fifteenFromToday &&
        localHour(todayAction.a.scheduledFor) === 10 &&
        todayAction.a.title === "walk",
      `persisted today-offset walk must be ${fifteenFromToday} at 10:00 titled walk, got ${todayAction.a.scheduledFor} ${todayAction.a.title}`
    );

    const tomorrowAction = await app.executeIntent(
      "add_activation",
      "schedule a walk fifteen weeks from tomorrow"
    );
    assert(
      localKey(tomorrowAction.a.scheduledFor) === fifteenFromTomorrow &&
        localHour(tomorrowAction.a.scheduledFor) === 10 &&
        tomorrowAction.a.title === "walk",
      `persisted tomorrow-offset walk must be ${fifteenFromTomorrow} at 10:00 titled walk, got ${tomorrowAction.a.scheduledFor} ${tomorrowAction.a.title}`
    );

    const exposure = await app.executeIntent(
      "add_exposure",
      "add an exposure to approach the store fifteen weeks from today"
    );
    assert(exposure && exposure.kind === "added_exposure", "exposure create must persist");
    assert(
      localKey(exposure.a.scheduledFor) === fifteenFromToday &&
        localHour(exposure.a.scheduledFor) === 10,
      `persisted exposure must be ${fifteenFromToday} at 10:00, got ${exposure.a.scheduledFor}`
    );
    assert(
      exposure.a.title === "approach the store",
      `exposure title must drop the phrase, got ${JSON.stringify(exposure.a.title)}`
    );
    assert(exposure.a.modality === "ivex", "exposure modality must stay ivex");
  } finally {
    app.Date = RealDate;
  }

  const bundle = fs.readFileSync(path.join(ROOT, "dist", "BreakFree.html"), "utf8");
  assert(
    bundle.includes("function firstFifteenWeeksOffset"),
    "dist/BreakFree.html must include the fifteen-weeks-from-anchor guard"
  );

  console.log("OK extractWhen fifteen-weeks-from-anchor checks passed");
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
