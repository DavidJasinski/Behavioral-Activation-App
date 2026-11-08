/**
 * Regression: "three weeks from tonight/today/tomorrow" must schedule the
 * named offset, not the shorter token inside the phrase.
 *
 * extractWhen() tested /tonight/, then /tomorrow/, then /today/. Each token
 * sits inside the longer phrase, so on Sun Nov 8:
 *   "schedule a walk three weeks from tonight" persisted Nov 8 at 20:00
 *     instead of Nov 29 at 20:00
 *   "schedule a walk three weeks from today" persisted Nov 8 (now + 1 hour)
 *     instead of Nov 29 at 10:00
 *   "schedule a walk three weeks from tomorrow" persisted Nov 9 at 10:00
 *     instead of Nov 30 at 10:00
 * Calendar marks and that day's agenda then showed the step on the wrong
 * day. There is no edit UI. The same miss hit exposures.
 *
 * Offsets:
 *   three/3 weeks from tonight  → +21 local days at 20:00
 *   three/3 weeks from today    → +21 local days at 10:00
 *   three/3 weeks from tomorrow → +22 local days at 10:00
 *
 * A refused phrase must not win: "schedule a walk tonight, not three weeks
 * from tonight" stays tonight. "I can't tonight — schedule a walk three
 * weeks from tonight" stays twenty-one nights out.
 *
 * "next week", "in three weeks", and "this weekend" stay unscheduled.
 *
 * Run from repo root:
 *   node scripts/check_extract_when_three_weeks.js
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
      `\nthis.extractWhen = extractWhen;\nthis.extractActionTitle = extractActionTitle;\nthis.executeIntent = executeIntent;\nthis.STATE = STATE;\nthis.todayKey = todayKey;\nthis.firstThreeWeeksOffset = firstThreeWeeksOffset;\n`,
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
    typeof app.firstThreeWeeksOffset === "function",
    "firstThreeWeeksOffset helper must exist"
  );

  const now = atLocal(2026, 10, 8, 15, 30); // Sun Nov 8, 2026, 15:30 local
  const today = "2026-11-08";
  const tomorrow = "2026-11-09";
  const threeFromTonight = "2026-11-29";
  const threeFromToday = "2026-11-29";
  const threeFromTomorrow = "2026-11-30";

  for (const text of [
    "schedule a walk three weeks from tonight",
    "plan a walk 3 weeks from tonight",
    "add a 10 minute walk for three weeks from tonight",
    "create an activation to walk three weeks from tonight",
    "Three weeks from tonight, schedule a walk",
    "schedule a walk in three weeks from tonight",
    "THREE WEEKS FROM TONIGHT schedule a walk"
  ]) {
    expectWhen(app, text, now, threeFromTonight, 20);
    assert(
      app.firstThreeWeeksOffset(text)?.anchor === "tonight",
      `positive tonight phrase must be recognized: ${text}`
    );
  }

  for (const text of [
    "schedule a walk three weeks from today",
    "plan a walk 3 weeks from today",
    "add a 10 minute walk for three weeks from today"
  ]) {
    expectWhen(app, text, now, threeFromToday, 10);
    assert(
      app.firstThreeWeeksOffset(text)?.anchor === "today",
      `positive today phrase must be recognized: ${text}`
    );
  }

  for (const text of [
    "schedule a walk three weeks from tomorrow",
    "plan a walk 3 weeks from tomorrow",
    "create an activation to walk three weeks from tomorrow"
  ]) {
    expectWhen(app, text, now, threeFromTomorrow, 10);
    assert(
      app.firstThreeWeeksOffset(text)?.anchor === "tomorrow",
      `positive tomorrow phrase must be recognized: ${text}`
    );
  }

  const exposureTonight = app.extractWhen(
    "add an exposure to approach the store three weeks from tonight",
    now
  );
  assert(
    localKey(exposureTonight) === threeFromTonight && localHour(exposureTonight) === 20,
    `exposure three-weeks-from-tonight must be ${threeFromTonight} at 20:00, got ${exposureTonight}`
  );
  const exposureToday = app.extractWhen(
    "add an exposure to approach the store three weeks from today",
    now
  );
  assert(
    localKey(exposureToday) === threeFromToday && localHour(exposureToday) === 10,
    `exposure three-weeks-from-today must be ${threeFromToday} at 10:00, got ${exposureToday}`
  );
  const exposureTomorrow = app.extractWhen(
    "add an exposure to approach the store three weeks from tomorrow",
    now
  );
  assert(
    localKey(exposureTomorrow) === threeFromTomorrow && localHour(exposureTomorrow) === 10,
    `exposure three-weeks-from-tomorrow must be ${threeFromTomorrow} at 10:00, got ${exposureTomorrow}`
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
  assert(app.extractWhen("schedule a walk in three weeks", now) == null, "in three weeks must stay unscheduled");
  assert(app.extractWhen("schedule a walk in two weeks", now) == null, "in two weeks must stay unscheduled");
  assert(app.extractWhen("schedule a walk this weekend", now) == null, "this weekend must stay unscheduled");
  assert(
    app.firstThreeWeeksOffset("schedule a walk in three weeks") == null,
    "in three weeks is not an exact three-weeks-from anchor"
  );

  const refusedTonight = app.extractWhen(
    "schedule a walk tonight, not three weeks from tonight",
    now
  );
  assert(
    localKey(refusedTonight) === today && localHour(refusedTonight) === 20,
    `negated three-weeks-from-tonight must stay tonight, got ${refusedTonight}`
  );
  const refusedToday = app.extractWhen(
    "schedule a walk today, not three weeks from today",
    now
  );
  assert(
    localKey(refusedToday) === today && localHour(refusedToday) === 16,
    `negated three-weeks-from-today must stay today, got ${refusedToday}`
  );
  const refusedTomorrow = app.extractWhen(
    "schedule a walk tomorrow, not three weeks from tomorrow",
    now
  );
  assert(
    localKey(refusedTomorrow) === tomorrow && localHour(refusedTomorrow) === 10,
    `negated three-weeks-from-tomorrow must stay tomorrow, got ${refusedTomorrow}`
  );
  const refusedOtherNight = app.extractWhen(
    "schedule a walk tomorrow, not three weeks from tonight",
    now
  );
  assert(
    localKey(refusedOtherNight) === tomorrow && localHour(refusedOtherNight) === 10,
    `negated phrase must not steal tomorrow, got ${refusedOtherNight}`
  );
  const refusedCurly = app.extractWhen(
    "schedule a walk tonight. I can\u2019t do it three weeks from tonight",
    now
  );
  assert(
    localKey(refusedCurly) === today && localHour(refusedCurly) === 20,
    `curly-apostrophe can't-do must stay tonight, got ${refusedCurly}`
  );
  assert(
    app.firstThreeWeeksOffset("I can\u2019t three weeks from tonight") == null,
    "curly-apostrophe can't immediately before the phrase is a refusal"
  );
  assert(
    app.firstThreeWeeksOffset("not 3 weeks from today") == null,
    "digit refusal must not count as a request"
  );

  const cantTonight = app.extractWhen(
    "I can't tonight — schedule a walk three weeks from tonight",
    now
  );
  assert(
    localKey(cantTonight) === threeFromTonight && localHour(cantTonight) === 20,
    `can't tonight + three weeks from tonight must be ${threeFromTonight} at 20:00, got ${cantTonight}`
  );
  const cantToday = app.extractWhen(
    "I can't today — schedule a walk three weeks from today",
    now
  );
  assert(
    localKey(cantToday) === threeFromToday && localHour(cantToday) === 10,
    `can't today + three weeks from today must be ${threeFromToday} at 10:00, got ${cantToday}`
  );
  const cantTomorrow = app.extractWhen(
    "I can't tomorrow — schedule a walk three weeks from tomorrow",
    now
  );
  assert(
    localKey(cantTomorrow) === threeFromTomorrow && localHour(cantTomorrow) === 10,
    `can't tomorrow + three weeks from tomorrow must be ${threeFromTomorrow} at 10:00, got ${cantTomorrow}`
  );

  const onlyNegated = app.extractWhen("schedule a walk, not three weeks from tonight", now);
  assert(
    onlyNegated == null,
    `a refused three-weeks phrase with no other day must stay unscheduled, got ${onlyNegated}`
  );

  const laterPositive = app.extractWhen(
    "not three weeks from tonight. schedule a walk three weeks from tomorrow",
    now
  );
  assert(
    localKey(laterPositive) === threeFromTomorrow && localHour(laterPositive) === 10,
    `a later positive phrase must win, got ${laterPositive}`
  );
  assert(
    app.firstThreeWeeksOffset(
      "schedule a walk three weeks from today, not three weeks from tomorrow"
    )?.anchor === "today",
    "the first positive anchor wins when a later one is refused"
  );

  const late = atLocal(2026, 10, 8, 23, 30);
  expectWhen(app, "schedule a walk three weeks from today", late, threeFromToday, 10);
  expectWhen(app, "schedule a walk three weeks from tonight", late, threeFromTonight, 20);

  const monthEnd = atLocal(2026, 10, 20, 21, 0); // Fri Nov 20, after 20:00
  expectWhen(app, "schedule a walk three weeks from tonight", monthEnd, "2026-12-11", 20);
  expectWhen(app, "schedule a walk three weeks from tomorrow", monthEnd, "2026-12-12", 10);
  assert(
    localKey(app.extractWhen("schedule a walk 3 weeks from today", atLocal(2026, 0, 31, 8, 0))) ===
      "2026-02-21",
    "Jan 31 + 21 days must be Feb 21"
  );
  assert(
    localKey(app.extractWhen("schedule a walk 3 weeks from tomorrow", atLocal(2026, 0, 31, 8, 0))) ===
      "2026-02-22",
    "Jan 31 + 22 days must be Feb 22"
  );

  assert(
    app.extractActionTitle("schedule a walk three weeks from tonight") === "walk",
    `title must stay walk, got ${JSON.stringify(app.extractActionTitle("schedule a walk three weeks from tonight"))}`
  );
  assert(
    app.extractActionTitle("schedule a walk 3 weeks from today") === "walk",
    "digit three-weeks phrase must drop out of the title"
  );
  assert(
    app.extractActionTitle("schedule a walk three weeks from tomorrow") === "walk",
    "tomorrow phrase must drop out of the title"
  );
  assert(
    app.extractActionTitle("add an exposure to approach the store three weeks from tonight") ===
      "approach the store",
    "exposure title must keep the target and drop the three-weeks phrase"
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
      "add a 10 minute walk three weeks from tonight"
    );
    assert(action && action.kind === "added_activation", "executeIntent must persist an activation");
    assert(
      localKey(action.a.scheduledFor) === threeFromTonight,
      `persisted local day must be ${threeFromTonight}, got ${localKey(action.a.scheduledFor)}`
    );
    assert(
      app.todayKey(new RealDate(action.a.scheduledFor)) === threeFromTonight,
      "todayKey of scheduledFor must match the requested local day (calendar marks/agenda)"
    );
    assert(localHour(action.a.scheduledFor) === 20, "persisted hour must stay 20:00 local");
    assert(action.a.title === "walk", `persisted title must be walk, got ${JSON.stringify(action.a.title)}`);
    assert(action.a.duration === 10, `duration must stay 10, got ${action.a.duration}`);
    assert(
      app.STATE.activations.some(
        (a) => a.title === "walk" && localKey(a.scheduledFor) === threeFromTonight
      ),
      "STATE.activations must contain the three-weeks-from-tonight walk"
    );

    const todayAction = await app.executeIntent(
      "add_activation",
      "schedule a walk three weeks from today"
    );
    assert(
      localKey(todayAction.a.scheduledFor) === threeFromToday &&
        localHour(todayAction.a.scheduledFor) === 10 &&
        todayAction.a.title === "walk",
      `persisted today-offset walk must be ${threeFromToday} at 10:00 titled walk, got ${todayAction.a.scheduledFor} ${todayAction.a.title}`
    );

    const tomorrowAction = await app.executeIntent(
      "add_activation",
      "schedule a walk three weeks from tomorrow"
    );
    assert(
      localKey(tomorrowAction.a.scheduledFor) === threeFromTomorrow &&
        localHour(tomorrowAction.a.scheduledFor) === 10 &&
        tomorrowAction.a.title === "walk",
      `persisted tomorrow-offset walk must be ${threeFromTomorrow} at 10:00 titled walk, got ${tomorrowAction.a.scheduledFor} ${tomorrowAction.a.title}`
    );

    const exposure = await app.executeIntent(
      "add_exposure",
      "add an exposure to approach the store three weeks from tonight"
    );
    assert(exposure && exposure.kind === "added_exposure", "exposure create must persist");
    assert(
      localKey(exposure.a.scheduledFor) === threeFromTonight &&
        localHour(exposure.a.scheduledFor) === 20,
      `persisted exposure must be ${threeFromTonight} at 20:00, got ${exposure.a.scheduledFor}`
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
    bundle.includes("function firstThreeWeeksOffset"),
    "dist/BreakFree.html must include the three-weeks-from-anchor guard"
  );

  console.log("OK extractWhen three-weeks-from-anchor checks passed");
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
