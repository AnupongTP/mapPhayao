const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function createStorage() {
  return {
    values: new Map(),
    setItem(key, value) {
      this.values.set(key, value);
    },
    getItem(key) {
      return this.values.get(key) || null;
    },
  };
}

function createDocument() {
  return {
    head: {
      appendChild() {},
    },
    querySelector() {
      return null;
    },
    createElement() {
      return {
        addEventListener() {},
      };
    },
  };
}

function createHarness({ search = "?liff=1", token = "id-token", loggedIn = true } = {}) {
  const initCalls = [];
  const tokenCalls = [];
  const logs = [];
  const localStorage = createStorage();
  const sessionStorage = createStorage();
  const context = {
    URLSearchParams,
    Promise,
    Error,
    Boolean,
    window: {
      location: { search },
      LiffConfig: { liffId: "test-liff-id" },
      liff: {
        init: async (options) => {
          initCalls.push(options);
        },
        isLoggedIn: () => loggedIn,
        getIDToken: () => {
          tokenCalls.push("getIDToken");
          return token;
        },
        isInClient: () => true,
        closeWindow: () => true,
      },
      localStorage,
      sessionStorage,
    },
    document: createDocument(),
    console: {
      log: (...args) => logs.push(args),
      info: (...args) => logs.push(args),
      warn: (...args) => logs.push(args),
      error: (...args) => logs.push(args),
    },
  };
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, "../js/liff-mode.js"), "utf8"),
    context,
  );
  return {
    MapLiffMode: context.window.MapLiffMode,
    initCalls,
    tokenCalls,
    logs,
    localStorage,
    sessionStorage,
  };
}

test("getCurrentIdToken reuses existing LIFF initialization and does not init twice", async () => {
  const { MapLiffMode, initCalls, tokenCalls } = createHarness();

  assert.equal(await MapLiffMode.initialize(), true);
  assert.equal(await MapLiffMode.getCurrentIdToken(), "id-token");
  assert.equal(await MapLiffMode.getCurrentIdToken(), "id-token");

  assert.equal(initCalls.length, 1);
  assert.equal(initCalls[0].liffId, "test-liff-id");
  assert.equal(tokenCalls.length, 3);
});

test("non-LIFF mode and missing tokens return sanitized authentication failures", async () => {
  const nonLiff = createHarness({ search: "" });
  await assert.rejects(
    () => nonLiff.MapLiffMode.getCurrentIdToken(),
    (error) => error.statusCode === 401 && /LINE/.test(error.message),
  );
  assert.equal(nonLiff.initCalls.length, 0);

  const missing = createHarness({ token: "" });
  await assert.rejects(
    () => missing.MapLiffMode.getCurrentIdToken(),
    (error) => error.statusCode === 401 && /LINE/.test(error.message),
  );

  const loggedOut = createHarness({ loggedIn: false });
  await assert.rejects(
    () => loggedOut.MapLiffMode.getCurrentIdToken(),
    (error) => error.statusCode === 401 && /LINE/.test(error.message),
  );
});

test("token provider does not store or log tokens and exposes no LINE identity", async () => {
  const { MapLiffMode, logs, localStorage, sessionStorage } = createHarness({
    token: "secret-id-token",
  });

  const token = await MapLiffMode.getCurrentIdToken();

  assert.equal(token, "secret-id-token");
  assert.equal(localStorage.values.size, 0);
  assert.equal(sessionStorage.values.size, 0);
  assert.deepEqual(logs, []);
  assert.equal(typeof MapLiffMode.getUserId, "undefined");
  assert.equal(typeof MapLiffMode.getProfile, "undefined");
});
