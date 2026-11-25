/**
 * Regression: "twenty weeks from tonight/today/tomorrow" must schedule the
 * named offset, not the shorter token inside the phrase.
 *
 * extractWhen() tested /tonight/, then /tomorrow/, then /today/. Each token
 * sits inside the longer phrase, so on Wed Nov 25:
 *   "schedule a walk twenty weeks from tonight" persisted Nov 25 at 20:00
 *     instead of Apr 14 at 20:00
 *   "schedule a walk twenty weeks from today" persisted Nov 25 (now + 1 hour)
 *     instead of Apr 14 at 10:00
 *   "schedule a walk twenty weeks from tomorrow" persisted Nov 26 at 10:00
 *     instead of Apr 15 at 10:00
 * Calendar marks and that day's agenda then showed the step on the wrong
 * day. There is no edit UI. The same miss hit exposures.
 *
 * Offsets:
 *   twenty/20 weeks from tonight  → +140 local days at 20:00
 *   twenty/20 weeks from today    → +140 local days at 10:00
 *   twenty/20 weeks from tomorrow → +141 local days at 10:00
 *
 * A refused phrase must not win: "schedule a walk tonight, not twenty weeks
 * from tonight" stays tonight. "I can't tonight — schedule a walk twenty
 * weeks from tonight" stays one hundred forty nights out.
 *
 * "next week", "in twenty weeks", "in nineteen weeks", and "this weekend"
 * stay unscheduled. "nineteen weeks from …" stays on the shorter token (its
 * own draft).
 *
 * Run from repo root:
 *   node scripts/check_extract_when_twenty_weeks.js
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
      `\nthis.extractWhen = extractWhen;\nthis.extractActionTitle = extractActionTitle;\nthis.executeIntent = executeIntent;\nthis.STATE = STATE;\nthis.todayKey = todayKey;\nthis.firstTwentyWeeksOffset = firstTwentyWeeksOffset;\n`,
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
    typeof app.firstTwentyWeeksOffset === "function",
    "firstTwentyWeeksOffset helper must exist"
  );

  const now = atLocal(2026, 10, 25, 15, 30); // Wed Nov 25, 2026, 15:30 local
  const today = "2026-11-25";
  const tomorrow = "2026-11-26";
  const twentyFromTonight = "2027-04-14";
  const twentyFromToday = "2027-04-14";
  const twentyFromTomorrow = "2027-04-15";

  for (const text of [
    "schedule a walk twenty weeks from tonight",
    "plan a walk 20 weeks from tonight",
    "add a 10 minute walk for twenty weeks from tonight",
    "create an activation to walk twenty weeks from tonight",
    "Twenty weeks from tonight, schedule a walk",
    "schedule a walk in twenty weeks from tonight",
    "TWENTY WEEKS FROM TONIGHT schedule a walk"
  ]) {
    expectWhen(app, text, now, twentyFromTonight, 20);
    assert(
      app.firstTwentyWeeksOffset(text)?.anchor === "tonight",
      `positive tonight phrase must be recognized: ${text}`
    );
  }

  for (const text of [
    "schedule a walk twenty weeks from today",
    "plan a walk 20 weeks from today",
    "add a 10 minute walk for twenty weeks from today"
  ]) {
    expectWhen(app, text, now, twentyFromToday, 10);
    assert(
      app.firstTwentyWeeksOffset(text)?.anchor === "today",
      `positive today phrase must be recognized: ${text}`
    );
  }

  for (const text of [
    "schedule a walk twenty weeks from tomorrow",
    "plan a walk 20 weeks from tomorrow",
    "create an activation to walk twenty weeks from tomorrow"
  ]) {
    expectWhen(app, text, now, twentyFromTomorrow, 10);
    assert(
      app.firstTwentyWeeksOffset(text)?.anchor === "tomorrow",
      `positive tomorrow phrase must be recognized: ${text}`
    );
  }

  const exposureTonight = app.extractWhen(
    "add an exposure to approach the store twenty weeks from tonight",
    now
  );
  assert(
    localKey(exposureTonight) === twentyFromTonight && localHour(exposureTonight) === 20,
    `exposure twenty-weeks-from-tonight must be ${twentyFromTonight} at 20:00, got ${exposureTonight}`
  );
  const exposureToday = app.extractWhen(
    "add an exposure to approach the store twenty weeks from today",
    now
  );
  assert(
    localKey(exposureToday) === twentyFromToday && localHour(exposureToday) === 10,
    `exposure twenty-weeks-from-today must be ${twentyFromToday} at 10:00, got ${exposureToday}`
  );
  const exposureTomorrow = app.extractWhen(
    "add an exposure to approach the store twenty weeks from tomorrow",
    now
  );
  assert(
    localKey(exposureTomorrow) === twentyFromTomorrow && localHour(exposureTomorrow) === 10,
    `exposure twenty-weeks-from-tomorrow must be ${twentyFromTomorrow} at 10:00, got ${exposureTomorrow}`
  );

  expectWhen(app, "schedule a walk tonight", now, today, 20);
  expectWhen(app, "schedule a walk tomorrow", now, tomorrow, 10);
  expectWhen(app, "schedule a walk today", now, today, 16);

  assert(app.extractWhen("schedule a walk next week", now) == null, "next week stays unscheduled");
  assert(
    app.extractWhen("schedule a walk in twenty weeks", now) == null,
    "in twenty weeks stays unscheduled"
  );
  assert(
    app.extractWhen("schedule a walk in nineteen weeks", now) == null,
    "in nineteen weeks stays unscheduled"
  );
  assert(
    app.extractWhen("schedule a walk this weekend", now) == null,
    "this weekend stays unscheduled"
  );
  assert(
    localKey(app.extractWhen("schedule a walk nineteen weeks from tonight", now)) === today &&
      localHour(app.extractWhen("schedule a walk nineteen weeks from tonight", now)) === 20,
    "nineteen weeks from tonight stays on the shorter tonight token"
  );
  assert(
    localKey(app.extractWhen("schedule a walk two weeks from tonight", now)) === today &&
      localHour(app.extractWhen("schedule a walk two weeks from tonight", now)) === 20,
    "two weeks from tonight stays on the shorter tonight token"
  );
  assert(
    localKey(app.extractWhen("schedule a walk 120 weeks from tonight", now)) === today &&
      localHour(app.extractWhen("schedule a walk 120 weeks from tonight", now)) === 20,
    "120 weeks from tonight stays on the shorter tonight token"
  );

  const refusedTonight = app.extractWhen(
    "schedule a walk tonight, not twenty weeks from tonight",
    now
  );
  assert(
    localKey(refusedTonight) === today && localHour(refusedTonight) === 20,
    `negated twenty-weeks-from-tonight must stay tonight, got ${refusedTonight}`
  );
  const refusedToday = app.extractWhen(
    "schedule a walk today, not twenty weeks from today",
    now
  );
  assert(
    localKey(refusedToday) === today && localHour(refusedToday) === 16,
    `negated twenty-weeks-from-today must stay today, got ${refusedToday}`
  );
  const refusedTomorrow = app.extractWhen(
    "schedule a walk tomorrow, not twenty weeks from tomorrow",
    now
  );
  assert(
    localKey(refusedTomorrow) === tomorrow && localHour(refusedTomorrow) === 10,
    `negated twenty-weeks-from-tomorrow must stay tomorrow, got ${refusedTomorrow}`
  );
  const refusedOtherNight = app.extractWhen(
    "schedule a walk tomorrow, not twenty weeks from tonight",
    now
  );
  assert(
    localKey(refusedOtherNight) === tomorrow && localHour(refusedOtherNight) === 10,
    `negated phrase must not steal tomorrow, got ${refusedOtherNight}`
  );
  const refusedCurly = app.extractWhen(
    "schedule a walk tonight. I can\u2019t do it twenty weeks from tonight",
    now
  );
  assert(
    localKey(refusedCurly) === today && localHour(refusedCurly) === 20,
    `curly-apostrophe can't-do must stay tonight, got ${refusedCurly}`
  );
  assert(
    app.firstTwentyWeeksOffset("I can\u2019t twenty weeks from tonight") == null,
    "curly-apostrophe can't immediately before the phrase is a refusal"
  );
  assert(
    app.firstTwentyWeeksOffset("not 20 weeks from today") == null,
    "digit refusal must not count as a request"
  );

  const cantTonight = app.extractWhen(
    "I can't tonight — schedule a walk twenty weeks from tonight",
    now
  );
  assert(
    localKey(cantTonight) === twentyFromTonight && localHour(cantTonight) === 20,
    `can't tonight + twenty weeks from tonight must be ${twentyFromTonight} at 20:00, got ${cantTonight}`
  );
  const cantToday = app.extractWhen(
    "I can't today — schedule a walk twenty weeks from today",
    now
  );
  assert(
    localKey(cantToday) === twentyFromToday && localHour(cantToday) === 10,
    `can't today + twenty weeks from today must be ${twentyFromToday} at 10:00, got ${cantToday}`
  );
  const cantTomorrow = app.extractWhen(
    "I can't tomorrow — schedule a walk twenty weeks from tomorrow",
    now
  );
  assert(
    localKey(cantTomorrow) === twentyFromTomorrow && localHour(cantTomorrow) === 10,
    `can't tomorrow + twenty weeks from tomorrow must be ${twentyFromTomorrow} at 10:00, got ${cantTomorrow}`
  );

  const onlyNegated = app.extractWhen("schedule a walk, not twenty weeks from tonight", now);
  assert(
    onlyNegated == null,
    `a refused twenty-weeks phrase with no other day must stay unscheduled, got ${onlyNegated}`
  );

  const laterPositive = app.extractWhen(
    "not twenty weeks from tonight. schedule a walk twenty weeks from tomorrow",
    now
  );
  assert(
    localKey(laterPositive) === twentyFromTomorrow && localHour(laterPositive) === 10,
    `a later positive phrase must win, got ${laterPositive}`
  );
  assert(
    app.firstTwentyWeeksOffset(
      "schedule a walk twenty weeks from today, not twenty weeks from tomorrow"
    )?.anchor === "today",
    "the first positive anchor wins when a later one is refused"
  );

  const late = atLocal(2026, 10, 25, 23, 30);
  expectWhen(app, "schedule a walk twenty weeks from today", late, twentyFromToday, 10);
  expectWhen(app, "schedule a walk twenty weeks from tonight", late, twentyFromTonight, 20);

  const priorTuesday = atLocal(2026, 10, 24, 15, 30);
  expectWhen(app, "schedule a walk twenty weeks from tonight", priorTuesday, "2027-04-13", 20);
  expectWhen(app, "schedule a walk twenty weeks from today", priorTuesday, "2027-04-13", 10);
  expectWhen(app, "schedule a walk twenty weeks from tomorrow", priorTuesday, "2027-04-14", 10);

  const monthEnd = atLocal(2026, 11, 31, 21, 0); // Thu Dec 31, after 20:00
  expectWhen(app, "schedule a walk twenty weeks from tonight", monthEnd, "2027-05-20", 20);
  expectWhen(app, "schedule a walk twenty weeks from tomorrow", monthEnd, "2027-05-21", 10);
  assert(
    localKey(app.extractWhen("schedule a walk 20 weeks from today", atLocal(2027, 0, 31, 8, 0))) ===
      "2027-06-20",
    "Jan 31 + 140 days must be Jun 20"
  );
  assert(
    localKey(app.extractWhen("schedule a walk 20 weeks from tomorrow", atLocal(2027, 0, 31, 8, 0))) ===
      "2027-06-21",
    "Jan 31 + 141 days must be Jun 21"
  );

  assert(
    app.extractActionTitle("schedule a walk twenty weeks from tonight") === "walk",
    `title must stay walk, got ${JSON.stringify(app.extractActionTitle("schedule a walk twenty weeks from tonight"))}`
  );
  assert(
    app.extractActionTitle("schedule a walk 20 weeks from today") === "walk",
    "digit twenty-weeks phrase must drop out of the title"
  );
  assert(
    app.extractActionTitle("schedule a walk twenty weeks from tomorrow") === "walk",
    "tomorrow phrase must drop out of the title"
  );
  assert(
    app.extractActionTitle("add an exposure to approach the store twenty weeks from tonight") ===
      "approach the store",
    "exposure title must keep the target and drop the twenty-weeks phrase"
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
      "add a 10 minute walk twenty weeks from tonight"
    );
    assert(action && action.kind === "added_activation", "executeIntent must persist an activation");
    assert(
      localKey(action.a.scheduledFor) === twentyFromTonight,
      `persisted local day must be ${twentyFromTonight}, got ${localKey(action.a.scheduledFor)}`
    );
    assert(
      app.todayKey(new RealDate(action.a.scheduledFor)) === twentyFromTonight,
      "todayKey of scheduledFor must match the requested local day (calendar marks/agenda)"
    );
    assert(localHour(action.a.scheduledFor) === 20, "persisted hour must stay 20:00 local");
    assert(action.a.title === "walk", `persisted title must be walk, got ${JSON.stringify(action.a.title)}`);
    assert(action.a.duration === 10, `duration must stay 10, got ${action.a.duration}`);
    assert(
      app.STATE.activations.some(
        (a) => a.title === "walk" && localKey(a.scheduledFor) === twentyFromTonight
      ),
      "STATE.activations must contain the twenty-weeks-from-tonight walk"
    );

    const todayAction = await app.executeIntent(
      "add_activation",
      "schedule a walk twenty weeks from today"
    );
    assert(
      localKey(todayAction.a.scheduledFor) === twentyFromToday &&
        localHour(todayAction.a.scheduledFor) === 10 &&
        todayAction.a.title === "walk",
      `persisted today-offset walk must be ${twentyFromToday} at 10:00 titled walk, got ${todayAction.a.scheduledFor} ${todayAction.a.title}`
    );

    const tomorrowAction = await app.executeIntent(
      "add_activation",
      "schedule a walk twenty weeks from tomorrow"
    );
    assert(
      localKey(tomorrowAction.a.scheduledFor) === twentyFromTomorrow &&
        localHour(tomorrowAction.a.scheduledFor) === 10 &&
        tomorrowAction.a.title === "walk",
      `persisted tomorrow-offset walk must be ${twentyFromTomorrow} at 10:00 titled walk, got ${tomorrowAction.a.scheduledFor} ${tomorrowAction.a.title}`
    );

    const exposure = await app.executeIntent(
      "add_exposure",
      "add an exposure to approach the store twenty weeks from today"
    );
    assert(exposure && exposure.kind === "added_exposure", "exposure create must persist");
    assert(
      localKey(exposure.a.scheduledFor) === twentyFromToday &&
        localHour(exposure.a.scheduledFor) === 10,
      `persisted exposure must be ${twentyFromToday} at 10:00, got ${exposure.a.scheduledFor}`
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
    bundle.includes("function firstTwentyWeeksOffset"),
    "dist/BreakFree.html must include the twenty-weeks-from-anchor guard"
  );

  console.log("OK extractWhen twenty-weeks-from-anchor checks passed");
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
