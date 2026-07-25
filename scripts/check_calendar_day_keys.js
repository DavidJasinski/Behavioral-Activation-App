#!/usr/bin/env node
/**
 * Regression: YYYY-MM-DD must be treated as a local calendar day.
 *
 * ECMAScript parses date-only strings as UTC midnight, which shifts the
 * civil day backward in western timezones. Calendar agenda + goal marks
 * must not follow that behavior.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const APP_JS = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function extractHelpers() {
  const start = APP_JS.indexOf("function isDateOnlyString(");
  const end = APP_JS.indexOf("\nfunction fmtTime(");
  if (start < 0 || end < 0 || end <= start) {
    throw new Error("Could not locate local date helpers in app.js");
  }
  return APP_JS.slice(start, end);
}

function runCase(tz, expectNativeUtcShift) {
  const script = `
    const helpers = ${JSON.stringify(extractHelpers())};
    const vm = require("vm");
    const sandbox = { Date, String, Number, console };
    vm.createContext(sandbox);
    vm.runInContext(helpers, sandbox);
    const { todayKey, coerceLocalDate, fmtDate, isDateOnlyString } = sandbox;

    function assert(cond, msg) { if (!cond) { console.error(msg); process.exit(1); } }

    assert(isDateOnlyString("2026-07-25"), "date-only detector failed");
    assert(!isDateOnlyString("2026-07-25T10:00"), "datetime must not be date-only");
    assert(todayKey("2026-07-25") === "2026-07-25", "todayKey date-only drifted");
    assert(todayKey(coerceLocalDate("2026-07-25")) === "2026-07-25", "coerceLocalDate drifted");
    assert(todayKey("2026-07-25T10:00") === "2026-07-25", "datetime-local day key drifted");
    const labeled = fmtDate("2026-07-25");
    assert(/Jul/.test(labeled) && /25/.test(labeled), "fmtDate date-only drifted: " + labeled);

    const d = new Date("2026-07-25");
    const nativeKey = d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0");
    if (${expectNativeUtcShift ? "true" : "false"}) {
      assert(nativeKey === "2026-07-24", "expected native UTC date-only parse on Jul 24, got " + nativeKey);
    } else {
      assert(nativeKey === "2026-07-25", "expected native date-only parse on Jul 25 east of UTC, got " + nativeKey);
    }
    console.log("OK", ${JSON.stringify(tz)});
  `;

  const result = spawnSync(process.execPath, ["-e", script], {
    env: { ...process.env, TZ: tz },
    encoding: "utf8"
  });
  if (result.status !== 0) {
    throw new Error(
      `TZ=${tz} failed:\n${result.stdout}\n${result.stderr}`
    );
  }
}

// Source-level guards on app.js
assert(
  !/activationsOnDay\(\s*new Date\(\s*calendarSelected\s*\)\s*\)/.test(APP_JS),
  "drawCalendar still passes new Date(calendarSelected) into activationsOnDay"
);
assert(
  /coerceLocalDate\(\s*calendarSelected\s*\)/.test(APP_JS),
  "drawCalendar should coerce calendarSelected via coerceLocalDate"
);
assert(
  /function coerceLocalDate\(/.test(APP_JS) && /function isDateOnlyString\(/.test(APP_JS),
  "local date helpers missing from app.js"
);

runCase("America/Los_Angeles", true);
runCase("America/New_York", true);
runCase("Asia/Tokyo", false);
runCase("UTC", false);

console.log("OK calendar day-key checks passed");
