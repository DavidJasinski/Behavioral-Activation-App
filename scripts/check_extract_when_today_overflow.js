/**
 * Regressions: Coach "schedule … today" after 23:00 local must stay on today.
 *
 * extractWhen() used setHours(now.getHours() + 1). After 23:00 that rolls
 * to 00:00 on the next local calendar day, so "schedule a walk today" at
 * 11:30pm persisted scheduledFor tomorrow. Calendar marks and today's
 * agenda (built from local Date cells vs scheduledFor) then hid the step
 * — the user asked for today and the plan appeared on the wrong day.
 * There is no edit UI to move it back.
 *
 * The app's own late-night greeting ("Quiet hours") invites this path.
 *
 * Distinct from PR #18 (bare YYYY-MM-DD UTC display), PR #56 (tonight vs
 * tomorrow negation; that branch still uses hours+1 for today), and PR #59
 * (explicit YYYY-MM-DD parsing).
 *
 * Helper: clampToLocalDay(). Keep explicit tonight / tomorrow / mid-day today.
 *
 * Run from repo root:
 *   node scripts/check_extract_when_today_overflow.js
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
      `\nthis.extractWhen = extractWhen;\nthis.clampToLocalDay = typeof clampToLocalDay === "function" ? clampToLocalDay : null;\nthis.executeIntent = executeIntent;\nthis.STATE = STATE;\nthis.todayKey = todayKey;\n`,
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

function localMinute(iso) {
  return new Date(iso).getMinutes();
}

function atLocal(y, mo, day, h, min) {
  return new Date(y, mo, day, h, min, 0, 0);
}

async function main() {
  const app = loadApp();
  assert(app.clampToLocalDay, "clampToLocalDay helper must exist");
  assert(typeof app.extractWhen === "function", "extractWhen must exist");

  const late = atLocal(2026, 8, 15, 23, 30);
  const today = "2026-09-15";
  const tomorrow = "2026-09-16";

  for (const text of [
    "schedule a walk today",
    "add a 10 minute walk today",
    "plan a walk later today",
    "create an activation to walk today"
  ]) {
    const when = app.extractWhen(text, late);
    assert(when, `extractWhen(${JSON.stringify(text)}) at 23:30 must return a datetime`);
    assert(
      localKey(when) === today,
      `extractWhen(${JSON.stringify(text)}) at 23:30 must stay ${today}, got ${localKey(when)} from ${when}`
    );
  }

  const rolled = atLocal(2026, 8, 15, 24, 0);
  assert(
    localKey(rolled) === tomorrow,
    "sanity: hours+1 from 23:30 is the next local day"
  );
  const clamped = app.clampToLocalDay(rolled, late);
  assert(
    localKey(clamped) === today,
    `clampToLocalDay must keep ${today}, got ${localKey(clamped)}`
  );
  assert(
    clamped.getHours() === 23 && clamped.getMinutes() === 59,
    `clampToLocalDay should land at 23:59 local, got ${clamped.getHours()}:${String(clamped.getMinutes()).padStart(2, "0")}`
  );

  const afternoon = atLocal(2026, 8, 15, 14, 20);
  const afternoonWhen = app.extractWhen("schedule a walk today", afternoon);
  assert(localKey(afternoonWhen) === today, "mid-day today must stay today");
  assert(
    localHour(afternoonWhen) === 15 && localMinute(afternoonWhen) === 0,
    `mid-day today should still be +1 hour (15:00), got ${localHour(afternoonWhen)}:${String(localMinute(afternoonWhen)).padStart(2, "0")}`
  );

  const twentyTwo = atLocal(2026, 8, 15, 22, 30);
  const twentyTwoWhen = app.extractWhen("schedule a walk today", twentyTwo);
  assert(
    localKey(twentyTwoWhen) === today,
    "22:30 today +1 hour must still be today"
  );
  assert(
    localHour(twentyTwoWhen) === 23,
    `22:30 today should be 23:00 local, got hour ${localHour(twentyTwoWhen)}`
  );

  const tonight = app.extractWhen("schedule a walk tonight", late);
  assert(tonight, "tonight must still schedule");
  assert(localKey(tonight) === today, `tonight at 23:30 must stay today, got ${localKey(tonight)}`);
  assert(localHour(tonight) === 20, `tonight should be 20:00 local, got hour ${localHour(tonight)}`);

  const tomorrowWhen = app.extractWhen("schedule a walk tomorrow", late);
  assert(tomorrowWhen, "tomorrow must still schedule");
  assert(
    localKey(tomorrowWhen) === tomorrow,
    `tomorrow must stay the next local day, got ${localKey(tomorrowWhen)}`
  );

  const RealDate = app.Date;
  const t = late.getTime();
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
    const action = await app.executeIntent("add_activation", "schedule a walk today");
    assert(action && action.kind === "added_activation", "executeIntent must persist an activation");
    assert(action.a.scheduledFor, "persisted activation must have scheduledFor");
    assert(
      localKey(action.a.scheduledFor) === today,
      `persisted local day must be ${today}, got ${localKey(action.a.scheduledFor)}`
    );
    assert(
      app.todayKey(new RealDate(action.a.scheduledFor)) === today,
      "todayKey of scheduledFor must match the requested local day (calendar marks/agenda)"
    );
  } finally {
    app.Date = RealDate;
  }

  console.log("OK extractWhen today overflow checks passed");
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
