/**
 * Regressions: Coach create requests that name a numeric slash date must
 * land on that local calendar day.
 *
 * extractWhen() only looked for tonight/tomorrow/today, so
 * "schedule a walk on 9/22" persisted scheduledFor: null. Calendar marks
 * and the day agenda (built from local Date cells vs scheduledFor) then hid
 * the step on the requested day. extractActionTitle() also truncated at `/`,
 * so the title became "walk on 9". There is no edit UI.
 *
 * Distinct from PR #18 (display of *stored* date-only strings), PR #56
 * (tonight/tomorrow negation), PR #59 (YYYY-MM-DD), PR #60 (today after
 * 23:00), PR #61 (this morning/afternoon/evening), PR #62 (clock times),
 * PR #63 (weekday names), PR #64 (relative offsets), and PR #65 (month
 * names). Those still leave "on 9/22" unscheduled.
 *
 * US M/D (and M/D/YYYY) only. Store a local 10:00 ISO datetime — never a
 * bare YYYY-MM-DD string — so todayKey(new Date(scheduledFor)) matches the
 * requested local day west and east of UTC. Invalid dates like 2/31 must
 * not overflow. Do not treat "in 1/2 hour" as January 2.
 *
 * Keep explicit "schedule a walk tonight" / "tomorrow" / "today" first.
 *
 * Run from repo root:
 *   node scripts/check_extract_when_slash_date.js
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
      `\nthis.extractWhen = extractWhen;\nthis.extractSlashDate = extractSlashDate;\nthis.extractActionTitle = extractActionTitle;\nthis.executeIntent = executeIntent;\nthis.STATE = STATE;\nthis.todayKey = todayKey;\n`,
    sandbox
  );
  return sandbox;
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function localKey(iso) {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function shiftKey(days, now = new Date()) {
  const d = new Date(now);
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function main() {
  const app = loadApp();
  assert(typeof app.extractSlashDate === "function", "extractSlashDate helper must exist");
  assert(typeof app.extractWhen === "function", "extractWhen must exist");

  const now = new Date(2026, 8, 20, 15, 0, 0, 0); // Sun Sep 20, 2026

  const dated = "schedule a walk on 9/22";
  const when = app.extractWhen(dated, now);
  assert(when, `extractWhen(${JSON.stringify(dated)}) must return a datetime`);
  assert(
    !/^\d{4}-\d{2}-\d{2}$/.test(when),
    "must store a full ISO datetime, not a bare YYYY-MM-DD string (UTC date-only parsing shifts the calendar day west of UTC)"
  );
  assert(
    localKey(when) === "2026-09-22",
    `scheduledFor local day must be 2026-09-22, got ${localKey(when)} from ${when}`
  );
  assert(
    new Date(when).getHours() === 10,
    `local 10:00 expected (same as tomorrow), got hour ${new Date(when).getHours()}`
  );

  assert(
    localKey(app.extractWhen("schedule a walk on 09/22", now)) === "2026-09-22",
    "zero-padded 09/22 must schedule that local day"
  );
  assert(
    localKey(app.extractWhen("schedule a walk for 9/22/2026", now)) === "2026-09-22",
    "M/D/YYYY must schedule that local day"
  );
  assert(
    localKey(app.extractWhen("schedule a walk 9/22", now)) === "2026-09-22",
    "bare 9/22 (day > 12, unambiguous US M/D) must schedule that local day"
  );
  assert(
    localKey(app.extractWhen("On 9/22, schedule a walk", now)) === "2026-09-22",
    "leading On 9/22 must schedule that local day"
  );
  assert(
    localKey(app.extractWhen("schedule a walk on 2026/9/22", now)) === "2026-09-22",
    "year-first 2026/9/22 must schedule that local day"
  );

  const exposure = app.extractWhen("build me an exposure for 10/1/2026", now);
  assert(localKey(exposure) === "2026-10-01", "exposure creates must honor slash dates too");

  const past = app.extractWhen("schedule a walk on 1/5", now);
  assert(
    localKey(past) === "2027-01-05",
    `past month/day without a year must roll to next year, got ${localKey(past)}`
  );

  assert(
    app.extractWhen("schedule a walk on 2/31", now) === null,
    "invalid calendar dates must not overflow into another month"
  );
  assert(
    app.extractWhen("schedule a walk on 13/40", now) === null,
    "impossible M/D values must not schedule"
  );
  assert(
    app.extractWhen("schedule a walk in 1/2 hour", now) === null,
    "in 1/2 hour must not be treated as January 2"
  );
  assert(
    app.extractWhen("schedule a 1/2 hour walk", now) === null,
    "1/2 hour duration must not be treated as January 2"
  );
  assert(
    app.extractWhen("schedule a walk on 9/22/26", now) === null,
    "two-digit years must not be parsed as a date"
  );

  const title = app.extractActionTitle(dated);
  assert(title === "walk", `title should be walk without the date leak, got ${JSON.stringify(title)}`);
  assert(
    app.extractActionTitle("schedule a walk for 9/22/2026") === "walk",
    `M/D/YYYY titles must strip the date, got ${JSON.stringify(
      app.extractActionTitle("schedule a walk for 9/22/2026")
    )}`
  );

  assert(
    app.extractActionTitle("schedule a walk tomorrow") === "walk tomorrow" ||
      app.extractActionTitle("schedule a walk tomorrow") === "walk",
    "relative-day titles must still extract an activity"
  );

  const tomorrow = app.extractWhen("schedule a walk tomorrow", now);
  assert(tomorrow, "tomorrow must still schedule");
  assert(
    localKey(tomorrow) === shiftKey(1, now),
    `tomorrow must stay the next local day, got ${localKey(tomorrow)}`
  );

  const tonight = app.extractWhen("schedule a walk tonight", now);
  assert(tonight, "tonight must still schedule");
  assert(localKey(tonight) === shiftKey(0, now), `tonight must stay today, got ${localKey(tonight)}`);

  const today = app.extractWhen("schedule a walk today", now);
  assert(today, "today must still schedule");
  assert(localKey(today) === shiftKey(0, now), `today must stay today, got ${localKey(today)}`);

  app.STATE.activations = [];
  const persistText = "schedule a walk on 9/22/2026";
  const action = await app.executeIntent("add_activation", persistText);
  assert(action && action.kind === "added_activation", "executeIntent must persist an activation");
  assert(action.a.scheduledFor, "persisted activation must have scheduledFor");
  assert(
    localKey(action.a.scheduledFor) === "2026-09-22",
    `persisted local day must be 2026-09-22, got ${localKey(action.a.scheduledFor)}`
  );
  assert(
    app.todayKey(new Date(action.a.scheduledFor)) === "2026-09-22",
    "todayKey of scheduledFor must match the requested local day (calendar marks/agenda)"
  );
  assert(action.a.title === "walk", `persisted title must not include the date, got ${JSON.stringify(action.a.title)}`);

  app.STATE.activations = [];
  const exp = await app.executeIntent("add_exposure", "build an exposure for 10/1/2026");
  assert(exp && exp.kind === "added_exposure", "executeIntent must persist an exposure");
  assert(
    localKey(exp.a.scheduledFor) === "2026-10-01",
    `exposure local day must be 2026-10-01, got ${localKey(exp.a.scheduledFor)}`
  );

  console.log("OK extractWhen slash-date");
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
