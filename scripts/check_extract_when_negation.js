/**
 * Regressions: Coach scheduling must not prefer a negated "tonight" over an
 * explicit "tomorrow" (or a negated "tomorrow" over "tonight").
 *
 * extractWhen() tested /tonight/ before /tomorrow/, so a clear request like
 * "schedule a walk tomorrow, I can't tonight" persisted the step at 8pm
 * tonight. Calendar marks and the day agenda then showed it on the wrong
 * local day — the user asked for tomorrow and the plan disappeared from
 * tomorrow's view.
 *
 * Distinct from PR #18 (bare YYYY-MM-DD UTC parsing for calendarSelected /
 * goal targetDate). This is Coach extractWhen token order + negation.
 *
 * Keep explicit "schedule a walk tonight" / "tomorrow" / "today".
 *
 * Run from repo root:
 *   node scripts/check_extract_when_negation.js
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
      `\nthis.extractWhen = extractWhen;\nthis.whenTokenIsNegated = typeof whenTokenIsNegated === "function" ? whenTokenIsNegated : null;\nthis.executeIntent = executeIntent;\nthis.STATE = STATE;\n`,
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

function localHour(iso) {
  return new Date(iso).getHours();
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
  assert(app.whenTokenIsNegated, "whenTokenIsNegated helper must exist");
  assert(typeof app.extractWhen === "function", "extractWhen must exist");

  const tomorrow = shiftKey(1);
  const today = shiftKey(0);

  for (const text of [
    "schedule a walk tomorrow, I can't tonight",
    "I can't tonight — schedule a walk tomorrow",
    "add a walk tomorrow not tonight",
    "plan a walk tomorrow, not tonight",
    "schedule a walk tomorrow",
    "add an activation to walk for 10 minutes tomorrow"
  ]) {
    const when = app.extractWhen(text);
    assert(when, `extractWhen("${text}") should return a datetime`);
    assert(
      localKey(when) === tomorrow,
      `extractWhen("${text}") should be tomorrow (${tomorrow}), got ${localKey(when)}`
    );
    assert(
      localHour(when) === 10,
      `extractWhen("${text}") should be 10:00 local, got hour ${localHour(when)}`
    );
  }

  for (const text of [
    "schedule a walk tonight",
    "schedule a walk tonight, not tomorrow",
    "I can't tomorrow, schedule a walk tonight"
  ]) {
    const when = app.extractWhen(text);
    assert(when, `extractWhen("${text}") should return a datetime`);
    assert(
      localKey(when) === today,
      `extractWhen("${text}") should be tonight/today (${today}), got ${localKey(when)}`
    );
    assert(
      localHour(when) === 20,
      `extractWhen("${text}") should be 20:00 local, got hour ${localHour(when)}`
    );
  }

  const todayWhen = app.extractWhen("schedule a walk today");
  assert(todayWhen, 'extractWhen("schedule a walk today") should return a datetime');
  assert(
    localKey(todayWhen) === today,
    `extractWhen today should stay on today (${today}), got ${localKey(todayWhen)}`
  );

  const laterToday = app.extractWhen("schedule a walk later today, not tonight");
  assert(laterToday, 'extractWhen("later today, not tonight") should return a datetime');
  assert(
    localKey(laterToday) === today,
    `extractWhen("later today, not tonight") should stay today, got ${localKey(laterToday)}`
  );
  assert(
    localHour(laterToday) !== 20,
    'extractWhen("later today, not tonight") must not snap to 8pm tonight'
  );

  assert(app.extractWhen("just thinking about walking") === null, "no day token → null");

  app.STATE.activations = [];
  const action = await app.executeIntent(
    "add_activation",
    "schedule a walk tomorrow, I can't tonight"
  );
  assert(action && action.kind === "added_activation", "executeIntent should add an activation");
  assert(
    localKey(action.a.scheduledFor) === tomorrow,
    `added activation should be scheduled tomorrow, got ${localKey(action.a.scheduledFor)}`
  );
  assert(
    localKey(app.STATE.activations[0].scheduledFor) === tomorrow,
    "persisted activation scheduledFor should be tomorrow"
  );

  console.log("OK extractWhen negation checks passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
