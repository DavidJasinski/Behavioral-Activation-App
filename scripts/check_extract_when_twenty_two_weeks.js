/**
 * Regression: "twenty-two weeks from tonight/today/tomorrow" must schedule the
 * named offset, not the shorter token inside the phrase.
 *
 * extractWhen() tested /tonight/, then /tomorrow/, then /today/. Each token
 * sits inside the longer phrase, so on Fri Nov 27:
 *   "schedule a walk twenty-two weeks from tonight" persisted Nov 27 at 20:00
 *     instead of Apr 30 at 20:00
 *   "schedule a walk twenty-two weeks from today" persisted Nov 27 (now + 1 hour)
 *     instead of Apr 30 at 10:00
 *   "schedule a walk twenty-two weeks from tomorrow" persisted Nov 28 at 10:00
 *     instead of May 1 at 10:00
 * Calendar marks and that day's agenda then showed the step on the wrong
 * day. There is no edit UI. The same miss hit exposures.
 *
 * On Thu Nov 26 the same phrases persisted Nov 26 / Nov 27 instead of
 * Apr 29 at 20:00, Apr 29 at 10:00, and Apr 30 at 10:00.
 *
 * Offsets:
 *   twenty-two/22 weeks from tonight  → +154 local days at 20:00
 *   twenty-two/22 weeks from today    → +154 local days at 10:00
 *   twenty-two/22 weeks from tomorrow → +155 local days at 10:00
 *
 * A refused phrase must not win: "schedule a walk tonight, not twenty-two weeks
 * from tonight" stays tonight. "I can't tonight — schedule a walk twenty-two
 * weeks from tonight" stays one hundred fifty-four nights out.
 *
 * "next week", "in twenty-two weeks", "in twenty-one weeks", and "this weekend"
 * stay unscheduled. "twenty-one weeks from …" and "twenty weeks from …" stay
 * on the shorter token (their own drafts).
 *
 * Run from repo root:
 *   node scripts/check_extract_when_twenty_two_weeks.js
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
      `\nthis.extractWhen = extractWhen;\nthis.extractActionTitle = extractActionTitle;\nthis.executeIntent = executeIntent;\nthis.STATE = STATE;\nthis.todayKey = todayKey;\nthis.firstTwentyTwoWeeksOffset = firstTwentyTwoWeeksOffset;\n`,
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
    typeof app.firstTwentyTwoWeeksOffset === "function",
    "firstTwentyTwoWeeksOffset helper must exist"
  );

  const now = atLocal(2026, 10, 27, 15, 30); // Fri Nov 27, 2026, 15:30 local
  const today = "2026-11-27";
  const tomorrow = "2026-11-28";
  const twentyTwoFromTonight = "2027-04-30";
  const twentyTwoFromToday = "2027-04-30";
  const twentyTwoFromTomorrow = "2027-05-01";

  for (const text of [
    "schedule a walk twenty-two weeks from tonight",
    "plan a walk 22 weeks from tonight",
    "add a 10 minute walk for twenty-two weeks from tonight",
    "create an activation to walk twenty-two weeks from tonight",
    "Twenty-two weeks from tonight, schedule a walk",
    "schedule a walk in twenty-two weeks from tonight",
    "TWENTY-TWO WEEKS FROM TONIGHT schedule a walk"
  ]) {
    expectWhen(app, text, now, twentyTwoFromTonight, 20);
    assert(
      app.firstTwentyTwoWeeksOffset(text)?.anchor === "tonight",
      `positive tonight phrase must be recognized: ${text}`
    );
  }

  for (const text of [
    "schedule a walk twenty-two weeks from today",
    "plan a walk 22 weeks from today",
    "add a 10 minute walk for twenty-two weeks from today"
  ]) {
    expectWhen(app, text, now, twentyTwoFromToday, 10);
    assert(
      app.firstTwentyTwoWeeksOffset(text)?.anchor === "today",
      `positive today phrase must be recognized: ${text}`
    );
  }

  for (const text of [
    "schedule a walk twenty-two weeks from tomorrow",
    "plan a walk 22 weeks from tomorrow",
    "create an activation to walk twenty-two weeks from tomorrow"
  ]) {
    expectWhen(app, text, now, twentyTwoFromTomorrow, 10);
    assert(
      app.firstTwentyTwoWeeksOffset(text)?.anchor === "tomorrow",
      `positive tomorrow phrase must be recognized: ${text}`
    );
  }

  const exposureTonight = app.extractWhen(
    "add an exposure to approach the store twenty-two weeks from tonight",
    now
  );
  assert(
    localKey(exposureTonight) === twentyTwoFromTonight && localHour(exposureTonight) === 20,
    `exposure twenty-two-weeks-from-tonight must be ${twentyTwoFromTonight} at 20:00, got ${exposureTonight}`
  );
  const exposureToday = app.extractWhen(
    "add an exposure to approach the store twenty-two weeks from today",
    now
  );
  assert(
    localKey(exposureToday) === twentyTwoFromToday && localHour(exposureToday) === 10,
    `exposure twenty-two-weeks-from-today must be ${twentyTwoFromToday} at 10:00, got ${exposureToday}`
  );
  const exposureTomorrow = app.extractWhen(
    "add an exposure to approach the store twenty-two weeks from tomorrow",
    now
  );
  assert(
    localKey(exposureTomorrow) === twentyTwoFromTomorrow && localHour(exposureTomorrow) === 10,
    `exposure twenty-two-weeks-from-tomorrow must be ${twentyTwoFromTomorrow} at 10:00, got ${exposureTomorrow}`
  );

  expectWhen(app, "schedule a walk tonight", now, today, 20);
  expectWhen(app, "schedule a walk tomorrow", now, tomorrow, 10);
  expectWhen(app, "schedule a walk today", now, today, 16);

  assert(app.extractWhen("schedule a walk next week", now) == null, "next week stays unscheduled");
  assert(
    app.extractWhen("schedule a walk in twenty-two weeks", now) == null,
    "in twenty-two weeks stays unscheduled"
  );
  assert(
    app.extractWhen("schedule a walk in twenty-one weeks", now) == null,
    "in twenty-one weeks stays unscheduled"
  );
  assert(
    app.extractWhen("schedule a walk this weekend", now) == null,
    "this weekend stays unscheduled"
  );
  assert(
    localKey(app.extractWhen("schedule a walk twenty-one weeks from tonight", now)) === today &&
      localHour(app.extractWhen("schedule a walk twenty-one weeks from tonight", now)) === 20,
    "twenty-one weeks from tonight stays on the shorter tonight token"
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
    localKey(app.extractWhen("schedule a walk 122 weeks from tonight", now)) === today &&
      localHour(app.extractWhen("schedule a walk 122 weeks from tonight", now)) === 20,
    "122 weeks from tonight stays on the shorter tonight token"
  );
  assert(
    localKey(app.extractWhen("schedule a walk twenty two weeks from tonight", now)) === today &&
      localHour(app.extractWhen("schedule a walk twenty two weeks from tonight", now)) === 20,
    "spaced twenty two weeks from tonight stays on the shorter tonight token"
  );

  const refusedTonight = app.extractWhen(
    "schedule a walk tonight, not twenty-two weeks from tonight",
    now
  );
  assert(
    localKey(refusedTonight) === today && localHour(refusedTonight) === 20,
    `negated twenty-two-weeks-from-tonight must stay tonight, got ${refusedTonight}`
  );
  const refusedToday = app.extractWhen(
    "schedule a walk today, not twenty-two weeks from today",
    now
  );
  assert(
    localKey(refusedToday) === today && localHour(refusedToday) === 16,
    `negated twenty-two-weeks-from-today must stay today, got ${refusedToday}`
  );
  const refusedTomorrow = app.extractWhen(
    "schedule a walk tomorrow, not twenty-two weeks from tomorrow",
    now
  );
  assert(
    localKey(refusedTomorrow) === tomorrow && localHour(refusedTomorrow) === 10,
    `negated twenty-two-weeks-from-tomorrow must stay tomorrow, got ${refusedTomorrow}`
  );
  const refusedOtherNight = app.extractWhen(
    "schedule a walk tomorrow, not twenty-two weeks from tonight",
    now
  );
  assert(
    localKey(refusedOtherNight) === tomorrow && localHour(refusedOtherNight) === 10,
    `negated phrase must not steal tomorrow, got ${refusedOtherNight}`
  );
  const refusedCurly = app.extractWhen(
    "schedule a walk tonight. I can\u2019t do it twenty-two weeks from tonight",
    now
  );
  assert(
    localKey(refusedCurly) === today && localHour(refusedCurly) === 20,
    `curly-apostrophe can't-do must stay tonight, got ${refusedCurly}`
  );
  assert(
    app.firstTwentyTwoWeeksOffset("I can\u2019t twenty-two weeks from tonight") == null,
    "curly-apostrophe can't immediately before the phrase is a refusal"
  );
  assert(
    app.firstTwentyTwoWeeksOffset("not 22 weeks from today") == null,
    "digit refusal must not count as a request"
  );

  const cantTonight = app.extractWhen(
    "I can't tonight — schedule a walk twenty-two weeks from tonight",
    now
  );
  assert(
    localKey(cantTonight) === twentyTwoFromTonight && localHour(cantTonight) === 20,
    `can't tonight + twenty-two weeks from tonight must be ${twentyTwoFromTonight} at 20:00, got ${cantTonight}`
  );
  const cantToday = app.extractWhen(
    "I can't today — schedule a walk twenty-two weeks from today",
    now
  );
  assert(
    localKey(cantToday) === twentyTwoFromToday && localHour(cantToday) === 10,
    `can't today + twenty-two weeks from today must be ${twentyTwoFromToday} at 10:00, got ${cantToday}`
  );
  const cantTomorrow = app.extractWhen(
    "I can't tomorrow — schedule a walk twenty-two weeks from tomorrow",
    now
  );
  assert(
    localKey(cantTomorrow) === twentyTwoFromTomorrow && localHour(cantTomorrow) === 10,
    `can't tomorrow + twenty-two weeks from tomorrow must be ${twentyTwoFromTomorrow} at 10:00, got ${cantTomorrow}`
  );

  const onlyNegated = app.extractWhen("schedule a walk, not twenty-two weeks from tonight", now);
  assert(
    onlyNegated == null,
    `a refused twenty-two-weeks phrase with no other day must stay unscheduled, got ${onlyNegated}`
  );

  const laterPositive = app.extractWhen(
    "not twenty-two weeks from tonight. schedule a walk twenty-two weeks from tomorrow",
    now
  );
  assert(
    localKey(laterPositive) === twentyTwoFromTomorrow && localHour(laterPositive) === 10,
    `a later positive phrase must win, got ${laterPositive}`
  );
  assert(
    app.firstTwentyTwoWeeksOffset(
      "schedule a walk twenty-two weeks from today, not twenty-two weeks from tomorrow"
    )?.anchor === "today",
    "the first positive anchor wins when a later one is refused"
  );

  const late = atLocal(2026, 10, 27, 23, 30);
  expectWhen(app, "schedule a walk twenty-two weeks from today", late, twentyTwoFromToday, 10);
  expectWhen(app, "schedule a walk twenty-two weeks from tonight", late, twentyTwoFromTonight, 20);

  const priorThursday = atLocal(2026, 10, 26, 15, 30);
  expectWhen(app, "schedule a walk twenty-two weeks from tonight", priorThursday, "2027-04-29", 20);
  expectWhen(app, "schedule a walk twenty-two weeks from today", priorThursday, "2027-04-29", 10);
  expectWhen(app, "schedule a walk twenty-two weeks from tomorrow", priorThursday, "2027-04-30", 10);

  const priorWednesday = atLocal(2026, 10, 25, 15, 30);
  expectWhen(app, "schedule a walk twenty-two weeks from tonight", priorWednesday, "2027-04-28", 20);
  expectWhen(app, "schedule a walk twenty-two weeks from today", priorWednesday, "2027-04-28", 10);
  expectWhen(app, "schedule a walk twenty-two weeks from tomorrow", priorWednesday, "2027-04-29", 10);

  const monthEnd = atLocal(2026, 11, 31, 21, 0); // Thu Dec 31, after 20:00
  expectWhen(app, "schedule a walk twenty-two weeks from tonight", monthEnd, "2027-06-03", 20);
  expectWhen(app, "schedule a walk twenty-two weeks from tomorrow", monthEnd, "2027-06-04", 10);
  assert(
    localKey(app.extractWhen("schedule a walk 22 weeks from today", atLocal(2027, 0, 31, 8, 0))) ===
      "2027-07-04",
    "Jan 31 + 154 days must be Jul 4"
  );
  assert(
    localKey(app.extractWhen("schedule a walk 22 weeks from tomorrow", atLocal(2027, 0, 31, 8, 0))) ===
      "2027-07-05",
    "Jan 31 + 155 days must be Jul 5"
  );

  assert(
    app.extractActionTitle("schedule a walk twenty-two weeks from tonight") === "walk",
    `title must stay walk, got ${JSON.stringify(app.extractActionTitle("schedule a walk twenty-two weeks from tonight"))}`
  );
  assert(
    app.extractActionTitle("schedule a walk 22 weeks from today") === "walk",
    "digit twenty-two-weeks phrase must drop out of the title"
  );
  assert(
    app.extractActionTitle("schedule a walk twenty-two weeks from tomorrow") === "walk",
    "tomorrow phrase must drop out of the title"
  );
  assert(
    app.extractActionTitle("add an exposure to approach the store twenty-two weeks from tonight") ===
      "approach the store",
    "exposure title must keep the target and drop the twenty-two-weeks phrase"
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
      "add a 10 minute walk twenty-two weeks from tonight"
    );
    assert(action && action.kind === "added_activation", "executeIntent must persist an activation");
    assert(
      localKey(action.a.scheduledFor) === twentyTwoFromTonight,
      `persisted local day must be ${twentyTwoFromTonight}, got ${localKey(action.a.scheduledFor)}`
    );
    assert(
      app.todayKey(new RealDate(action.a.scheduledFor)) === twentyTwoFromTonight,
      "todayKey of scheduledFor must match the requested local day (calendar marks/agenda)"
    );
    assert(localHour(action.a.scheduledFor) === 20, "persisted hour must stay 20:00 local");
    assert(action.a.title === "walk", `persisted title must be walk, got ${JSON.stringify(action.a.title)}`);
    assert(action.a.duration === 10, `duration must stay 10, got ${action.a.duration}`);
    assert(
      app.STATE.activations.some(
        (a) => a.title === "walk" && localKey(a.scheduledFor) === twentyTwoFromTonight
      ),
      "STATE.activations must contain the twenty-two-weeks-from-tonight walk"
    );

    const todayAction = await app.executeIntent(
      "add_activation",
      "schedule a walk twenty-two weeks from today"
    );
    assert(
      localKey(todayAction.a.scheduledFor) === twentyTwoFromToday &&
        localHour(todayAction.a.scheduledFor) === 10 &&
        todayAction.a.title === "walk",
      `persisted today-offset walk must be ${twentyTwoFromToday} at 10:00 titled walk, got ${todayAction.a.scheduledFor} ${todayAction.a.title}`
    );

    const tomorrowAction = await app.executeIntent(
      "add_activation",
      "schedule a walk twenty-two weeks from tomorrow"
    );
    assert(
      localKey(tomorrowAction.a.scheduledFor) === twentyTwoFromTomorrow &&
        localHour(tomorrowAction.a.scheduledFor) === 10 &&
        tomorrowAction.a.title === "walk",
      `persisted tomorrow-offset walk must be ${twentyTwoFromTomorrow} at 10:00 titled walk, got ${tomorrowAction.a.scheduledFor} ${tomorrowAction.a.title}`
    );

    const exposure = await app.executeIntent(
      "add_exposure",
      "add an exposure to approach the store twenty-two weeks from today"
    );
    assert(exposure && exposure.kind === "added_exposure", "exposure create must persist");
    assert(
      localKey(exposure.a.scheduledFor) === twentyTwoFromToday &&
        localHour(exposure.a.scheduledFor) === 10,
      `persisted exposure must be ${twentyTwoFromToday} at 10:00, got ${exposure.a.scheduledFor}`
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
    bundle.includes("function firstTwentyTwoWeeksOffset"),
    "dist/BreakFree.html must include the twenty-two-weeks-from-anchor guard"
  );

  console.log("OK extractWhen twenty-two-weeks-from-anchor checks passed");
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
