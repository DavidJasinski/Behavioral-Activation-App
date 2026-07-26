#!/usr/bin/env node
/**
 * Regression: Coach UI must stay live on the Home route, and interview
 * suggestion chips must act as commands (not profile answers).
 */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const APP_JS = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");

assert.match(
  APP_JS,
  /function refreshAfterCoachChange\s*\(/,
  "refreshAfterCoachChange helper missing"
);
assert.equal(
  (APP_JS.match(/refreshAfterCoachChange\(\)/g) || []).length >= 5,
  true,
  "coachSend paths should refresh via refreshAfterCoachChange"
);
assert.doesNotMatch(
  APP_JS,
  /if \(route === "home"\) render\(\);\s*else drawCoach\(\);/,
  "stale home-only coach refresh pattern still present"
);
assert.match(
  APP_JS,
  /enough for now/,
  "pause handler should accept interview chip 'enough for now'"
);
assert.match(
  APP_JS,
  /skip\( this one\)\?/,
  "skip handler should accept interview chip 'skip this one'"
);
assert.match(
  APP_JS,
  /ask me something else/,
  "skip handler should accept interview chip 'ask me something else'"
);

function loadInterviewHandlers() {
  const start = APP_JS.indexOf("function capitalize(s) {");
  const end = APP_JS.indexOf("\nfunction composeInterviewSummary(");
  assert.ok(start >= 0 && end > start, "could not locate interview helpers");

  const sandbox = {
    STATE: {
      profile: {
        name: "",
        communicationStyle: null,
        challengeLevel: null,
        struggles: [],
        struggleNotes: [],
        avoiding: [],
        values: [],
        valueNotes: [],
        energizers: [],
        energizerNotes: [],
        pastWins: [],
        bestTimes: [],
        interviewNotes: [],
        interviewStarted: true,
        interviewComplete: false,
        interviewSkipped: false,
        interviewProgress: {
          askedTopics: [],
          currentTopic: "name",
          openCloseAsked: false
        }
      },
      preferences: { tone: "warm" },
      coach: { mode: "interview", memory: [], topicCounts: {}, facts: [] }
    },
    INTERVIEW_TOPICS: null,
    console,
    extractTopics() {
      return [];
    },
    truncate(s, n) {
      s = String(s || "");
      return s.length > n ? s.slice(0, n - 1) + "…" : s;
    }
  };
  sandbox.pushMemory = function pushMemory(entry) {
    sandbox.STATE.coach.memory.push({
      ts: new Date().toISOString(),
      role: entry.role,
      text: entry.text,
      topics: []
    });
  };

  // Provide INTERVIEW_TOPICS from source by evaluating a thin slice + the name topic.
  const topicsStart = APP_JS.indexOf("const INTERVIEW_TOPICS = [");
  const topicsEnd = APP_JS.indexOf("\nfunction capitalize(s) {");
  assert.ok(topicsStart >= 0 && topicsEnd > topicsStart, "INTERVIEW_TOPICS missing");

  vm.createContext(sandbox);
  vm.runInContext(APP_JS.slice(topicsStart, topicsEnd), sandbox);
  vm.runInContext(APP_JS.slice(start, end), sandbox);
  return sandbox;
}

const sandbox = loadInterviewHandlers();

function resetNameQuestion() {
  sandbox.STATE.profile.name = "";
  sandbox.STATE.profile.interviewProgress = {
    askedTopics: [],
    currentTopic: "name",
    openCloseAsked: false
  };
  sandbox.STATE.coach.mode = "interview";
  sandbox.STATE.coach.memory = [];
}

resetNameQuestion();
sandbox.handleInterviewAnswer("skip this one");
assert.equal(sandbox.STATE.profile.name, "", "skip this one must not become the name");
assert.equal(sandbox.STATE.coach.mode, "interview", "skip should stay in interview");
assert.ok(
  sandbox.STATE.profile.interviewProgress.askedTopics.includes("name"),
  "skip should consume the current topic"
);

resetNameQuestion();
sandbox.handleInterviewAnswer("enough for now");
assert.equal(sandbox.STATE.profile.name, "", "enough for now must not become the name");
assert.equal(sandbox.STATE.coach.mode, "free", "enough for now should pause interview");

resetNameQuestion();
sandbox.handleInterviewAnswer("ask me something else");
assert.equal(sandbox.STATE.profile.name, "", "ask me something else must not become the name");
assert.ok(
  sandbox.STATE.profile.interviewProgress.askedTopics.includes("name"),
  "ask me something else should skip the current topic"
);

console.log("OK coach home refresh + interview chip checks passed");
