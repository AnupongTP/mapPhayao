const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../js/config.js"), "utf8");

function apiBaseUrl(hostname, override) {
  const context = {
    window: {
      location: { hostname },
      __MAP_PHAYAO_E2E_CONFIG__: { apiBaseUrl: override },
    },
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return context.window.AppConfig.apiBaseUrl;
}

test("E2E API override is accepted only for an exact loopback URL on a local host", () => {
  assert.equal(
    apiBaseUrl("127.0.0.1", "http://127.0.0.1:3100/api"),
    "http://127.0.0.1:3100/api",
  );
  assert.equal(
    apiBaseUrl("localhost", "http://127.0.0.1:3100/api"),
    "http://127.0.0.1:3100/api",
  );
  for (const override of [
    "https://mapphayao-backend.onrender.com/api",
    "http://localhost:3100/api",
    "http://127.0.0.1:3100/api/extra",
    "http://127.0.0.1:3100/api?key=value",
  ]) {
    assert.equal(apiBaseUrl("127.0.0.1", override), "http://localhost:3000/api");
  }
  assert.equal(
    apiBaseUrl("mapphayaoliff.netlify.app", "http://127.0.0.1:3100/api"),
    "https://mapphayao-backend.onrender.com/api",
  );
});
