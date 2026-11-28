/**
 * Regression: "twenty-three weeks from tonight/today/tomorrow" must schedule the
 * named offset, not the shorter token inside the phrase.
 *
 * extractWhen() tested /tonight/, then /tomorrow/, then /today/. Each token
 * sits inside the longer phrase, so on Sat Nov 28:
 *   "schedule a walk twenty-three weeks from tonight" persisted Nov 28 at 20:00
 *     instead of May 8 at 20:00
 *   "schedule a walk twenty-three weeks from today" persisted Nov 28 (now + 1 hour)
 *     instead of May 8 at 10:00
 *   "schedule a walk twenty-three weeks from tomorrow" persisted Nov 29 at 10:00
 *     instead of May 9 at 10:00
 * Calendar marks and that day's agenda then showed the step on the wrong
 * day. There is no edit UI. The same miss hit exposures.
 *
 * On Fri Nov 27 the same phrases persisted Nov 27 / Nov 28 instead of
 * May 7 at 20:00, May 7 at 10:00, and May 8 at 10:00.
 *
 * Offsets:
 *   twenty-three/23 weeks from tonight  → +161 local days at 20:00
 *   twenty-three/23 weeks from today    → +161 local days at 10:00
 *   twenty-three/23 weeks from tomorrow → +162 local days at 10:00
 *
 * A refused phrase must not win: "schedule a walk tonight, not twenty-three weeks
 * from tonight" stays tonight. "I can't tonight — schedule a walk twenty-three
 * weeks from tonight" stays one hundred sixty-one nights out.
 *
 * "next week", "in twenty-three weeks", "in twenty-two weeks", and "this weekend"
 * stay unscheduled. "twenty-two weeks from …" and "twenty-one weeks from …" stay
 * on the shorter token (their own drafts).
 *
 * Run from repo root:
 *   node scripts/check_extract_when_twenty_three_weeks.js
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
      `\nthis.extractWhen = extractWhen;\nthis.extractActionTitle = extractActionTitle;\nthis.executeIntent = executeIntent;\nthis.STATE = STATE;\nthis.todayKey = todayKey;\nthis.firstTwentyThreeWeeksOffset = firstTwentyThreeWeeksOffset;\n`,
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
    typeof app.firstTwentyThreeWeeksOffset === "function",
    "firstTwentyThreeWeeksOffset helper must exist"
  );

  const now = atLocal(2026, 10, 28, 15, 30); // Sat Nov 28, 2026, 15:30 local
  const today = "2026-11-28";
  const tomorrow = "2026-11-29";
  const twentyThreeFromTonight = "2027-05-08";
  const twentyThreeFromToday = "2027-05-08";
  const twentyThreeFromTomorrow = "2027-05-09";

  for (const text of [
    "schedule a walk twenty-three weeks from tonight",
    "plan a walk 23 weeks from tonight",
    "add a 10 minute walk for twenty-three weeks from tonight",
    "create an activation to walk twenty-three weeks from tonight",
    "Twenty-three weeks from tonight, schedule a walk",
    "schedule a walk in twenty-three weeks from tonight",
    "TWENTY-THREE WEEKS FROM TONIGHT schedule a walk"
  ]) {
    expectWhen(app, text, now, twentyThreeFromTonight, 20);
    assert(
      app.firstTwentyThreeWeeksOffset(text)?.anchor === "tonight",
      `positive tonight phrase must be recognized: ${text}`
    );
  }

  for (const text of [
    "schedule a walk twenty-three weeks from today",
    "plan a walk 23 weeks from today",
    "add a 10 minute walk for twenty-three weeks from today"
  ]) {
    expectWhen(app, text, now, twentyThreeFromToday, 10);
    assert(
      app.firstTwentyThreeWeeksOffset(text)?.anchor === "today",
      `positive today phrase must be recognized: ${text}`
    );
  }

  for (const text of [
    "schedule a walk twenty-three weeks from tomorrow",
    "plan a walk 23 weeks from tomorrow",
    "create an activation to walk twenty-three weeks from tomorrow"
  ]) {
    expectWhen(app, text, now, twentyThreeFromTomorrow, 10);
    assert(
      app.firstTwentyThreeWeeksOffset(text)?.anchor === "tomorrow",
      `positive tomorrow phrase must be recognized: ${text}`
    );
  }

  const exposureTonight = app.extractWhen(
    "add an exposure to approach the store twenty-three weeks from tonight",
    now
  );
  assert(
    localKey(exposureTonight) === twentyThreeFromTonight && localHour(exposureTonight) === 20,
    `exposure twenty-three-weeks-from-tonight must be ${twentyThreeFromTonight} at 20:00, got ${exposureTonight}`
  );
  const exposureToday = app.extractWhen(
    "add an exposure to approach the store twenty-three weeks from today",
    now
  );
  assert(
    localKey(exposureToday) === twentyThreeFromToday && localHour(exposureToday) === 10,
    `exposure twenty-three-weeks-from-today must be ${twentyThreeFromToday} at 10:00, got ${exposureToday}`
  );
  const exposureTomorrow = app.extractWhen(
    "add an exposure to approach the store twenty-three weeks from tomorrow",
    now
  );
  assert(
    localKey(exposureTomorrow) === twentyThreeFromTomorrow && localHour(exposureTomorrow) === 10,
    `exposure twenty-three-weeks-from-tomorrow must be ${twentyThreeFromTomorrow} at 10:00, got ${exposureTomorrow}`
  );

  expectWhen(app, "schedule a walk tonight", now, today, 20);
  expectWhen(app, "schedule a walk tomorrow", now, tomorrow, 10);
  expectWhen(app, "schedule a walk today", now, today, 16);

  assert(app.extractWhen("schedule a walk next week", now) == null, "next week stays unscheduled");
  assert(
    app.extractWhen("schedule a walk in twenty-three weeks", now) == null,
    "in twenty-three weeks stays unscheduled"
  );
  assert(
    app.extractWhen("schedule a walk in twenty-two weeks", now) == null,
    "in twenty-two weeks stays unscheduled"
  );
  assert(
    app.extractWhen("schedule a walk this weekend", now) == null,
    "this weekend stays unscheduled"
  );
  assert(
    localKey(app.extractWhen("schedule a walk twenty-two weeks from tonight", now)) === today &&
      localHour(app.extractWhen("schedule a walk twenty-two weeks from tonight", now)) === 20,
    "twenty-two weeks from tonight stays on the shorter tonight token"
  );
  assert(
    localKey(app.extractWhen("schedule a walk twenty-one weeks from tonight", now)) === today &&
      localHour(app.extractWhen("schedule a walk twenty-one weeks from tonight", now)) === 20,
    "twenty-one weeks from tonight stays on the shorter tonight token"
  );
  assert(
    localKey(app.extractWhen("schedule a walk two weeks from tonight", now)) === today &&
      localHour(app.extractWhen("schedule a walk two weeks from tonight", now)) === 20,
    "two weeks from tonight stays on the shorter tonight token"
  );
  assert(
    localKey(app.extractWhen("schedule a walk 123 weeks from tonight", now)) === today &&
      localHour(app.extractWhen("schedule a walk 123 weeks from tonight", now)) === 20,
    "123 weeks from tonight stays on the shorter tonight token"
  );
  assert(
    localKey(app.extractWhen("schedule a walk twenty three weeks from tonight", now)) === today &&
      localHour(app.extractWhen("schedule a walk twenty three weeks from tonight", now)) === 20,
    "spaced twenty three weeks from tonight stays on the shorter tonight token"
  );

  const refusedTonight = app.extractWhen(
    "schedule a walk tonight, not twenty-three weeks from tonight",
    now
  );
  assert(
    localKey(refusedTonight) === today && localHour(refusedTonight) === 20,
    `negated twenty-three-weeks-from-tonight must stay tonight, got ${refusedTonight}`
  );
  const refusedToday = app.extractWhen(
    "schedule a walk today, not twenty-three weeks from today",
    now
  );
  assert(
    localKey(refusedToday) === today && localHour(refusedToday) === 16,
    `negated twenty-three-weeks-from-today must stay today, got ${refusedToday}`
  );
  const refusedTomorrow = app.extractWhen(
    "schedule a walk tomorrow, not twenty-three weeks from tomorrow",
    now
  );
  assert(
    localKey(refusedTomorrow) === tomorrow && localHour(refusedTomorrow) === 10,
    `negated twenty-three-weeks-from-tomorrow must stay tomorrow, got ${refusedTomorrow}`
  );
  const refusedOtherNight = app.extractWhen(
    "schedule a walk tomorrow, not twenty-three weeks from tonight",
    now
  );
  assert(
    localKey(refusedOtherNight) === tomorrow && localHour(refusedOtherNight) === 10,
    `negated phrase must not steal tomorrow, got ${refusedOtherNight}`
  );
  const refusedCurly = app.extractWhen(
    "schedule a walk tonight. I can\u2019t do it twenty-three weeks from tonight",
    now
  );
  assert(
    localKey(refusedCurly) === today && localHour(refusedCurly) === 20,
    `curly-apostrophe can't-do must stay tonight, got ${refusedCurly}`
  );
  assert(
    app.firstTwentyThreeWeeksOffset("I can\u2019t twenty-three weeks from tonight") == null,
    "curly-apostrophe can't immediately before the phrase is a refusal"
  );
  assert(
    app.firstTwentyThreeWeeksOffset("not 23 weeks from today") == null,
    "digit refusal must not count as a request"
  );

  const cantTonight = app.extractWhen(
    "I can't tonight — schedule a walk twenty-three weeks from tonight",
    now
  );
  assert(
    localKey(cantTonight) === twentyThreeFromTonight && localHour(cantTonight) === 20,
    `can't tonight + twenty-three weeks from tonight must be ${twentyThreeFromTonight} at 20:00, got ${cantTonight}`
  );
  const cantToday = app.extractWhen(
    "I can't today — schedule a walk twenty-three weeks from today",
    now
  );
  assert(
    localKey(cantToday) === twentyThreeFromToday && localHour(cantToday) === 10,
    `can't today + twenty-three weeks from today must be ${twentyThreeFromToday} at 10:00, got ${cantToday}`
  );
  const cantTomorrow = app.extractWhen(
    "I can't tomorrow — schedule a walk twenty-three weeks from tomorrow",
    now
  );
  assert(
    localKey(cantTomorrow) === twentyThreeFromTomorrow && localHour(cantTomorrow) === 10,
    `can't tomorrow + twenty-three weeks from tomorrow must be ${twentyThreeFromTomorrow} at 10:00, got ${cantTomorrow}`
  );

  const onlyNegated = app.extractWhen("schedule a walk, not twenty-three weeks from tonight", now);
  assert(
    onlyNegated == null,
    `a refused twenty-three-weeks phrase with no other day must stay unscheduled, got ${onlyNegated}`
  );

  const laterPositive = app.extractWhen(
    "not twenty-three weeks from tonight. schedule a walk twenty-three weeks from tomorrow",
    now
  );
  assert(
    localKey(laterPositive) === twentyThreeFromTomorrow && localHour(laterPositive) === 10,
    `a later positive phrase must win, got ${laterPositive}`
  );
  assert(
    app.firstTwentyThreeWeeksOffset(
      "schedule a walk twenty-three weeks from today, not twenty-three weeks from tomorrow"
    )?.anchor === "today",
    "the first positive anchor wins when a later one is refused"
  );

  const late = atLocal(2026, 10, 28, 23, 30);
  expectWhen(app, "schedule a walk twenty-three weeks from today", late, twentyThreeFromToday, 10);
  expectWhen(app, "schedule a walk twenty-three weeks from tonight", late, twentyThreeFromTonight, 20);

  const priorFriday = atLocal(2026, 10, 27, 15, 30);
  expectWhen(app, "schedule a walk twenty-three weeks from tonight", priorFriday, "2027-05-07", 20);
  expectWhen(app, "schedule a walk twenty-three weeks from today", priorFriday, "2027-05-07", 10);
  expectWhen(app, "schedule a walk twenty-three weeks from tomorrow", priorFriday, "2027-05-08", 10);

  const priorThursday = atLocal(2026, 10, 26, 15, 30);
  expectWhen(app, "schedule a walk twenty-three weeks from tonight", priorThursday, "2027-05-06", 20);
  expectWhen(app, "schedule a walk twenty-three weeks from today", priorThursday, "2027-05-06", 10);
  expectWhen(app, "schedule a walk twenty-three weeks from tomorrow", priorThursday, "2027-05-07", 10);

  const monthEnd = atLocal(2026, 11, 31, 21, 0); // Thu Dec 31, after 20:00
  expectWhen(app, "schedule a walk twenty-three weeks from tonight", monthEnd, "2027-06-10", 20);
  expectWhen(app, "schedule a walk twenty-three weeks from tomorrow", monthEnd, "2027-06-11", 10);
  assert(
    localKey(app.extractWhen("schedule a walk 23 weeks from today", atLocal(2027, 0, 31, 8, 0))) ===
      "2027-07-11",
    "Jan 31 + 161 days must be Jul 11"
  );
  assert(
    localKey(app.extractWhen("schedule a walk 23 weeks from tomorrow", atLocal(2027, 0, 31, 8, 0))) ===
      "2027-07-12",
    "Jan 31 + 162 days must be Jul 12"
  );

  assert(
    app.extractActionTitle("schedule a walk twenty-three weeks from tonight") === "walk",
    `title must stay walk, got ${JSON.stringify(app.extractActionTitle("schedule a walk twenty-three weeks from tonight"))}`
  );
  assert(
    app.extractActionTitle("schedule a walk 23 weeks from today") === "walk",
    "digit twenty-three-weeks phrase must drop out of the title"
  );
  assert(
    app.extractActionTitle("schedule a walk twenty-three weeks from tomorrow") === "walk",
    "tomorrow phrase must drop out of the title"
  );
  assert(
    app.extractActionTitle("add an exposure to approach the store twenty-three weeks from tonight") ===
      "approach the store",
    "exposure title must keep the target and drop the twenty-three-weeks phrase"
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
      "add a 10 minute walk twenty-three weeks from tonight"
    );
    assert(action && action.kind === "added_activation", "executeIntent must persist an activation");
    assert(
      localKey(action.a.scheduledFor) === twentyThreeFromTonight,
      `persisted local day must be ${twentyThreeFromTonight}, got ${localKey(action.a.scheduledFor)}`
    );
    assert(
      app.todayKey(new RealDate(action.a.scheduledFor)) === twentyThreeFromTonight,
      "todayKey of scheduledFor must match the requested local day (calendar marks/agenda)"
    );
    assert(localHour(action.a.scheduledFor) === 20, "persisted hour must stay 20:00 local");
    assert(action.a.title === "walk", `persisted title must be walk, got ${JSON.stringify(action.a.title)}`);
    assert(action.a.duration === 10, `duration must stay 10, got ${action.a.duration}`);
    assert(
      app.STATE.activations.some(
        (a) => a.title === "walk" && localKey(a.scheduledFor) === twentyThreeFromTonight
      ),
      "STATE.activations must contain the twenty-three-weeks-from-tonight walk"
    );

    const todayAction = await app.executeIntent(
      "add_activation",
      "schedule a walk twenty-three weeks from today"
    );
    assert(
      localKey(todayAction.a.scheduledFor) === twentyThreeFromToday &&
        localHour(todayAction.a.scheduledFor) === 10 &&
        todayAction.a.title === "walk",
      `persisted today-offset walk must be ${twentyThreeFromToday} at 10:00 titled walk, got ${todayAction.a.scheduledFor} ${todayAction.a.title}`
    );

    const tomorrowAction = await app.executeIntent(
      "add_activation",
      "schedule a walk twenty-three weeks from tomorrow"
    );
    assert(
      localKey(tomorrowAction.a.scheduledFor) === twentyThreeFromTomorrow &&
        localHour(tomorrowAction.a.scheduledFor) === 10 &&
        tomorrowAction.a.title === "walk",
      `persisted tomorrow-offset walk must be ${twentyThreeFromTomorrow} at 10:00 titled walk, got ${tomorrowAction.a.scheduledFor} ${tomorrowAction.a.title}`
    );

    const exposure = await app.executeIntent(
      "add_exposure",
      "add an exposure to approach the store twenty-three weeks from today"
    );
    assert(exposure && exposure.kind === "added_exposure", "exposure create must persist");
    assert(
      localKey(exposure.a.scheduledFor) === twentyThreeFromToday &&
        localHour(exposure.a.scheduledFor) === 10,
      `persisted exposure must be ${twentyThreeFromToday} at 10:00, got ${exposure.a.scheduledFor}`
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
    bundle.includes("function firstTwentyThreeWeeksOffset"),
    "dist/BreakFree.html must include the twenty-three-weeks-from-anchor guard"
  );

  console.log("OK extractWhen twenty-three-weeks-from-anchor checks passed");
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
