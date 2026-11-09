/**
 * Regression: "four weeks from tonight/today/tomorrow" must schedule the
 * named offset, not the shorter token inside the phrase.
 *
 * extractWhen() tested /tonight/, then /tomorrow/, then /today/. Each token
 * sits inside the longer phrase, so on Mon Nov 9:
 *   "schedule a walk four weeks from tonight" persisted Nov 9 at 20:00
 *     instead of Dec 7 at 20:00
 *   "schedule a walk four weeks from today" persisted Nov 9 (now + 1 hour)
 *     instead of Dec 7 at 10:00
 *   "schedule a walk four weeks from tomorrow" persisted Nov 10 at 10:00
 *     instead of Dec 8 at 10:00
 * Calendar marks and that day's agenda then showed the step on the wrong
 * day. There is no edit UI. The same miss hit exposures.
 *
 * Offsets:
 *   four/4 weeks from tonight  → +28 local days at 20:00
 *   four/4 weeks from today    → +28 local days at 10:00
 *   four/4 weeks from tomorrow → +29 local days at 10:00
 *
 * A refused phrase must not win: "schedule a walk tonight, not four weeks
 * from tonight" stays tonight. "I can't tonight — schedule a walk four
 * weeks from tonight" stays twenty-eight nights out.
 *
 * "next week", "in four weeks", and "this weekend" stay unscheduled.
 *
 * Run from repo root:
 *   node scripts/check_extract_when_four_weeks.js
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
      `\nthis.extractWhen = extractWhen;\nthis.extractActionTitle = extractActionTitle;\nthis.executeIntent = executeIntent;\nthis.STATE = STATE;\nthis.todayKey = todayKey;\nthis.firstFourWeeksOffset = firstFourWeeksOffset;\n`,
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
    typeof app.firstFourWeeksOffset === "function",
    "firstFourWeeksOffset helper must exist"
  );

  const now = atLocal(2026, 10, 9, 15, 30); // Mon Nov 9, 2026, 15:30 local
  const today = "2026-11-09";
  const tomorrow = "2026-11-10";
  const fourFromTonight = "2026-12-07";
  const fourFromToday = "2026-12-07";
  const fourFromTomorrow = "2026-12-08";

  for (const text of [
    "schedule a walk four weeks from tonight",
    "plan a walk 4 weeks from tonight",
    "add a 10 minute walk for four weeks from tonight",
    "create an activation to walk four weeks from tonight",
    "Four weeks from tonight, schedule a walk",
    "schedule a walk in four weeks from tonight",
    "FOUR WEEKS FROM TONIGHT schedule a walk"
  ]) {
    expectWhen(app, text, now, fourFromTonight, 20);
    assert(
      app.firstFourWeeksOffset(text)?.anchor === "tonight",
      `positive tonight phrase must be recognized: ${text}`
    );
  }

  for (const text of [
    "schedule a walk four weeks from today",
    "plan a walk 4 weeks from today",
    "add a 10 minute walk for four weeks from today"
  ]) {
    expectWhen(app, text, now, fourFromToday, 10);
    assert(
      app.firstFourWeeksOffset(text)?.anchor === "today",
      `positive today phrase must be recognized: ${text}`
    );
  }

  for (const text of [
    "schedule a walk four weeks from tomorrow",
    "plan a walk 4 weeks from tomorrow",
    "create an activation to walk four weeks from tomorrow"
  ]) {
    expectWhen(app, text, now, fourFromTomorrow, 10);
    assert(
      app.firstFourWeeksOffset(text)?.anchor === "tomorrow",
      `positive tomorrow phrase must be recognized: ${text}`
    );
  }

  const exposureTonight = app.extractWhen(
    "add an exposure to approach the store four weeks from tonight",
    now
  );
  assert(
    localKey(exposureTonight) === fourFromTonight && localHour(exposureTonight) === 20,
    `exposure four-weeks-from-tonight must be ${fourFromTonight} at 20:00, got ${exposureTonight}`
  );
  const exposureToday = app.extractWhen(
    "add an exposure to approach the store four weeks from today",
    now
  );
  assert(
    localKey(exposureToday) === fourFromToday && localHour(exposureToday) === 10,
    `exposure four-weeks-from-today must be ${fourFromToday} at 10:00, got ${exposureToday}`
  );
  const exposureTomorrow = app.extractWhen(
    "add an exposure to approach the store four weeks from tomorrow",
    now
  );
  assert(
    localKey(exposureTomorrow) === fourFromTomorrow && localHour(exposureTomorrow) === 10,
    `exposure four-weeks-from-tomorrow must be ${fourFromTomorrow} at 10:00, got ${exposureTomorrow}`
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
  assert(app.extractWhen("schedule a walk in four weeks", now) == null, "in four weeks must stay unscheduled");
  assert(app.extractWhen("schedule a walk in three weeks", now) == null, "in three weeks must stay unscheduled");
  assert(app.extractWhen("schedule a walk this weekend", now) == null, "this weekend must stay unscheduled");
  assert(
    app.firstFourWeeksOffset("schedule a walk in four weeks") == null,
    "in four weeks is not an exact four-weeks-from anchor"
  );

  const refusedTonight = app.extractWhen(
    "schedule a walk tonight, not four weeks from tonight",
    now
  );
  assert(
    localKey(refusedTonight) === today && localHour(refusedTonight) === 20,
    `negated four-weeks-from-tonight must stay tonight, got ${refusedTonight}`
  );
  const refusedToday = app.extractWhen(
    "schedule a walk today, not four weeks from today",
    now
  );
  assert(
    localKey(refusedToday) === today && localHour(refusedToday) === 16,
    `negated four-weeks-from-today must stay today, got ${refusedToday}`
  );
  const refusedTomorrow = app.extractWhen(
    "schedule a walk tomorrow, not four weeks from tomorrow",
    now
  );
  assert(
    localKey(refusedTomorrow) === tomorrow && localHour(refusedTomorrow) === 10,
    `negated four-weeks-from-tomorrow must stay tomorrow, got ${refusedTomorrow}`
  );
  const refusedOtherNight = app.extractWhen(
    "schedule a walk tomorrow, not four weeks from tonight",
    now
  );
  assert(
    localKey(refusedOtherNight) === tomorrow && localHour(refusedOtherNight) === 10,
    `negated phrase must not steal tomorrow, got ${refusedOtherNight}`
  );
  const refusedCurly = app.extractWhen(
    "schedule a walk tonight. I can\u2019t do it four weeks from tonight",
    now
  );
  assert(
    localKey(refusedCurly) === today && localHour(refusedCurly) === 20,
    `curly-apostrophe can't-do must stay tonight, got ${refusedCurly}`
  );
  assert(
    app.firstFourWeeksOffset("I can\u2019t four weeks from tonight") == null,
    "curly-apostrophe can't immediately before the phrase is a refusal"
  );
  assert(
    app.firstFourWeeksOffset("not 4 weeks from today") == null,
    "digit refusal must not count as a request"
  );

  const cantTonight = app.extractWhen(
    "I can't tonight — schedule a walk four weeks from tonight",
    now
  );
  assert(
    localKey(cantTonight) === fourFromTonight && localHour(cantTonight) === 20,
    `can't tonight + four weeks from tonight must be ${fourFromTonight} at 20:00, got ${cantTonight}`
  );
  const cantToday = app.extractWhen(
    "I can't today — schedule a walk four weeks from today",
    now
  );
  assert(
    localKey(cantToday) === fourFromToday && localHour(cantToday) === 10,
    `can't today + four weeks from today must be ${fourFromToday} at 10:00, got ${cantToday}`
  );
  const cantTomorrow = app.extractWhen(
    "I can't tomorrow — schedule a walk four weeks from tomorrow",
    now
  );
  assert(
    localKey(cantTomorrow) === fourFromTomorrow && localHour(cantTomorrow) === 10,
    `can't tomorrow + four weeks from tomorrow must be ${fourFromTomorrow} at 10:00, got ${cantTomorrow}`
  );

  const onlyNegated = app.extractWhen("schedule a walk, not four weeks from tonight", now);
  assert(
    onlyNegated == null,
    `a refused four-weeks phrase with no other day must stay unscheduled, got ${onlyNegated}`
  );

  const laterPositive = app.extractWhen(
    "not four weeks from tonight. schedule a walk four weeks from tomorrow",
    now
  );
  assert(
    localKey(laterPositive) === fourFromTomorrow && localHour(laterPositive) === 10,
    `a later positive phrase must win, got ${laterPositive}`
  );
  assert(
    app.firstFourWeeksOffset(
      "schedule a walk four weeks from today, not four weeks from tomorrow"
    )?.anchor === "today",
    "the first positive anchor wins when a later one is refused"
  );

  const late = atLocal(2026, 10, 9, 23, 30);
  expectWhen(app, "schedule a walk four weeks from today", late, fourFromToday, 10);
  expectWhen(app, "schedule a walk four weeks from tonight", late, fourFromTonight, 20);

  const monthEnd = atLocal(2026, 10, 20, 21, 0); // Fri Nov 20, after 20:00
  expectWhen(app, "schedule a walk four weeks from tonight", monthEnd, "2026-12-18", 20);
  expectWhen(app, "schedule a walk four weeks from tomorrow", monthEnd, "2026-12-19", 10);
  assert(
    localKey(app.extractWhen("schedule a walk 4 weeks from today", atLocal(2026, 0, 31, 8, 0))) ===
      "2026-02-28",
    "Jan 31 + 28 days must be Feb 28"
  );
  assert(
    localKey(app.extractWhen("schedule a walk 4 weeks from tomorrow", atLocal(2026, 0, 31, 8, 0))) ===
      "2026-03-01",
    "Jan 31 + 29 days must be Mar 1"
  );

  assert(
    app.extractActionTitle("schedule a walk four weeks from tonight") === "walk",
    `title must stay walk, got ${JSON.stringify(app.extractActionTitle("schedule a walk four weeks from tonight"))}`
  );
  assert(
    app.extractActionTitle("schedule a walk 4 weeks from today") === "walk",
    "digit four-weeks phrase must drop out of the title"
  );
  assert(
    app.extractActionTitle("schedule a walk four weeks from tomorrow") === "walk",
    "tomorrow phrase must drop out of the title"
  );
  assert(
    app.extractActionTitle("add an exposure to approach the store four weeks from tonight") ===
      "approach the store",
    "exposure title must keep the target and drop the four-weeks phrase"
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
      "add a 10 minute walk four weeks from tonight"
    );
    assert(action && action.kind === "added_activation", "executeIntent must persist an activation");
    assert(
      localKey(action.a.scheduledFor) === fourFromTonight,
      `persisted local day must be ${fourFromTonight}, got ${localKey(action.a.scheduledFor)}`
    );
    assert(
      app.todayKey(new RealDate(action.a.scheduledFor)) === fourFromTonight,
      "todayKey of scheduledFor must match the requested local day (calendar marks/agenda)"
    );
    assert(localHour(action.a.scheduledFor) === 20, "persisted hour must stay 20:00 local");
    assert(action.a.title === "walk", `persisted title must be walk, got ${JSON.stringify(action.a.title)}`);
    assert(action.a.duration === 10, `duration must stay 10, got ${action.a.duration}`);
    assert(
      app.STATE.activations.some(
        (a) => a.title === "walk" && localKey(a.scheduledFor) === fourFromTonight
      ),
      "STATE.activations must contain the four-weeks-from-tonight walk"
    );

    const todayAction = await app.executeIntent(
      "add_activation",
      "schedule a walk four weeks from today"
    );
    assert(
      localKey(todayAction.a.scheduledFor) === fourFromToday &&
        localHour(todayAction.a.scheduledFor) === 10 &&
        todayAction.a.title === "walk",
      `persisted today-offset walk must be ${fourFromToday} at 10:00 titled walk, got ${todayAction.a.scheduledFor} ${todayAction.a.title}`
    );

    const tomorrowAction = await app.executeIntent(
      "add_activation",
      "schedule a walk four weeks from tomorrow"
    );
    assert(
      localKey(tomorrowAction.a.scheduledFor) === fourFromTomorrow &&
        localHour(tomorrowAction.a.scheduledFor) === 10 &&
        tomorrowAction.a.title === "walk",
      `persisted tomorrow-offset walk must be ${fourFromTomorrow} at 10:00 titled walk, got ${tomorrowAction.a.scheduledFor} ${tomorrowAction.a.title}`
    );

    const exposure = await app.executeIntent(
      "add_exposure",
      "add an exposure to approach the store four weeks from tonight"
    );
    assert(exposure && exposure.kind === "added_exposure", "exposure create must persist");
    assert(
      localKey(exposure.a.scheduledFor) === fourFromTonight &&
        localHour(exposure.a.scheduledFor) === 20,
      `persisted exposure must be ${fourFromTonight} at 20:00, got ${exposure.a.scheduledFor}`
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
    bundle.includes("function firstFourWeeksOffset"),
    "dist/BreakFree.html must include the four-weeks-from-anchor guard"
  );

  console.log("OK extractWhen four-weeks-from-anchor checks passed");
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
