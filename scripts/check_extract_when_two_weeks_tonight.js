/**
 * Regression: "two weeks from tonight" must schedule fourteen local days
 * ahead at 20:00.
 *
 * extractWhen() tested /tonight/ first. That token sits inside the phrase,
 * so on Sat Nov 7 "schedule a walk two weeks from tonight" persisted Nov 7
 * at 20:00 instead of Nov 21 at 20:00. Calendar marks and that day's agenda
 * then showed the step on the wrong day. There is no edit UI.
 *
 * Offset: two/2 weeks from tonight → +14 local days at 20:00 (tonight's hour).
 *
 * A refused phrase must not win: "schedule a walk tonight, not two weeks
 * from tonight" stays tonight. "I can't tonight — schedule a walk two weeks
 * from tonight" stays fourteen nights out.
 *
 * "next week", "in two weeks", and "this weekend" stay unscheduled.
 *
 * Run from repo root:
 *   node scripts/check_extract_when_two_weeks_tonight.js
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
      `\nthis.extractWhen = extractWhen;\nthis.extractActionTitle = extractActionTitle;\nthis.executeIntent = executeIntent;\nthis.STATE = STATE;\nthis.todayKey = todayKey;\nthis.requestsTwoWeeksFromTonight = requestsTwoWeeksFromTonight;\n`,
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
    typeof app.requestsTwoWeeksFromTonight === "function",
    "requestsTwoWeeksFromTonight helper must exist"
  );

  const now = atLocal(2026, 10, 7, 15, 30); // Sat Nov 7, 2026, 15:30 local
  const today = "2026-11-07";
  const tomorrow = "2026-11-08";
  const twoFromTonight = "2026-11-21";

  for (const text of [
    "schedule a walk two weeks from tonight",
    "plan a walk 2 weeks from tonight",
    "add a 10 minute walk for two weeks from tonight",
    "create an activation to walk two weeks from tonight",
    "Two weeks from tonight, schedule a walk",
    "schedule a walk in two weeks from tonight"
  ]) {
    const when = app.extractWhen(text, now);
    assert(when, `extractWhen(${JSON.stringify(text)}) must return a datetime`);
    assert(
      localKey(when) === twoFromTonight,
      `extractWhen(${JSON.stringify(text)}) must be ${twoFromTonight}, got ${localKey(when)} from ${when}`
    );
    assert(
      localHour(when) === 20,
      `two weeks from tonight should stay 20:00 local, got hour ${localHour(when)}`
    );
    assert(
      app.requestsTwoWeeksFromTonight(text),
      `positive phrase must be recognized: ${text}`
    );
  }

  const exposureWhen = app.extractWhen(
    "add an exposure to approach the store two weeks from tonight",
    now
  );
  assert(
    localKey(exposureWhen) === twoFromTonight && localHour(exposureWhen) === 20,
    `exposure two-weeks-from-tonight must be ${twoFromTonight} at 20:00, got ${exposureWhen}`
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
  assert(app.extractWhen("schedule a walk in two weeks", now) == null, "in two weeks must stay unscheduled");
  assert(app.extractWhen("schedule a walk this weekend", now) == null, "this weekend must stay unscheduled");

  const refused = app.extractWhen(
    "schedule a walk tonight, not two weeks from tonight",
    now
  );
  assert(
    localKey(refused) === today && localHour(refused) === 20,
    `negated two-weeks-from-tonight must stay tonight, got ${refused}`
  );
  const refusedTomorrow = app.extractWhen(
    "schedule a walk tomorrow, not two weeks from tonight",
    now
  );
  assert(
    localKey(refusedTomorrow) === tomorrow && localHour(refusedTomorrow) === 10,
    `negated phrase must not steal tomorrow, got ${refusedTomorrow}`
  );
  const refusedCurly = app.extractWhen(
    "schedule a walk tonight. I can\u2019t do it two weeks from tonight",
    now
  );
  assert(
    localKey(refusedCurly) === today && localHour(refusedCurly) === 20,
    `curly-apostrophe can't-do must stay tonight, got ${refusedCurly}`
  );
  assert(
    !app.requestsTwoWeeksFromTonight("I can\u2019t two weeks from tonight"),
    "curly-apostrophe can't immediately before the phrase is a refusal"
  );

  const cantTonight = app.extractWhen(
    "I can't tonight — schedule a walk two weeks from tonight",
    now
  );
  assert(
    localKey(cantTonight) === twoFromTonight && localHour(cantTonight) === 20,
    `can't tonight + two weeks from tonight must be ${twoFromTonight} at 20:00, got ${cantTonight}`
  );
  const cantComma = app.extractWhen(
    "I can't tonight, schedule a walk two weeks from tonight",
    now
  );
  assert(
    localKey(cantComma) === twoFromTonight && localHour(cantComma) === 20,
    `can't tonight comma + two weeks from tonight must be ${twoFromTonight} at 20:00, got ${cantComma}`
  );

  const onlyNegated = app.extractWhen("schedule a walk, not two weeks from tonight", now);
  assert(
    onlyNegated == null,
    `a refused two-weeks-from-tonight with no other day must stay unscheduled, got ${onlyNegated}`
  );
  assert(
    !app.requestsTwoWeeksFromTonight("not two weeks from tonight"),
    "bare refusal must not count as a request"
  );

  const laterPositive = app.extractWhen(
    "not two weeks from tonight. schedule a walk two weeks from tonight",
    now
  );
  assert(
    localKey(laterPositive) === twoFromTonight && localHour(laterPositive) === 20,
    `a later positive phrase must win, got ${laterPositive}`
  );

  const monthEnd = atLocal(2026, 10, 20, 21, 0); // Fri Nov 20, after 20:00
  assert(
    localKey(app.extractWhen("schedule a walk two weeks from tonight", monthEnd)) === "2026-12-04" &&
      localHour(app.extractWhen("schedule a walk two weeks from tonight", monthEnd)) === 20,
    "Nov 20 at 21:00 + 14 nights must be Dec 4 at 20:00, not the next morning"
  );
  assert(
    localKey(app.extractWhen("schedule a walk 2 weeks from tonight", atLocal(2026, 0, 31, 8, 0))) ===
      "2026-02-14",
    "Jan 31 + 14 nights must be Feb 14"
  );

  assert(
    app.extractActionTitle("schedule a walk two weeks from tonight") === "walk",
    `title must stay walk, got ${JSON.stringify(app.extractActionTitle("schedule a walk two weeks from tonight"))}`
  );
  assert(
    app.extractActionTitle("schedule a walk 2 weeks from tonight") === "walk",
    "digit two-weeks phrase must drop out of the title"
  );
  assert(
    app.extractActionTitle("add an exposure to approach the store two weeks from tonight") ===
      "approach the store",
    "exposure title must keep the target and drop the two-weeks phrase"
  );
  assert(
    app.extractActionTitle("schedule a walk tonight") === "walk tonight",
    "bare tonight titles stay unchanged"
  );
  assert(
    app.extractActionTitle("schedule a walk today") === "walk today",
    "bare today titles stay unchanged"
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
      "add a 10 minute walk two weeks from tonight"
    );
    assert(action && action.kind === "added_activation", "executeIntent must persist an activation");
    assert(
      localKey(action.a.scheduledFor) === twoFromTonight,
      `persisted local day must be ${twoFromTonight}, got ${localKey(action.a.scheduledFor)}`
    );
    assert(
      app.todayKey(new RealDate(action.a.scheduledFor)) === twoFromTonight,
      "todayKey of scheduledFor must match the requested local day (calendar marks/agenda)"
    );
    assert(localHour(action.a.scheduledFor) === 20, "persisted hour must stay 20:00 local");
    assert(action.a.title === "walk", `persisted title must be walk, got ${JSON.stringify(action.a.title)}`);
    assert(action.a.duration === 10, `duration must stay 10, got ${action.a.duration}`);
    assert(
      app.STATE.activations.some(
        (a) => a.title === "walk" && localKey(a.scheduledFor) === twoFromTonight
      ),
      "STATE.activations must contain the two-weeks-from-tonight walk"
    );

    const exposure = await app.executeIntent(
      "add_exposure",
      "add an exposure to approach the store two weeks from tonight"
    );
    assert(exposure && exposure.kind === "added_exposure", "exposure create must persist");
    assert(
      localKey(exposure.a.scheduledFor) === twoFromTonight &&
        localHour(exposure.a.scheduledFor) === 20,
      `persisted exposure must be ${twoFromTonight} at 20:00, got ${exposure.a.scheduledFor}`
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
    bundle.includes("function requestsTwoWeeksFromTonight"),
    "dist/BreakFree.html must include the two-weeks-from-tonight guard"
  );

  console.log("OK extractWhen two-weeks-from-tonight checks passed");
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
