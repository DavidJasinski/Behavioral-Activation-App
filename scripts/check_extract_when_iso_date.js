/**
 * Regressions: Coach create requests with an explicit YYYY-MM-DD must land on
 * that local calendar day.
 *
 * extractWhen() only looked for tonight/tomorrow/today, so
 * "schedule a walk for 2026-09-20" persisted scheduledFor: null. Calendar
 * marks and the day agenda (built from local Date cells vs scheduledFor)
 * then hid the step on the requested day. extractDate() already parsed
 * YYYY-MM-DD for goals, so this was an omission on the activation path.
 * The date also leaked into extractActionTitle() ("walk for 2026-09-20").
 *
 * Distinct from PR #18 (display of *stored* date-only strings via UTC
 * `new Date("YYYY-MM-DD")`) and PR #56 (tonight/tomorrow negation).
 *
 * Store local-midnight ISO datetimes — never a bare YYYY-MM-DD string —
 * so todayKey(new Date(scheduledFor)) matches the requested local day
 * west and east of UTC.
 *
 * Keep explicit "schedule a walk tonight" / "tomorrow" / "today".
 *
 * Run from repo root:
 *   node scripts/check_extract_when_iso_date.js
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
      `\nthis.extractWhen = extractWhen;\nthis.isoDateOnlyToLocalIso = isoDateOnlyToLocalIso;\nthis.extractActionTitle = extractActionTitle;\nthis.executeIntent = executeIntent;\nthis.STATE = STATE;\nthis.todayKey = todayKey;\n`,
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

function shiftKey(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function main() {
  const app = loadApp();
  assert(typeof app.isoDateOnlyToLocalIso === "function", "isoDateOnlyToLocalIso helper must exist");
  assert(typeof app.extractWhen === "function", "extractWhen must exist");

  const dated = "schedule a walk for 2026-09-20";
  const when = app.extractWhen(dated);
  assert(when, `extractWhen(${JSON.stringify(dated)}) must return a datetime`);
  assert(
    !/^\d{4}-\d{2}-\d{2}$/.test(when),
    "must store a full ISO datetime, not a bare YYYY-MM-DD string (UTC date-only parsing shifts the calendar day west of UTC)"
  );
  assert(
    localKey(when) === "2026-09-20",
    `scheduledFor local day must be 2026-09-20, got ${localKey(when)} from ${when}`
  );
  assert(new Date(when).getHours() === 0, `local midnight expected, got hour ${new Date(when).getHours()}`);

  const onDate = app.extractWhen("schedule a walk on 2026-09-20");
  assert(localKey(onDate) === "2026-09-20", "on YYYY-MM-DD must schedule that local day");

  const exposure = app.extractWhen("build me an exposure for 2026-12-01");
  assert(localKey(exposure) === "2026-12-01", "exposure creates must honor YYYY-MM-DD too");

  assert(
    app.extractWhen("schedule a walk for 2026-02-31") === null,
    "invalid calendar dates must not overflow into another month"
  );

  const title = app.extractActionTitle(dated);
  assert(title === "walk", `title should be walk without the date leak, got ${JSON.stringify(title)}`);

  assert(
    app.extractActionTitle("schedule a walk tomorrow") === "walk tomorrow" ||
      app.extractActionTitle("schedule a walk tomorrow") === "walk",
    "relative-day titles must still extract an activity"
  );

  const tomorrow = app.extractWhen("schedule a walk tomorrow");
  assert(tomorrow, "tomorrow must still schedule");
  assert(localKey(tomorrow) === shiftKey(1), `tomorrow must stay the next local day, got ${localKey(tomorrow)}`);

  const tonight = app.extractWhen("schedule a walk tonight");
  assert(tonight, "tonight must still schedule");
  assert(localKey(tonight) === shiftKey(0), `tonight must stay today, got ${localKey(tonight)}`);

  const today = app.extractWhen("schedule a walk today");
  assert(today, "today must still schedule");

  app.STATE.activations = [];
  const action = await app.executeIntent("add_activation", dated);
  assert(action && action.kind === "added_activation", "executeIntent must persist an activation");
  assert(action.a.scheduledFor, "persisted activation must have scheduledFor");
  assert(
    localKey(action.a.scheduledFor) === "2026-09-20",
    `persisted local day must be 2026-09-20, got ${localKey(action.a.scheduledFor)}`
  );
  assert(
    app.todayKey(new Date(action.a.scheduledFor)) === "2026-09-20",
    "todayKey of scheduledFor must match the requested local day (calendar marks/agenda)"
  );
  assert(action.a.title === "walk", `persisted title must not include the date, got ${JSON.stringify(action.a.title)}`);

  console.log("OK extractWhen ISO date");
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
