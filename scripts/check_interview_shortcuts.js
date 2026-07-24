"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const APP_SOURCE = fs.readFileSync(path.join(__dirname, "../app.js"), "utf8");

function assertShortcutCallSitesAreMarked() {
  const quickStart = APP_SOURCE.indexOf(`$("[data-action='quick-checkin']")`);
  const quickEnd = APP_SOURCE.indexOf(`$$(".card.preview")`, quickStart);
  const helpStart = APP_SOURCE.indexOf(`$$("[data-help]")`);
  const helpEnd = APP_SOURCE.indexOf("const patterns = derivePatterns()", helpStart);

  assert.notEqual(quickStart, -1, "Quick check-in handler must exist");
  assert.notEqual(quickEnd, -1, "Quick check-in handler boundary must exist");
  assert.match(
    APP_SOURCE.slice(quickStart, quickEnd),
    /source:\s*"shortcut"/,
    "Quick check-in must be sent as a shortcut"
  );

  assert.notEqual(helpStart, -1, "Help shortcut handlers must exist");
  assert.notEqual(helpEnd, -1, "Help shortcut handler boundary must exist");
  assert.match(
    APP_SOURCE.slice(helpStart, helpEnd),
    /source:\s*"shortcut"/,
    "Help prompts must be sent as shortcuts"
  );
}

function runScenario(body) {
  const storage = new Map();
  const context = vm.createContext({
    console,
    structuredClone,
    setTimeout,
    clearTimeout,
    window: {},
    localStorage: {
      getItem(key) {
        return storage.get(key) ?? null;
      },
      setItem(key, value) {
        storage.set(key, String(value));
      }
    },
    fetch: async () => ({
      ok: true,
      json: async () => ({ modalities: {}, docs: [], chunks: [] })
    }),
    document: {
      addEventListener() {}
    }
  });

  return new Promise((resolve, reject) => {
    context.__resolve = resolve;
    context.__reject = reject;
    vm.runInContext(
      `${APP_SOURCE}\n(async () => {\n${body}\n})().then(__resolve, __reject);`,
      context,
      { filename: "app.js" }
    );
  });
}

async function assertQuickCheckinPreservesInterviewQuestion() {
  const result = await runScenario(`
    route = "calendar";
    render = () => {};
    drawCoach = () => {};
    STATE.coach.mode = "interview";
    STATE.profile.interviewStarted = true;
    STATE.profile.interviewProgress.currentTopic = "name";

    await coachSend("let's do a quick check-in", { source: "shortcut" });
    const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return {
      mode: persisted.coach.mode,
      name: persisted.profile.name,
      askedTopics: persisted.profile.interviewProgress.askedTopics,
      currentTopic: persisted.profile.interviewProgress.currentTopic,
      facts: persisted.coach.facts
    };
  `);

  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    mode: "free",
    name: "",
    askedTopics: [],
    currentTopic: "name",
    facts: []
  });
}

async function assertHelpShortcutDoesNotBecomeProfileData() {
  const result = await runScenario(`
    route = "calendar";
    render = () => {};
    drawCoach = () => {};
    STATE.coach.mode = "interview";
    STATE.profile.interviewStarted = true;
    STATE.profile.struggles = ["avoidance"];
    STATE.profile.interviewProgress.askedTopics = ["name", "style", "whats_here"];
    STATE.profile.interviewProgress.currentTopic = "avoiding";

    await coachSend(
      "I think I'm avoiding something. Help me name it kindly and pick a small in-vivo exposure step.",
      { source: "shortcut" }
    );
    const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return {
      mode: persisted.coach.mode,
      avoiding: persisted.profile.avoiding,
      askedTopics: persisted.profile.interviewProgress.askedTopics,
      currentTopic: persisted.profile.interviewProgress.currentTopic,
      facts: persisted.coach.facts
    };
  `);

  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    mode: "free",
    avoiding: [],
    askedTopics: ["name", "style", "whats_here"],
    currentTopic: "avoiding",
    facts: []
  });
}

async function assertPendingFreeMessageKeepsSubmissionMode() {
  const result = await runScenario(`
    route = "calendar";
    render = () => {};
    drawCoach = () => {};
    let releaseKnowledge;
    KNOWLEDGE_PROMISE = new Promise((resolve) => {
      releaseKnowledge = () => resolve({ modalities: {}, docs: [], chunks: [] });
    });

    const pendingSend = coachSend("set a goal to call mom");
    startInterview();
    releaseKnowledge();
    await pendingSend;

    return {
      mode: STATE.coach.mode,
      name: STATE.profile.name,
      currentTopic: STATE.profile.interviewProgress.currentTopic,
      goals: STATE.goals.map((goal) => goal.title)
    };
  `);

  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    mode: "interview",
    name: "",
    currentTopic: "name",
    goals: ["call mom"]
  });
}

async function main() {
  assertShortcutCallSitesAreMarked();
  const checks = [
    assertQuickCheckinPreservesInterviewQuestion,
    assertHelpShortcutDoesNotBecomeProfileData,
    assertPendingFreeMessageKeepsSubmissionMode
  ];
  const failures = [];

  for (const check of checks) {
    try {
      await check();
    } catch (error) {
      failures.push(error);
      console.error(`FAIL ${check.name}: ${error.message}`);
    }
  }

  if (failures.length) {
    throw new AggregateError(failures, "Interview shortcut checks failed");
  }
  console.log("OK interview shortcut regression checks passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
