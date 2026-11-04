/**
 * Regressions: "the day after tomorrow" must schedule two local days ahead.
 *
 * extractWhen() tested /tomorrow/ first. That token sits inside
 * "day after tomorrow", so "schedule a walk the day after tomorrow"
 * persisted 10:00 tomorrow. Calendar marks and the day agenda then showed
 * the step on the wrong day. There is no edit UI to move it.
 *
 * A refused day-after must not win: "schedule a walk tomorrow, not the
 * day after tomorrow" stays tomorrow. "I can't tomorrow — schedule a walk
 * the day after tomorrow" stays two days out (not tonight, not tomorrow).
 *
 * Run from repo root:
 *   node scripts/check_extract_when_day_after_tomorrow.js
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
      `\nthis.extractWhen = extractWhen;\nthis.extractActionTitle = extractActionTitle;\nthis.executeIntent = executeIntent;\nthis.STATE = STATE;\nthis.todayKey = todayKey;\nthis.requestsDayAfterTomorrow = requestsDayAfterTomorrow;\n`,
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

function addDays(key, n) {
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(y, m - 1, d + n);
  return localKey(dt);
}

async function main() {
  const app = loadApp();
  assert(typeof app.extractWhen === "function", "extractWhen must exist");
  assert(
    typeof app.requestsDayAfterTomorrow === "function",
    "requestsDayAfterTomorrow helper must exist"
  );

  const now = atLocal(2026, 10, 4, 15, 30); // Wed Nov 4, 2026, 15:30 local
  const today = "2026-11-04";
  const tomorrow = "2026-11-05";
  const dayAfter = "2026-11-06";

  for (const text of [
    "schedule a walk the day after tomorrow",
    "plan a walk day after tomorrow",
    "add a 10 minute walk for the day after tomorrow",
    "create an activation to walk the day after tomorrow",
    "On the day after tomorrow, schedule a walk"
  ]) {
    const when = app.extractWhen(text, now);
    assert(when, `extractWhen(${JSON.stringify(text)}) must return a datetime`);
    assert(
      localKey(when) === dayAfter,
      `extractWhen(${JSON.stringify(text)}) must be ${dayAfter}, got ${localKey(when)} from ${when}`
    );
    assert(
      localHour(when) === 10,
      `day after tomorrow should be 10:00 local, got hour ${localHour(when)}`
    );
  }

  const exposureWhen = app.extractWhen(
    "add an exposure to approach the store the day after tomorrow",
    now
  );
  assert(
    localKey(exposureWhen) === dayAfter,
    `exposure day-after must be ${dayAfter}, got ${localKey(exposureWhen)}`
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

  const refusedLater = app.extractWhen(
    "schedule a walk tomorrow, not the day after tomorrow",
    now
  );
  assert(
    localKey(refusedLater) === tomorrow,
    `negated day-after must stay tomorrow, got ${localKey(refusedLater)}`
  );
  const refusedDo = app.extractWhen(
    "schedule a walk tomorrow. I can't do the day after tomorrow",
    now
  );
  assert(
    localKey(refusedDo) === tomorrow,
    `can't-do day-after must stay tomorrow, got ${localKey(refusedDo)}`
  );
  const refusedCurly = app.extractWhen(
    "schedule a walk tomorrow. I can\u2019t do the day after tomorrow",
    now
  );
  assert(
    localKey(refusedCurly) === tomorrow,
    `curly-apostrophe can't-do must stay tomorrow, got ${localKey(refusedCurly)}`
  );

  const cantTomorrow = app.extractWhen(
    "I can't tomorrow — schedule a walk the day after tomorrow",
    now
  );
  assert(
    localKey(cantTomorrow) === dayAfter,
    `can't tomorrow + day after must be ${dayAfter}, got ${localKey(cantTomorrow)}`
  );
  const cantTonight = app.extractWhen(
    "I can't tonight, schedule a walk the day after tomorrow",
    now
  );
  assert(
    localKey(cantTonight) === dayAfter,
    `can't tonight + day after must be ${dayAfter}, got ${localKey(cantTonight)}`
  );

  const onlyNegated = app.extractWhen(
    "schedule a walk, not the day after tomorrow",
    now
  );
  assert(
    onlyNegated == null,
    `a refused day-after with no other day must stay unscheduled, got ${onlyNegated}`
  );

  const monthEnd = atLocal(2026, 10, 30, 9, 0); // Nov 30
  assert(
    localKey(app.extractWhen("schedule a walk the day after tomorrow", monthEnd)) ===
      "2026-12-02",
    "Nov 30 + 2 days must be Dec 2, not an overflowed time"
  );
  assert(
    addDays("2026-01-31", 2) === "2026-02-02",
    "sanity: Jan 31 + 2 is Feb 2"
  );
  assert(
    localKey(app.extractWhen("schedule a walk the day after tomorrow", atLocal(2026, 0, 31, 8, 0))) ===
      "2026-02-02",
    "Jan 31 + 2 days must be Feb 2"
  );

  assert(
    app.extractActionTitle("schedule a walk the day after tomorrow") === "walk",
    `title must stay walk, got ${JSON.stringify(app.extractActionTitle("schedule a walk the day after tomorrow"))}`
  );
  assert(
    app.extractActionTitle("add an exposure to approach the store the day after tomorrow") ===
      "approach the store",
    "exposure title must keep the target and drop the day phrase"
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
      "schedule a walk the day after tomorrow"
    );
    assert(action && action.kind === "added_activation", "executeIntent must persist an activation");
    assert(
      localKey(action.a.scheduledFor) === dayAfter,
      `persisted local day must be ${dayAfter}, got ${localKey(action.a.scheduledFor)}`
    );
    assert(
      app.todayKey(new RealDate(action.a.scheduledFor)) === dayAfter,
      "todayKey of scheduledFor must match the requested local day (calendar marks/agenda)"
    );
    assert(action.a.title === "walk", `persisted title must be walk, got ${JSON.stringify(action.a.title)}`);
    assert(
      app.STATE.activations.some((a) => a.title === "walk" && localKey(a.scheduledFor) === dayAfter),
      "STATE.activations must contain the day-after walk"
    );

    const exposure = await app.executeIntent(
      "add_exposure",
      "add an exposure to approach the store the day after tomorrow"
    );
    assert(exposure && exposure.kind === "added_exposure", "exposure create must persist");
    assert(
      localKey(exposure.a.scheduledFor) === dayAfter,
      `persisted exposure day must be ${dayAfter}, got ${localKey(exposure.a.scheduledFor)}`
    );
    assert(
      exposure.a.title === "approach the store",
      `exposure title must drop the day phrase, got ${JSON.stringify(exposure.a.title)}`
    );
  } finally {
    app.Date = RealDate;
  }

  const bundle = fs.readFileSync(path.join(ROOT, "dist", "BreakFree.html"), "utf8");
  assert(
    bundle.includes("function requestsDayAfterTomorrow"),
    "dist/BreakFree.html must include the day-after-tomorrow guard"
  );

  console.log("OK extractWhen day-after-tomorrow checks passed");
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
