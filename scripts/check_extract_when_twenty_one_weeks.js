/**
 * Regression: "twenty-one weeks from tonight/today/tomorrow" must schedule the
 * named offset, not the shorter token inside the phrase.
 *
 * extractWhen() tested /tonight/, then /tomorrow/, then /today/. Each token
 * sits inside the longer phrase, so on Thu Nov 26:
 *   "schedule a walk twenty-one weeks from tonight" persisted Nov 26 at 20:00
 *     instead of Apr 22 at 20:00
 *   "schedule a walk twenty-one weeks from today" persisted Nov 26 (now + 1 hour)
 *     instead of Apr 22 at 10:00
 *   "schedule a walk twenty-one weeks from tomorrow" persisted Nov 27 at 10:00
 *     instead of Apr 23 at 10:00
 * Calendar marks and that day's agenda then showed the step on the wrong
 * day. There is no edit UI. The same miss hit exposures.
 *
 * Offsets:
 *   twenty-one/21 weeks from tonight  → +147 local days at 20:00
 *   twenty-one/21 weeks from today    → +147 local days at 10:00
 *   twenty-one/21 weeks from tomorrow → +148 local days at 10:00
 *
 * A refused phrase must not win: "schedule a walk tonight, not twenty-one weeks
 * from tonight" stays tonight. "I can't tonight — schedule a walk twenty-one
 * weeks from tonight" stays one hundred forty-seven nights out.
 *
 * "next week", "in twenty-one weeks", "in twenty weeks", and "this weekend"
 * stay unscheduled. "twenty weeks from …" stays on the shorter token (its
 * own draft).
 *
 * Run from repo root:
 *   node scripts/check_extract_when_twenty_one_weeks.js
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
      `\nthis.extractWhen = extractWhen;\nthis.extractActionTitle = extractActionTitle;\nthis.executeIntent = executeIntent;\nthis.STATE = STATE;\nthis.todayKey = todayKey;\nthis.firstTwentyOneWeeksOffset = firstTwentyOneWeeksOffset;\n`,
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
    typeof app.firstTwentyOneWeeksOffset === "function",
    "firstTwentyOneWeeksOffset helper must exist"
  );

  const now = atLocal(2026, 10, 26, 15, 30); // Thu Nov 26, 2026, 15:30 local
  const today = "2026-11-26";
  const tomorrow = "2026-11-27";
  const twentyOneFromTonight = "2027-04-22";
  const twentyOneFromToday = "2027-04-22";
  const twentyOneFromTomorrow = "2027-04-23";

  for (const text of [
    "schedule a walk twenty-one weeks from tonight",
    "plan a walk 21 weeks from tonight",
    "add a 10 minute walk for twenty-one weeks from tonight",
    "create an activation to walk twenty-one weeks from tonight",
    "Twenty-one weeks from tonight, schedule a walk",
    "schedule a walk in twenty-one weeks from tonight",
    "TWENTY-ONE WEEKS FROM TONIGHT schedule a walk"
  ]) {
    expectWhen(app, text, now, twentyOneFromTonight, 20);
    assert(
      app.firstTwentyOneWeeksOffset(text)?.anchor === "tonight",
      `positive tonight phrase must be recognized: ${text}`
    );
  }

  for (const text of [
    "schedule a walk twenty-one weeks from today",
    "plan a walk 21 weeks from today",
    "add a 10 minute walk for twenty-one weeks from today"
  ]) {
    expectWhen(app, text, now, twentyOneFromToday, 10);
    assert(
      app.firstTwentyOneWeeksOffset(text)?.anchor === "today",
      `positive today phrase must be recognized: ${text}`
    );
  }

  for (const text of [
    "schedule a walk twenty-one weeks from tomorrow",
    "plan a walk 21 weeks from tomorrow",
    "create an activation to walk twenty-one weeks from tomorrow"
  ]) {
    expectWhen(app, text, now, twentyOneFromTomorrow, 10);
    assert(
      app.firstTwentyOneWeeksOffset(text)?.anchor === "tomorrow",
      `positive tomorrow phrase must be recognized: ${text}`
    );
  }

  const exposureTonight = app.extractWhen(
    "add an exposure to approach the store twenty-one weeks from tonight",
    now
  );
  assert(
    localKey(exposureTonight) === twentyOneFromTonight && localHour(exposureTonight) === 20,
    `exposure twenty-one-weeks-from-tonight must be ${twentyOneFromTonight} at 20:00, got ${exposureTonight}`
  );
  const exposureToday = app.extractWhen(
    "add an exposure to approach the store twenty-one weeks from today",
    now
  );
  assert(
    localKey(exposureToday) === twentyOneFromToday && localHour(exposureToday) === 10,
    `exposure twenty-one-weeks-from-today must be ${twentyOneFromToday} at 10:00, got ${exposureToday}`
  );
  const exposureTomorrow = app.extractWhen(
    "add an exposure to approach the store twenty-one weeks from tomorrow",
    now
  );
  assert(
    localKey(exposureTomorrow) === twentyOneFromTomorrow && localHour(exposureTomorrow) === 10,
    `exposure twenty-one-weeks-from-tomorrow must be ${twentyOneFromTomorrow} at 10:00, got ${exposureTomorrow}`
  );

  expectWhen(app, "schedule a walk tonight", now, today, 20);
  expectWhen(app, "schedule a walk tomorrow", now, tomorrow, 10);
  expectWhen(app, "schedule a walk today", now, today, 16);

  assert(app.extractWhen("schedule a walk next week", now) == null, "next week stays unscheduled");
  assert(
    app.extractWhen("schedule a walk in twenty-one weeks", now) == null,
    "in twenty-one weeks stays unscheduled"
  );
  assert(
    app.extractWhen("schedule a walk in twenty weeks", now) == null,
    "in twenty weeks stays unscheduled"
  );
  assert(
    app.extractWhen("schedule a walk this weekend", now) == null,
    "this weekend stays unscheduled"
  );
  assert(
    localKey(app.extractWhen("schedule a walk twenty weeks from tonight", now)) === today &&
      localHour(app.extractWhen("schedule a walk twenty weeks from tonight", now)) === 20,
    "twenty weeks from tonight stays on the shorter tonight token"
  );
  assert(
    localKey(app.extractWhen("schedule a walk two weeks from tonight", now)) === today &&
      localHour(app.extractWhen("schedule a walk two weeks from tonight", now)) === 20,
    "two weeks from tonight stays on the shorter tonight token"
  );
  assert(
    localKey(app.extractWhen("schedule a walk 121 weeks from tonight", now)) === today &&
      localHour(app.extractWhen("schedule a walk 121 weeks from tonight", now)) === 20,
    "121 weeks from tonight stays on the shorter tonight token"
  );
  assert(
    localKey(app.extractWhen("schedule a walk twenty one weeks from tonight", now)) === today &&
      localHour(app.extractWhen("schedule a walk twenty one weeks from tonight", now)) === 20,
    "spaced twenty one weeks from tonight stays on the shorter tonight token"
  );

  const refusedTonight = app.extractWhen(
    "schedule a walk tonight, not twenty-one weeks from tonight",
    now
  );
  assert(
    localKey(refusedTonight) === today && localHour(refusedTonight) === 20,
    `negated twenty-one-weeks-from-tonight must stay tonight, got ${refusedTonight}`
  );
  const refusedToday = app.extractWhen(
    "schedule a walk today, not twenty-one weeks from today",
    now
  );
  assert(
    localKey(refusedToday) === today && localHour(refusedToday) === 16,
    `negated twenty-one-weeks-from-today must stay today, got ${refusedToday}`
  );
  const refusedTomorrow = app.extractWhen(
    "schedule a walk tomorrow, not twenty-one weeks from tomorrow",
    now
  );
  assert(
    localKey(refusedTomorrow) === tomorrow && localHour(refusedTomorrow) === 10,
    `negated twenty-one-weeks-from-tomorrow must stay tomorrow, got ${refusedTomorrow}`
  );
  const refusedOtherNight = app.extractWhen(
    "schedule a walk tomorrow, not twenty-one weeks from tonight",
    now
  );
  assert(
    localKey(refusedOtherNight) === tomorrow && localHour(refusedOtherNight) === 10,
    `negated phrase must not steal tomorrow, got ${refusedOtherNight}`
  );
  const refusedCurly = app.extractWhen(
    "schedule a walk tonight. I can\u2019t do it twenty-one weeks from tonight",
    now
  );
  assert(
    localKey(refusedCurly) === today && localHour(refusedCurly) === 20,
    `curly-apostrophe can't-do must stay tonight, got ${refusedCurly}`
  );
  assert(
    app.firstTwentyOneWeeksOffset("I can\u2019t twenty-one weeks from tonight") == null,
    "curly-apostrophe can't immediately before the phrase is a refusal"
  );
  assert(
    app.firstTwentyOneWeeksOffset("not 21 weeks from today") == null,
    "digit refusal must not count as a request"
  );

  const cantTonight = app.extractWhen(
    "I can't tonight — schedule a walk twenty-one weeks from tonight",
    now
  );
  assert(
    localKey(cantTonight) === twentyOneFromTonight && localHour(cantTonight) === 20,
    `can't tonight + twenty-one weeks from tonight must be ${twentyOneFromTonight} at 20:00, got ${cantTonight}`
  );
  const cantToday = app.extractWhen(
    "I can't today — schedule a walk twenty-one weeks from today",
    now
  );
  assert(
    localKey(cantToday) === twentyOneFromToday && localHour(cantToday) === 10,
    `can't today + twenty-one weeks from today must be ${twentyOneFromToday} at 10:00, got ${cantToday}`
  );
  const cantTomorrow = app.extractWhen(
    "I can't tomorrow — schedule a walk twenty-one weeks from tomorrow",
    now
  );
  assert(
    localKey(cantTomorrow) === twentyOneFromTomorrow && localHour(cantTomorrow) === 10,
    `can't tomorrow + twenty-one weeks from tomorrow must be ${twentyOneFromTomorrow} at 10:00, got ${cantTomorrow}`
  );

  const onlyNegated = app.extractWhen("schedule a walk, not twenty-one weeks from tonight", now);
  assert(
    onlyNegated == null,
    `a refused twenty-one-weeks phrase with no other day must stay unscheduled, got ${onlyNegated}`
  );

  const laterPositive = app.extractWhen(
    "not twenty-one weeks from tonight. schedule a walk twenty-one weeks from tomorrow",
    now
  );
  assert(
    localKey(laterPositive) === twentyOneFromTomorrow && localHour(laterPositive) === 10,
    `a later positive phrase must win, got ${laterPositive}`
  );
  assert(
    app.firstTwentyOneWeeksOffset(
      "schedule a walk twenty-one weeks from today, not twenty-one weeks from tomorrow"
    )?.anchor === "today",
    "the first positive anchor wins when a later one is refused"
  );

  const late = atLocal(2026, 10, 26, 23, 30);
  expectWhen(app, "schedule a walk twenty-one weeks from today", late, twentyOneFromToday, 10);
  expectWhen(app, "schedule a walk twenty-one weeks from tonight", late, twentyOneFromTonight, 20);

  const priorWednesday = atLocal(2026, 10, 25, 15, 30);
  expectWhen(app, "schedule a walk twenty-one weeks from tonight", priorWednesday, "2027-04-21", 20);
  expectWhen(app, "schedule a walk twenty-one weeks from today", priorWednesday, "2027-04-21", 10);
  expectWhen(app, "schedule a walk twenty-one weeks from tomorrow", priorWednesday, "2027-04-22", 10);

  const monthEnd = atLocal(2026, 11, 31, 21, 0); // Thu Dec 31, after 20:00
  expectWhen(app, "schedule a walk twenty-one weeks from tonight", monthEnd, "2027-05-27", 20);
  expectWhen(app, "schedule a walk twenty-one weeks from tomorrow", monthEnd, "2027-05-28", 10);
  assert(
    localKey(app.extractWhen("schedule a walk 21 weeks from today", atLocal(2027, 0, 31, 8, 0))) ===
      "2027-06-27",
    "Jan 31 + 147 days must be Jun 27"
  );
  assert(
    localKey(app.extractWhen("schedule a walk 21 weeks from tomorrow", atLocal(2027, 0, 31, 8, 0))) ===
      "2027-06-28",
    "Jan 31 + 148 days must be Jun 28"
  );

  assert(
    app.extractActionTitle("schedule a walk twenty-one weeks from tonight") === "walk",
    `title must stay walk, got ${JSON.stringify(app.extractActionTitle("schedule a walk twenty-one weeks from tonight"))}`
  );
  assert(
    app.extractActionTitle("schedule a walk 21 weeks from today") === "walk",
    "digit twenty-one-weeks phrase must drop out of the title"
  );
  assert(
    app.extractActionTitle("schedule a walk twenty-one weeks from tomorrow") === "walk",
    "tomorrow phrase must drop out of the title"
  );
  assert(
    app.extractActionTitle("add an exposure to approach the store twenty-one weeks from tonight") ===
      "approach the store",
    "exposure title must keep the target and drop the twenty-one-weeks phrase"
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
      "add a 10 minute walk twenty-one weeks from tonight"
    );
    assert(action && action.kind === "added_activation", "executeIntent must persist an activation");
    assert(
      localKey(action.a.scheduledFor) === twentyOneFromTonight,
      `persisted local day must be ${twentyOneFromTonight}, got ${localKey(action.a.scheduledFor)}`
    );
    assert(
      app.todayKey(new RealDate(action.a.scheduledFor)) === twentyOneFromTonight,
      "todayKey of scheduledFor must match the requested local day (calendar marks/agenda)"
    );
    assert(localHour(action.a.scheduledFor) === 20, "persisted hour must stay 20:00 local");
    assert(action.a.title === "walk", `persisted title must be walk, got ${JSON.stringify(action.a.title)}`);
    assert(action.a.duration === 10, `duration must stay 10, got ${action.a.duration}`);
    assert(
      app.STATE.activations.some(
        (a) => a.title === "walk" && localKey(a.scheduledFor) === twentyOneFromTonight
      ),
      "STATE.activations must contain the twenty-one-weeks-from-tonight walk"
    );

    const todayAction = await app.executeIntent(
      "add_activation",
      "schedule a walk twenty-one weeks from today"
    );
    assert(
      localKey(todayAction.a.scheduledFor) === twentyOneFromToday &&
        localHour(todayAction.a.scheduledFor) === 10 &&
        todayAction.a.title === "walk",
      `persisted today-offset walk must be ${twentyOneFromToday} at 10:00 titled walk, got ${todayAction.a.scheduledFor} ${todayAction.a.title}`
    );

    const tomorrowAction = await app.executeIntent(
      "add_activation",
      "schedule a walk twenty-one weeks from tomorrow"
    );
    assert(
      localKey(tomorrowAction.a.scheduledFor) === twentyOneFromTomorrow &&
        localHour(tomorrowAction.a.scheduledFor) === 10 &&
        tomorrowAction.a.title === "walk",
      `persisted tomorrow-offset walk must be ${twentyOneFromTomorrow} at 10:00 titled walk, got ${tomorrowAction.a.scheduledFor} ${tomorrowAction.a.title}`
    );

    const exposure = await app.executeIntent(
      "add_exposure",
      "add an exposure to approach the store twenty-one weeks from today"
    );
    assert(exposure && exposure.kind === "added_exposure", "exposure create must persist");
    assert(
      localKey(exposure.a.scheduledFor) === twentyOneFromToday &&
        localHour(exposure.a.scheduledFor) === 10,
      `persisted exposure must be ${twentyOneFromToday} at 10:00, got ${exposure.a.scheduledFor}`
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
    bundle.includes("function firstTwentyOneWeeksOffset"),
    "dist/BreakFree.html must include the twenty-one-weeks-from-anchor guard"
  );

  console.log("OK extractWhen twenty-one-weeks-from-anchor checks passed");
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
