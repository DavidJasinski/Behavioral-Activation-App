"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const SOURCE = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");

function runApp(extraSource, { storage = {}, setItem } = {}) {
  const stored = { ...storage };
  const context = {
    console: { warn() {}, log() {}, error: console.error },
    window: {},
    document: {
      addEventListener() {},
      querySelector() { return null; },
      querySelectorAll() { return []; }
    },
    localStorage: {
      getItem(key) {
        return Object.prototype.hasOwnProperty.call(stored, key) ? stored[key] : null;
      },
      setItem(key, value) {
        if (setItem) return setItem(key, value, stored);
        stored[key] = String(value);
      }
    },
    fetch: async () => ({ ok: false, status: 404, json: async () => ({}) }),
    setTimeout,
    clearTimeout,
    structuredClone
  };

  vm.runInNewContext(`${SOURCE}\n${extraSource}`, context);
  return { result: context.__result, storage: stored };
}

function testLegacyMigrationSurvivesQuotaFailure() {
  const legacyState = {
    profile: { name: "Legacy" },
    coach: { memory: [], topicCounts: {}, facts: [] },
    activations: [{ id: "old", title: "kept", createdAt: "2026-01-01T00:00:00.000Z" }]
  };
  const { result } = runApp(
    "globalThis.__result = { name: STATE.profile.name, title: STATE.activations[0].title };",
    {
      storage: { "baApp.v1": JSON.stringify(legacyState) },
      setItem(key) {
        if (key === "breakFree.v1") throw new Error("quota exceeded");
      }
    }
  );

  assert.deepStrictEqual(result, { name: "Legacy", title: "kept" });
}

function testCoachRefreshDoesNotWipeNonHomeRoutes() {
  const { result } = runApp(`
    let renders = 0;
    let draws = 0;
    render = () => { renders += 1; };
    drawCoach = () => { draws += 1; };
    document.querySelector = (sel) => sel === "#coach" ? { hidden: false } : null;

    route = "home";
    refreshAfterCoachChange();
    const home = { renders, draws };

    renders = 0;
    draws = 0;
    route = "create";
    refreshAfterCoachChange();
    globalThis.__result = { home, create: { renders, draws } };
  `);

  assert.deepStrictEqual(result, {
    home: { renders: 1, draws: 1 },
    create: { renders: 0, draws: 1 }
  });
}

function testInterviewSuggestionControlsDoNotBecomeAnswers() {
  const pause = runApp(`
    STATE.coach.mode = "interview";
    STATE.profile.interviewStarted = true;
    STATE.profile.interviewProgress = { askedTopics: [], currentTopic: "name", openCloseAsked: false };
    handleInterviewAnswer("enough for now");
    globalThis.__result = { mode: STATE.coach.mode, name: STATE.profile.name };
  `).result;

  assert.deepStrictEqual(pause, { mode: "free", name: "" });

  const skip = runApp(`
    STATE.coach.mode = "interview";
    STATE.profile.interviewStarted = true;
    STATE.profile.interviewProgress = { askedTopics: [], currentTopic: "name", openCloseAsked: false };
    handleInterviewAnswer("skip this one");
    globalThis.__result = {
      name: STATE.profile.name,
      asked: STATE.profile.interviewProgress.askedTopics,
      currentTopic: STATE.profile.interviewProgress.currentTopic
    };
  `).result;

  assert.deepStrictEqual(skip, {
    name: "",
    asked: ["name"],
    currentTopic: "style"
  });
}

function testForgetRecentClearsRecallAndPausesInterview() {
  const { result } = runApp(`
    STATE.coach.mode = "interview";
    STATE.profile.interviewProgress.currentTopic = "name";
    STATE.coach.memory = [
      { role: "user", text: "secret", ts: "2026-01-01T00:00:00.000Z", topics: ["secret"] },
      { role: "coach", text: "question", ts: "2026-01-01T00:00:01.000Z", topics: ["question"] }
    ];
    STATE.coach.topicCounts = { secret: 1 };
    STATE.coach.facts = [{ ts: "2026-01-01T00:00:00.000Z", fact: "secret" }];

    forgetRecentCoachConversation();
    globalThis.__result = {
      mode: STATE.coach.mode,
      currentTopic: STATE.profile.interviewProgress.currentTopic,
      memoryLength: STATE.coach.memory.length,
      memoryText: STATE.coach.memory[0].text,
      factCount: STATE.coach.facts.length,
      topicCount: Object.keys(STATE.coach.topicCounts).length
    };
  `);

  assert.deepStrictEqual(result, {
    mode: "free",
    currentTopic: null,
    memoryLength: 1,
    memoryText: "I've forgotten the recent conversation. Goals, plans, and your interview profile are still here.",
    factCount: 0,
    topicCount: 0
  });
}

testLegacyMigrationSurvivesQuotaFailure();
testCoachRefreshDoesNotWipeNonHomeRoutes();
testInterviewSuggestionControlsDoNotBecomeAnswers();
testForgetRecentClearsRecallAndPausesInterview();

console.log("OK behavior regression checks passed");
