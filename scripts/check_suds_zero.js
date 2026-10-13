/**
 * Regressions: an explicit SUDS 0 rating must stay in the bottom intensity
 * bucket. `energy: suds ? ... : 2` treated 0 as missing, so
 * "add an exposure ... suds 0" was stored as energy 2 and shown as
 * "SUDS ~40" — harder than an explicit SUDS 20 step (energy 1, "SUDS ~20").
 * There is no edit UI, so the inverted rating stuck.
 *
 * Run from repo root:
 *   node scripts/check_suds_zero.js
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

  const noopEl = () => ({
    addEventListener() {},
    focus() {},
    hidden: true,
    value: "",
    innerHTML: "",
    textContent: "",
    appendChild() {},
    classList: { add() {}, toggle() {} },
    style: {},
    dataset: {},
    scrollTop: 0,
    reset() {}
  });

  const document = {
    body: { addEventListener() {} },
    addEventListener() {},
    querySelector() {
      return noopEl();
    },
    querySelectorAll() {
      return [];
    },
    createElement() {
      return noopEl();
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

  let modified = APP_SOURCE.replace(
    /document\.addEventListener\("DOMContentLoaded", init\);/,
    ""
  );
  for (const fn of [
    "wire",
    "render",
    "drawCoach",
    "drawSuggestions",
    "openCoach",
    "closeCoach",
    "navigate",
    "toast",
    "renderHome",
    "renderCalendar",
    "renderCreate",
    "renderHelp",
    "drawCalendar"
  ]) {
    modified = modified.replace(
      new RegExp(`function ${fn}\\([\\s\\S]*?\\n\\}`),
      `function ${fn}(){}`
    );
  }

  vm.runInNewContext(
    modified +
      `\nthis.STATE = STATE;\nthis.coachSend = coachSend;\nthis.extractSuds = extractSuds;\nthis.subFor = subFor;\nthis.classify = classify;\n`,
    sandbox
  );
  return sandbox;
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function exposureFrom(text) {
  const app = loadApp();
  assert(app.classify(text) === "add_exposure", `"${text}" should create an exposure (got ${app.classify(text)})`);
  await app.coachSend(text);
  assert(app.STATE.activations.length === 1, `"${text}" should save one exposure`);
  const a = app.STATE.activations[0];
  assert(a.modality === "ivex", `"${text}" should be an exposure`);
  return { app, a, sub: app.subFor(a) };
}

async function main() {
  const zero = await exposureFrom("add an exposure to look at a photo of the bus, suds 0");
  assert(zero.app.extractSuds("add an exposure to look at a photo of the bus, suds 0") === 0, "extractSuds must return 0");
  assert(zero.a.energy === 1, `SUDS 0 must map to the bottom bucket energy 1, got ${zero.a.energy}`);
  assert(zero.sub.includes("SUDS ~20"), `SUDS 0 must display as the bottom bucket, got ${zero.sub}`);
  assert(!zero.sub.includes("SUDS ~40"), `SUDS 0 must not display as SUDS ~40 (${zero.sub})`);

  const zeroWord = await exposureFrom("build an exposure hierarchy step, SUDS 0");
  assert(zeroWord.a.energy === 1, `SUDS 0 (capitalized) must map to energy 1, got ${zeroWord.a.energy}`);

  const twenty = await exposureFrom("schedule an in-vivo step at the bus stop, suds 20, for 10 minutes");
  assert(twenty.a.energy === 1, `SUDS 20 must stay energy 1, got ${twenty.a.energy}`);
  assert(
    zero.a.energy <= twenty.a.energy,
    `SUDS 0 (energy ${zero.a.energy}) must not rank harder than SUDS 20 (energy ${twenty.a.energy})`
  );

  const forty = await exposureFrom("add an exposure with suds 40");
  assert(forty.a.energy === 2, `SUDS 40 must stay energy 2, got ${forty.a.energy}`);
  assert(forty.sub.includes("SUDS ~40"), `SUDS 40 must display as SUDS ~40, got ${forty.sub}`);

  const omitted = await exposureFrom("add an exposure to ride the bus for 15 minutes");
  assert(omitted.app.extractSuds("add an exposure to ride the bus for 15 minutes") == null, "missing SUDS must stay null");
  assert(omitted.a.energy === 2, `omitted SUDS must keep the default energy 2, got ${omitted.a.energy}`);

  const top = await exposureFrom("add an exposure to ride the bus, suds 100");
  assert(top.a.energy === 5, `SUDS 100 must map to energy 5, got ${top.a.energy}`);

  console.log("OK suds 0 intensity checks passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
