/**
 * Regression: "nineteen weeks from tonight/today/tomorrow" must schedule the
 * named offset, not the shorter token inside the phrase.
 *
 * extractWhen() tested /tonight/, then /tomorrow/, then /today/. Each token
 * sits inside the longer phrase, so on Tue Nov 24:
 *   "schedule a walk nineteen weeks from tonight" persisted Nov 24 at 20:00
 *     instead of Apr 6 at 20:00
 *   "schedule a walk nineteen weeks from today" persisted Nov 24 (now + 1 hour)
 *     instead of Apr 6 at 10:00
 *   "schedule a walk nineteen weeks from tomorrow" persisted Nov 25 at 10:00
 *     instead of Apr 7 at 10:00
 * Calendar marks and that day's agenda then showed the step on the wrong
 * day. There is no edit UI. The same miss hit exposures.
 *
 * Offsets:
 *   nineteen/19 weeks from tonight  → +133 local days at 20:00
 *   nineteen/19 weeks from today    → +133 local days at 10:00
 *   nineteen/19 weeks from tomorrow → +134 local days at 10:00
 *
 * A refused phrase must not win: "schedule a walk tonight, not nineteen weeks
 * from tonight" stays tonight. "I can't tonight — schedule a walk nineteen
 * weeks from tonight" stays one hundred thirty-three nights out.
 *
 * "next week", "in nineteen weeks", "in eighteen weeks", and "this weekend"
 * stay unscheduled. "eighteen weeks from …" stays on the shorter token (its
 * own draft).
 *
 * Run from repo root:
 *   node scripts/check_extract_when_nineteen_weeks.js
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
      `\nthis.extractWhen = extractWhen;\nthis.extractActionTitle = extractActionTitle;\nthis.executeIntent = executeIntent;\nthis.STATE = STATE;\nthis.todayKey = todayKey;\nthis.firstNineteenWeeksOffset = firstNineteenWeeksOffset;\n`,
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
    typeof app.firstNineteenWeeksOffset === "function",
    "firstNineteenWeeksOffset helper must exist"
  );

  const now = atLocal(2026, 10, 24, 15, 30); // Tue Nov 24, 2026, 15:30 local
  const today = "2026-11-24";
  const tomorrow = "2026-11-25";
  const nineteenFromTonight = "2027-04-06";
  const nineteenFromToday = "2027-04-06";
  const nineteenFromTomorrow = "2027-04-07";

  for (const text of [
    "schedule a walk nineteen weeks from tonight",
    "plan a walk 19 weeks from tonight",
    "add a 10 minute walk for nineteen weeks from tonight",
    "create an activation to walk nineteen weeks from tonight",
    "Nineteen weeks from tonight, schedule a walk",
    "schedule a walk in nineteen weeks from tonight",
    "NINETEEN WEEKS FROM TONIGHT schedule a walk"
  ]) {
    expectWhen(app, text, now, nineteenFromTonight, 20);
    assert(
      app.firstNineteenWeeksOffset(text)?.anchor === "tonight",
      `positive tonight phrase must be recognized: ${text}`
    );
  }

  for (const text of [
    "schedule a walk nineteen weeks from today",
    "plan a walk 19 weeks from today",
    "add a 10 minute walk for nineteen weeks from today"
  ]) {
    expectWhen(app, text, now, nineteenFromToday, 10);
    assert(
      app.firstNineteenWeeksOffset(text)?.anchor === "today",
      `positive today phrase must be recognized: ${text}`
    );
  }

  for (const text of [
    "schedule a walk nineteen weeks from tomorrow",
    "plan a walk 19 weeks from tomorrow",
    "create an activation to walk nineteen weeks from tomorrow"
  ]) {
    expectWhen(app, text, now, nineteenFromTomorrow, 10);
    assert(
      app.firstNineteenWeeksOffset(text)?.anchor === "tomorrow",
      `positive tomorrow phrase must be recognized: ${text}`
    );
  }

  const exposureTonight = app.extractWhen(
    "add an exposure to approach the store nineteen weeks from tonight",
    now
  );
  assert(
    localKey(exposureTonight) === nineteenFromTonight && localHour(exposureTonight) === 20,
    `exposure nineteen-weeks-from-tonight must be ${nineteenFromTonight} at 20:00, got ${exposureTonight}`
  );
  const exposureToday = app.extractWhen(
    "add an exposure to approach the store nineteen weeks from today",
    now
  );
  assert(
    localKey(exposureToday) === nineteenFromToday && localHour(exposureToday) === 10,
    `exposure nineteen-weeks-from-today must be ${nineteenFromToday} at 10:00, got ${exposureToday}`
  );
  const exposureTomorrow = app.extractWhen(
    "add an exposure to approach the store nineteen weeks from tomorrow",
    now
  );
  assert(
    localKey(exposureTomorrow) === nineteenFromTomorrow && localHour(exposureTomorrow) === 10,
    `exposure nineteen-weeks-from-tomorrow must be ${nineteenFromTomorrow} at 10:00, got ${exposureTomorrow}`
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
    app.extractWhen("schedule a walk in nineteen weeks", now) == null,
    "in nineteen weeks must stay unscheduled"
  );
  assert(
    app.extractWhen("schedule a walk in eighteen weeks", now) == null,
    "in eighteen weeks must stay unscheduled"
  );
  assert(app.extractWhen("schedule a walk this weekend", now) == null, "this weekend must stay unscheduled");
  assert(
    app.firstNineteenWeeksOffset("schedule a walk in nineteen weeks") == null,
    "in nineteen weeks is not an exact nineteen-weeks-from anchor"
  );
  assert(
    app.firstNineteenWeeksOffset("schedule a walk eighteen weeks from tonight") == null,
    "eighteen weeks from tonight is not this offset"
  );
  assert(
    app.firstNineteenWeeksOffset("schedule a walk twenty weeks from tonight") == null,
    "twenty weeks from tonight is not this offset"
  );
  assert(
    app.firstNineteenWeeksOffset("schedule a walk nine weeks from tonight") == null,
    "nine weeks from tonight is not this offset"
  );
  assert(
    app.firstNineteenWeeksOffset("schedule a walk 119 weeks from tonight") == null,
    "119 weeks from tonight is not this offset"
  );
  assert(
    localKey(app.extractWhen("schedule a walk eighteen weeks from tonight", now)) === today &&
      localHour(app.extractWhen("schedule a walk eighteen weeks from tonight", now)) === 20,
    "eighteen weeks from tonight stays on the shorter tonight token"
  );
  assert(
    localKey(app.extractWhen("schedule a walk twenty weeks from tonight", now)) === today &&
      localHour(app.extractWhen("schedule a walk twenty weeks from tonight", now)) === 20,
    "twenty weeks from tonight stays on the shorter tonight token"
  );
  assert(
    localKey(app.extractWhen("schedule a walk nine weeks from tonight", now)) === today &&
      localHour(app.extractWhen("schedule a walk nine weeks from tonight", now)) === 20,
    "nine weeks from tonight stays on the shorter tonight token"
  );
  assert(
    localKey(app.extractWhen("schedule a walk 119 weeks from tonight", now)) === today &&
      localHour(app.extractWhen("schedule a walk 119 weeks from tonight", now)) === 20,
    "119 weeks from tonight stays on the shorter tonight token"
  );

  const refusedTonight = app.extractWhen(
    "schedule a walk tonight, not nineteen weeks from tonight",
    now
  );
  assert(
    localKey(refusedTonight) === today && localHour(refusedTonight) === 20,
    `negated nineteen-weeks-from-tonight must stay tonight, got ${refusedTonight}`
  );
  const refusedToday = app.extractWhen(
    "schedule a walk today, not nineteen weeks from today",
    now
  );
  assert(
    localKey(refusedToday) === today && localHour(refusedToday) === 16,
    `negated nineteen-weeks-from-today must stay today, got ${refusedToday}`
  );
  const refusedTomorrow = app.extractWhen(
    "schedule a walk tomorrow, not nineteen weeks from tomorrow",
    now
  );
  assert(
    localKey(refusedTomorrow) === tomorrow && localHour(refusedTomorrow) === 10,
    `negated nineteen-weeks-from-tomorrow must stay tomorrow, got ${refusedTomorrow}`
  );
  const refusedOtherNight = app.extractWhen(
    "schedule a walk tomorrow, not nineteen weeks from tonight",
    now
  );
  assert(
    localKey(refusedOtherNight) === tomorrow && localHour(refusedOtherNight) === 10,
    `negated phrase must not steal tomorrow, got ${refusedOtherNight}`
  );
  const refusedCurly = app.extractWhen(
    "schedule a walk tonight. I can\u2019t do it nineteen weeks from tonight",
    now
  );
  assert(
    localKey(refusedCurly) === today && localHour(refusedCurly) === 20,
    `curly-apostrophe can't-do must stay tonight, got ${refusedCurly}`
  );
  assert(
    app.firstNineteenWeeksOffset("I can\u2019t nineteen weeks from tonight") == null,
    "curly-apostrophe can't immediately before the phrase is a refusal"
  );
  assert(
    app.firstNineteenWeeksOffset("not 19 weeks from today") == null,
    "digit refusal must not count as a request"
  );

  const cantTonight = app.extractWhen(
    "I can't tonight — schedule a walk nineteen weeks from tonight",
    now
  );
  assert(
    localKey(cantTonight) === nineteenFromTonight && localHour(cantTonight) === 20,
    `can't tonight + nineteen weeks from tonight must be ${nineteenFromTonight} at 20:00, got ${cantTonight}`
  );
  const cantToday = app.extractWhen(
    "I can't today — schedule a walk nineteen weeks from today",
    now
  );
  assert(
    localKey(cantToday) === nineteenFromToday && localHour(cantToday) === 10,
    `can't today + nineteen weeks from today must be ${nineteenFromToday} at 10:00, got ${cantToday}`
  );
  const cantTomorrow = app.extractWhen(
    "I can't tomorrow — schedule a walk nineteen weeks from tomorrow",
    now
  );
  assert(
    localKey(cantTomorrow) === nineteenFromTomorrow && localHour(cantTomorrow) === 10,
    `can't tomorrow + nineteen weeks from tomorrow must be ${nineteenFromTomorrow} at 10:00, got ${cantTomorrow}`
  );

  const onlyNegated = app.extractWhen("schedule a walk, not nineteen weeks from tonight", now);
  assert(
    onlyNegated == null,
    `a refused nineteen-weeks phrase with no other day must stay unscheduled, got ${onlyNegated}`
  );

  const laterPositive = app.extractWhen(
    "not nineteen weeks from tonight. schedule a walk nineteen weeks from tomorrow",
    now
  );
  assert(
    localKey(laterPositive) === nineteenFromTomorrow && localHour(laterPositive) === 10,
    `a later positive phrase must win, got ${laterPositive}`
  );
  assert(
    app.firstNineteenWeeksOffset(
      "schedule a walk nineteen weeks from today, not nineteen weeks from tomorrow"
    )?.anchor === "today",
    "the first positive anchor wins when a later one is refused"
  );

  const late = atLocal(2026, 10, 24, 23, 30);
  expectWhen(app, "schedule a walk nineteen weeks from today", late, nineteenFromToday, 10);
  expectWhen(app, "schedule a walk nineteen weeks from tonight", late, nineteenFromTonight, 20);

  const priorMonday = atLocal(2026, 10, 23, 15, 30);
  expectWhen(app, "schedule a walk nineteen weeks from tonight", priorMonday, "2027-04-05", 20);
  expectWhen(app, "schedule a walk nineteen weeks from today", priorMonday, "2027-04-05", 10);
  expectWhen(app, "schedule a walk nineteen weeks from tomorrow", priorMonday, "2027-04-06", 10);

  const monthEnd = atLocal(2026, 11, 31, 21, 0); // Thu Dec 31, after 20:00
  expectWhen(app, "schedule a walk nineteen weeks from tonight", monthEnd, "2027-05-13", 20);
  expectWhen(app, "schedule a walk nineteen weeks from tomorrow", monthEnd, "2027-05-14", 10);
  assert(
    localKey(app.extractWhen("schedule a walk 19 weeks from today", atLocal(2027, 0, 31, 8, 0))) ===
      "2027-06-13",
    "Jan 31 + 133 days must be Jun 13"
  );
  assert(
    localKey(app.extractWhen("schedule a walk 19 weeks from tomorrow", atLocal(2027, 0, 31, 8, 0))) ===
      "2027-06-14",
    "Jan 31 + 134 days must be Jun 14"
  );

  assert(
    app.extractActionTitle("schedule a walk nineteen weeks from tonight") === "walk",
    `title must stay walk, got ${JSON.stringify(app.extractActionTitle("schedule a walk nineteen weeks from tonight"))}`
  );
  assert(
    app.extractActionTitle("schedule a walk 19 weeks from today") === "walk",
    "digit nineteen-weeks phrase must drop out of the title"
  );
  assert(
    app.extractActionTitle("schedule a walk nineteen weeks from tomorrow") === "walk",
    "tomorrow phrase must drop out of the title"
  );
  assert(
    app.extractActionTitle("add an exposure to approach the store nineteen weeks from tonight") ===
      "approach the store",
    "exposure title must keep the target and drop the nineteen-weeks phrase"
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
      "add a 10 minute walk nineteen weeks from tonight"
    );
    assert(action && action.kind === "added_activation", "executeIntent must persist an activation");
    assert(
      localKey(action.a.scheduledFor) === nineteenFromTonight,
      `persisted local day must be ${nineteenFromTonight}, got ${localKey(action.a.scheduledFor)}`
    );
    assert(
      app.todayKey(new RealDate(action.a.scheduledFor)) === nineteenFromTonight,
      "todayKey of scheduledFor must match the requested local day (calendar marks/agenda)"
    );
    assert(localHour(action.a.scheduledFor) === 20, "persisted hour must stay 20:00 local");
    assert(action.a.title === "walk", `persisted title must be walk, got ${JSON.stringify(action.a.title)}`);
    assert(action.a.duration === 10, `duration must stay 10, got ${action.a.duration}`);
    assert(
      app.STATE.activations.some(
        (a) => a.title === "walk" && localKey(a.scheduledFor) === nineteenFromTonight
      ),
      "STATE.activations must contain the nineteen-weeks-from-tonight walk"
    );

    const todayAction = await app.executeIntent(
      "add_activation",
      "schedule a walk nineteen weeks from today"
    );
    assert(
      localKey(todayAction.a.scheduledFor) === nineteenFromToday &&
        localHour(todayAction.a.scheduledFor) === 10 &&
        todayAction.a.title === "walk",
      `persisted today-offset walk must be ${nineteenFromToday} at 10:00 titled walk, got ${todayAction.a.scheduledFor} ${todayAction.a.title}`
    );

    const tomorrowAction = await app.executeIntent(
      "add_activation",
      "schedule a walk nineteen weeks from tomorrow"
    );
    assert(
      localKey(tomorrowAction.a.scheduledFor) === nineteenFromTomorrow &&
        localHour(tomorrowAction.a.scheduledFor) === 10 &&
        tomorrowAction.a.title === "walk",
      `persisted tomorrow-offset walk must be ${nineteenFromTomorrow} at 10:00 titled walk, got ${tomorrowAction.a.scheduledFor} ${tomorrowAction.a.title}`
    );

    const exposure = await app.executeIntent(
      "add_exposure",
      "add an exposure to approach the store nineteen weeks from today"
    );
    assert(exposure && exposure.kind === "added_exposure", "exposure create must persist");
    assert(
      localKey(exposure.a.scheduledFor) === nineteenFromToday &&
        localHour(exposure.a.scheduledFor) === 10,
      `persisted exposure must be ${nineteenFromToday} at 10:00, got ${exposure.a.scheduledFor}`
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
    bundle.includes("function firstNineteenWeeksOffset"),
    "dist/BreakFree.html must include the nineteen-weeks-from-anchor guard"
  );

  console.log("OK extractWhen nineteen-weeks-from-anchor checks passed");
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
