import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

function loadAppForRenderHelp() {
  const elements = {
    "#help-patterns": { innerHTML: "" },
    "#help-sources": { innerHTML: "" }
  };

  const sandbox = {
    console: { warn() {} },
    structuredClone: (value) => JSON.parse(JSON.stringify(value)),
    localStorage: {
      getItem() {
        return null;
      },
      setItem() {}
    },
    fetch() {
      return Promise.reject(new Error("knowledge unavailable"));
    },
    elements,
    document: {
      querySelector(selector) {
        return elements[selector] || null;
      },
      querySelectorAll(selector) {
        if (selector === "[data-help]") return [];
        return [];
      },
      addEventListener() {},
      createElement(tagName) {
        return { tagName, innerHTML: "", textContent: "", appendChild() {} };
      }
    },
    window: {}
  };

  const appSource = readFileSync(new URL("../app.js", import.meta.url), "utf8");
  vm.runInNewContext(
    `${appSource}
globalThis.__renderHelpTest = {
  elements,
  renderWithLoadedEmptyKnowledge() {
    route = "help";
    KNOWLEDGE = { docs: [], chunks: [], modalities: {} };
    let thenCalls = 0;
    KNOWLEDGE_PROMISE = {
      then() {
        thenCalls += 1;
        throw new Error("renderHelp should not wait again once knowledge is loaded");
      }
    };
    renderHelp();
    return { thenCalls, sourcesHtml: elements["#help-sources"].innerHTML };
  }
};`,
    sandbox
  );

  return sandbox.__renderHelpTest;
}

test("renderHelp does not resubscribe after knowledge resolves without docs", () => {
  const app = loadAppForRenderHelp();

  const result = app.renderWithLoadedEmptyKnowledge();

  assert.equal(result.thenCalls, 0);
  assert.match(result.sourcesHtml, /Knowledge index unavailable/);
});
