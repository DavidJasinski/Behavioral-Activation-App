"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const APP_SOURCE = fs.readFileSync(path.join(__dirname, "../app.js"), "utf8");

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

async function assertHomeCoachRedraws() {
  const result = await runScenario(`
    route = "home";
    let renderCalls = 0;
    let drawCoachCalls = 0;
    render = () => { renderCalls += 1; };
    drawCoach = () => { drawCoachCalls += 1; };

    await coachSend("hello coach");
    return { renderCalls, drawCoachCalls };
  `);

  assert.equal(result.renderCalls, 1, "Home should still refresh its Coach preview");
  assert.equal(
    result.drawCoachCalls,
    1,
    "Sending from Home must redraw the open Coach drawer"
  );
}

async function assertInterviewControl(label, expected) {
  const result = await runScenario(`
    route = "calendar";
    STATE.coach.mode = "interview";
    STATE.profile.interviewStarted = true;
    STATE.profile.interviewProgress.currentTopic = "name";

    await coachSend(${JSON.stringify(label)});
    const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return {
      name: persisted.profile.name,
      mode: persisted.coach.mode,
      currentTopic: persisted.profile.interviewProgress.currentTopic,
      askedTopics: persisted.profile.interviewProgress.askedTopics
    };
  `);

  assert.deepEqual(result, expected, `"${label}" must behave as a control, not an answer`);
}

async function main() {
  await assertHomeCoachRedraws();
  await assertInterviewControl("skip this one", {
    name: "",
    mode: "interview",
    currentTopic: "style",
    askedTopics: ["name"]
  });
  await assertInterviewControl("ask me something else", {
    name: "",
    mode: "interview",
    currentTopic: "style",
    askedTopics: ["name"]
  });
  await assertInterviewControl("enough for now", {
    name: "",
    mode: "free",
    currentTopic: "name",
    askedTopics: []
  });
  console.log("OK app behavior regression checks passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
