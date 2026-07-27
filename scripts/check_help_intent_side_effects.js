/**
 * Regressions: Help "Walk me through it" prompts must not silently mutate
 * durable plan/profile state via over-broad intent classification.
 *
 * Run from repo root:
 *   node scripts/check_help_intent_side_effects.js
 */

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const APP_SOURCE = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");

const HELP_PROMPTS = {
  "low-energy":
    "I'm low energy right now. Help me shrink today's plan into the smallest possible step.",
  avoidance:
    "I think I'm avoiding something. Help me name it kindly and pick a small in-vivo exposure step.",
  "didnt-help":
    "What I tried didn't help. Help me look at the data without judging it, and decide whether to change category, shrink the step, or stay with it longer."
};

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
      `\nthis.STATE = STATE;\nthis.coachSend = coachSend;\nthis.classify = classify;\nthis.DEFAULT_STATE = DEFAULT_STATE;\n`,
    sandbox
  );
  return sandbox;
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  const app = loadApp();

  assert(
    app.classify(HELP_PROMPTS["low-energy"]) !== "add_activation",
    `low-energy Help prompt must not classify as add_activation (got ${app.classify(
      HELP_PROMPTS["low-energy"]
    )})`
  );
  assert(
    app.classify(HELP_PROMPTS["low-energy"]) !== "add_exposure",
    `low-energy Help prompt must not classify as add_exposure`
  );
  assert(
    app.classify(HELP_PROMPTS["didnt-help"]) === "help_didnt_help",
    `didnt-help Help prompt must classify as help_didnt_help (got ${app.classify(
      HELP_PROMPTS["didnt-help"]
    )})`
  );
  assert(
    app.classify(HELP_PROMPTS.avoidance) !== "add_activation" &&
      app.classify(HELP_PROMPTS.avoidance) !== "add_exposure",
    `avoidance Help prompt must not add plan items (got ${app.classify(
      HELP_PROMPTS.avoidance
    )})`
  );

  // Explicit plan verbs should still schedule activations.
  assert(
    app.classify("please add a walk this afternoon") === "add_activation",
    "explicit add-a-walk requests must still classify as add_activation"
  );
  assert(
    app.classify("plan to stretch for 10 min") === "add_activation",
    "plan-to-<activity> requests must still classify as add_activation"
  );

  const beforeActs = app.STATE.activations.length;
  const beforeTone = app.STATE.preferences.tone;
  const beforeStyle = app.STATE.profile.communicationStyle;

  await app.coachSend(HELP_PROMPTS["low-energy"]);
  assert(
    app.STATE.activations.length === beforeActs,
    `low-energy Help prompt silently added ${
      app.STATE.activations.length - beforeActs
    } activation(s)`
  );

  await app.coachSend(HELP_PROMPTS["didnt-help"]);
  assert(
    app.STATE.preferences.tone === beforeTone,
    `didnt-help Help prompt mutated preferences.tone to ${app.STATE.preferences.tone}`
  );
  assert(
    app.STATE.profile.communicationStyle === beforeStyle,
    `didnt-help Help prompt mutated communicationStyle to ${app.STATE.profile.communicationStyle}`
  );

  // Source guard: Help knowledge reload must replace the view via render(),
  // not re-bind listeners on the existing DOM via renderHelp().
  assert(
    /if \(!KNOWLEDGE\) KNOWLEDGE_PROMISE\.then\(\(\) => route === "help" && render\(\)\);/.test(
      APP_SOURCE
    ),
    "Help knowledge reload must call render() to avoid stacking click listeners"
  );
  assert(
    !/if \(!KNOWLEDGE\) KNOWLEDGE_PROMISE\.then\(\(\) => route === "help" && renderHelp\(\)\);/.test(
      APP_SOURCE
    ),
    "Help knowledge reload must not call renderHelp() directly"
  );
  assert(
    /KNOWLEDGE_PROMISE\.then\(\(\) => \{\s*if \(route === "help"\) render\(\);/.test(
      APP_SOURCE
    ),
    "init knowledge callback must refresh Help via render()"
  );

  console.log("OK help intent side-effect checks passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
