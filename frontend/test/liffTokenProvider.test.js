const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const CORRECT_LIFF_ID = "2010690813-INkgQOS1";
const CORRECT_LIFF_URL = "https://liff.line.me/2010690813-INkgQOS1";
const NEW_FRONTEND_ORIGIN = "https://dishes-prefix-revised-whom.trycloudflare.com";
const CORRECT_LIFF_ENDPOINT_URL =
  `${NEW_FRONTEND_ORIGIN}/mapphayao1/frontend/index.html?liff=1`;
const INCORRECT_LIFF_ID = "2010690813-INkqOQS1";
const EXPECTED_INIT_OPTIONS = {
  liffId: CORRECT_LIFF_ID,
  withLoginOnExternalBrowser: true,
};

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

function createElement(tagName) {
  const listeners = new Map();
  const element = {
    tagName,
    id: "",
    type: "",
    textContent: "",
    children: [],
    style: {},
    attributes: new Map(),
    parentNode: null,
    append(...items) {
      items.forEach((item) => this.appendChild(item));
    },
    appendChild(child) {
      child.parentNode = this;
      this.children.push(child);
      return child;
    },
    removeChild(child) {
      this.children = this.children.filter((item) => item !== child);
      child.parentNode = null;
    },
    remove() {
      if (this.parentNode) {
        this.parentNode.removeChild(this);
      }
    },
    setAttribute(name, value) {
      this.attributes.set(name, String(value));
    },
    addEventListener(type, handler) {
      const handlers = listeners.get(type) || [];
      handlers.push(handler);
      listeners.set(type, handlers);
    },
    click() {
      (listeners.get("click") || []).forEach((handler) => handler({ type: "click" }));
    },
  };
  return element;
}

function findById(node, id) {
  if (!node) {
    return null;
  }
  if (node.id === id) {
    return node;
  }
  for (const child of node.children || []) {
    const found = findById(child, id);
    if (found) {
      return found;
    }
  }
  return null;
}

function createDocument() {
  const body = createElement("body");
  const head = createElement("head");
  return {
    readyState: "complete",
    body,
    head,
    querySelector() {
      return null;
    },
    getElementById(id) {
      return findById(body, id) || findById(head, id);
    },
    createElement,
    addEventListener() {},
  };
}

function createHarness(options = {}) {
  const {
    search = "?liff=1",
    token = "id-token",
    loggedIn = true,
    inClient = true,
    initRejects = false,
    liffPresent = true,
    context = { type: "utou", viewType: "full", liffId: CORRECT_LIFF_ID, userId: "U-secret" },
  } = options;
  const hasConfiguredLiffId = Object.prototype.hasOwnProperty.call(options, "liffId");
  const configuredLiffId = hasConfiguredLiffId ? options.liffId : CORRECT_LIFF_ID;
  const initCalls = [];
  const loginCalls = [];
  const navigationCalls = [];
  const tokenCalls = [];
  const logs = [];
  const localStorage = createStorage();
  const sessionStorage = createStorage();
  const document = createDocument();
  const clipboardWrites = [];
  const liff = liffPresent
    ? {
        init: async (options) => {
          initCalls.push(options);
          if (initRejects) {
            throw new Error("raw init failure");
          }
        },
        isLoggedIn: () => loggedIn,
        getIDToken: () => {
          tokenCalls.push("getIDToken");
          return token;
        },
        isInClient: () => inClient,
        getLineVersion: () => "14.0.0",
        getContext: () => context,
        login: (options) => {
          loginCalls.push(options || {});
        },
        closeWindow: () => true,
      }
    : undefined;
  const window = {
    location: {
      search,
      origin: NEW_FRONTEND_ORIGIN,
      pathname: "/mapphayao1/frontend/index.html",
      hash: "#secret-fragment",
      replace: (value) => navigationCalls.push({ method: "location.replace", value }),
      assign: (value) => navigationCalls.push({ method: "location.assign", value }),
    },
    history: {
      replaceState: (...args) => navigationCalls.push({ method: "history.replaceState", args }),
      pushState: (...args) => navigationCalls.push({ method: "history.pushState", args }),
    },
    LiffConfig: hasConfiguredLiffId && configuredLiffId === undefined
      ? { liffUrl: CORRECT_LIFF_URL, endpointUrl: CORRECT_LIFF_ENDPOINT_URL }
      : {
          liffId: configuredLiffId,
          liffUrl: CORRECT_LIFF_URL,
          endpointUrl: CORRECT_LIFF_ENDPOINT_URL,
        },
    liff,
    navigator: {
      clipboard: {
        writeText: async (text) => {
          clipboardWrites.push(text);
        },
      },
    },
    localStorage,
    sessionStorage,
  };
  const contextObject = {
    URLSearchParams,
    Promise,
    Error,
    Boolean,
    JSON,
    window,
    document,
    console: {
      log: (...args) => logs.push(args),
      info: (...args) => logs.push(args),
      warn: (...args) => logs.push(args),
      error: (...args) => logs.push(args),
    },
  };
  vm.createContext(contextObject);
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, "../js/liff-mode.js"), "utf8"),
    contextObject,
  );
  return {
    MapLiffMode: contextObject.window.MapLiffMode,
    document,
    initCalls,
    loginCalls,
    navigationCalls,
    tokenCalls,
    logs,
    localStorage,
    sessionStorage,
    clipboardWrites,
  };
}

test("canonical LIFF config uses the exact case-sensitive public ID and URL", () => {
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, "../liff/liff-config.js"), "utf8"),
    context,
  );

  assert.equal(context.window.LiffConfig.liffId, CORRECT_LIFF_ID);
  assert.equal(context.window.LiffConfig.liffUrl, CORRECT_LIFF_URL);
  assert.equal(context.window.LiffConfig.endpointUrl, CORRECT_LIFF_ENDPOINT_URL);
  assert.notEqual(context.window.LiffConfig.endpointUrl, CORRECT_LIFF_URL);
  assert.notEqual(context.window.LiffConfig.liffId, INCORRECT_LIFF_ID);
});

test("getCurrentIdToken reuses existing LIFF initialization and does not init twice", async () => {
  const { MapLiffMode, initCalls, tokenCalls } = createHarness();

  assert.equal(await MapLiffMode.initialize(), true);
  assert.equal(await MapLiffMode.getCurrentIdToken(), "id-token");
  assert.equal(await MapLiffMode.getCurrentIdToken(), "id-token");

  assert.equal(initCalls.length, 1);
  assert.equal(initCalls[0].liffId, EXPECTED_INIT_OPTIONS.liffId);
  assert.equal(
    initCalls[0].withLoginOnExternalBrowser,
    EXPECTED_INIT_OPTIONS.withLoginOnExternalBrowser,
  );
  assert.deepEqual(Object.keys(initCalls[0]).sort(), [
    "liffId",
    "withLoginOnExternalBrowser",
  ]);
  assert.notEqual(initCalls[0].liffId, initCalls[0].liffId.toLowerCase());
  assert.notEqual(initCalls[0].liffId, initCalls[0].liffId.toUpperCase());
  assert.equal(tokenCalls.length, 3);
});

test("wrong, empty, and undefined LIFF IDs fail before liff.init", async () => {
  const wrong = createHarness({ liffId: INCORRECT_LIFF_ID });
  await assert.rejects(() => wrong.MapLiffMode.initialize(), /LIFF ID/);
  assert.equal(wrong.initCalls.length, 0);
  assert.equal(wrong.MapLiffMode.getDebugSnapshot().configuredIdMatchesExpected, false);

  const empty = createHarness({ liffId: "" });
  await assert.rejects(() => empty.MapLiffMode.initialize(), /LIFF ID/);
  assert.equal(empty.initCalls.length, 0);

  const missing = createHarness({ liffId: undefined });
  await assert.rejects(() => missing.MapLiffMode.initialize(), /LIFF ID/);
  assert.equal(missing.initCalls.length, 0);
});

test("leading and trailing LIFF ID whitespace is trimmed before strict exact validation", async () => {
  const { MapLiffMode, initCalls } = createHarness({
    liffId: `  ${CORRECT_LIFF_ID}  `,
  });

  assert.equal(await MapLiffMode.initialize(), true);
  assert.equal(initCalls[0].liffId, CORRECT_LIFF_ID);
  assert.equal(initCalls[0].withLoginOnExternalBrowser, true);
  assert.deepEqual(Object.keys(initCalls[0]).sort(), [
    "liffId",
    "withLoginOnExternalBrowser",
  ]);
});

test("pre-init false is not cached as final runtime state", async () => {
  const { MapLiffMode } = createHarness();
  const before = MapLiffMode.getDebugSnapshot();

  assert.equal(before.isInClient, null);
  assert.equal(before.currentApplicationLiffState, "idle");

  await MapLiffMode.initialize();
  const after = MapLiffMode.getDebugSnapshot();

  assert.equal(after.isInClient, true);
  assert.equal(after.isLoggedIn, true);
  assert.equal(after.currentApplicationLiffState, "ready-in-client-authenticated");
  assert.equal(after.authenticatedFeatureReady, true);
});

test("external unauthenticated startup uses automatic login configuration and keeps actions unavailable", async () => {
  const { MapLiffMode, initCalls, loginCalls } = createHarness({
    inClient: false,
    loggedIn: false,
    token: "",
  });

  assert.equal(await MapLiffMode.initialize(), false);
  const snapshot = MapLiffMode.getDebugSnapshot();

  assert.equal(initCalls.length, 1);
  assert.equal(initCalls[0].withLoginOnExternalBrowser, true);
  assert.deepEqual(loginCalls, []);
  assert.equal(snapshot.currentApplicationLiffState, "ready-external-unauthenticated");
  assert.equal(snapshot.withLoginOnExternalBrowserEnabled, true);
  assert.equal(snapshot.loginFlowExpected, true);
  assert.equal(snapshot.persistedParcelActionsEnabled, false);
  assert.equal(snapshot.lineSummaryEnabled, false);
  await assert.rejects(
    () => MapLiffMode.getCurrentIdToken(),
    (error) => error.statusCode === 401 && /LINE/.test(error.message),
  );
});

test("authenticated external browser can use token-backed features without in-client state", async () => {
  const { MapLiffMode, initCalls } = createHarness({
    inClient: false,
    loggedIn: true,
    token: "external-id-token",
  });

  assert.equal(await MapLiffMode.initialize(), true);
  assert.equal(await MapLiffMode.getCurrentIdToken(), "external-id-token");
  const snapshot = MapLiffMode.getDebugSnapshot();

  assert.equal(initCalls.length, 1);
  assert.equal(initCalls[0].withLoginOnExternalBrowser, true);
  assert.equal(snapshot.environment, "external");
  assert.equal(snapshot.isInClient, false);
  assert.equal(snapshot.isLoggedIn, true);
  assert.equal(snapshot.idTokenAvailable, true);
  assert.equal(snapshot.currentApplicationLiffState, "ready-external-authenticated");
  assert.equal(snapshot.authenticatedFeatureReady, true);
  assert.equal(snapshot.persistedParcelActionsEnabled, true);
  assert.equal(snapshot.lineSummaryEnabled, true);
});

test("authenticated LIFF browser remains supported", async () => {
  const { MapLiffMode } = createHarness({
    inClient: true,
    loggedIn: true,
    token: "in-client-id-token",
  });

  assert.equal(await MapLiffMode.initialize(), true);
  assert.equal(await MapLiffMode.getCurrentIdToken(), "in-client-id-token");
  const snapshot = MapLiffMode.getDebugSnapshot();

  assert.equal(snapshot.environment, "in-client");
  assert.equal(snapshot.currentApplicationLiffState, "ready-in-client-authenticated");
  assert.equal(snapshot.authenticatedFeatureReady, true);
});

test("initialization rejection creates a sanitized failed state", async () => {
  const { MapLiffMode } = createHarness({ initRejects: true });

  await assert.rejects(() => MapLiffMode.initialize(), /LIFF/);
  const snapshot = MapLiffMode.getDebugSnapshot();

  assert.equal(snapshot.currentApplicationLiffState, "failed");
  assert.equal(snapshot.initRejected, true);
  assert.equal(snapshot.idTokenAvailable, false);
  assert.equal(JSON.stringify(snapshot).includes("raw init failure"), false);
});

test("?liff=1 does not fake authentication without an in-client token", async () => {
  const { MapLiffMode } = createHarness({
    search: "?liff=1",
    inClient: false,
    loggedIn: false,
    token: "",
  });

  assert.equal(MapLiffMode.isEnabled(), true);
  assert.equal(await MapLiffMode.initialize(), false);
  assert.equal(MapLiffMode.isReady(), false);
  await assert.rejects(() => MapLiffMode.getCurrentIdToken(), /LINE/);
});

test("automatic external login does not introduce login loops or URL mutation", async () => {
  const { MapLiffMode, initCalls, loginCalls, navigationCalls } = createHarness({
    inClient: false,
    loggedIn: false,
    token: "",
    search: "?liff=1&liffDebug=1&liff.state=opaque",
  });

  assert.equal(await MapLiffMode.initialize(), false);
  assert.equal(initCalls.length, 1);
  assert.equal(initCalls[0].withLoginOnExternalBrowser, true);
  assert.deepEqual(loginCalls, []);
  assert.deepEqual(navigationCalls, []);
});

test("debug panel appears only with liffDebug=1 and can be closed", () => {
  const normal = createHarness({ search: "?liff=1" });
  assert.equal(normal.document.getElementById("liff-debug-panel"), null);

  const debug = createHarness({ search: "?liff=1&liffDebug=1" });
  assert.ok(debug.document.getElementById("liff-debug-panel"));
  assert.ok(debug.document.getElementById("liff-debug-copy"));

  debug.document.getElementById("liff-debug-close").click();
  assert.equal(debug.document.getElementById("liff-debug-panel"), null);
});

test("debug output is sanitized and copies no token, user ID, Authorization, or URL fragment", async () => {
  const { MapLiffMode, document, clipboardWrites } = createHarness({
    search: "?liff=1&liffDebug=1",
    token: "secret-id-token",
    inClient: false,
    loggedIn: true,
    context: {
      type: "utou",
      viewType: "full",
      liffId: CORRECT_LIFF_ID,
      userId: "U00000000000000000000000000000000",
      profile: { displayName: "Secret User" },
    },
  });

  await MapLiffMode.initialize();
  MapLiffMode.refreshDebugPanel();
  document.getElementById("liff-debug-copy").click();
  await Promise.resolve();

  const serialized = JSON.stringify(MapLiffMode.getDebugSnapshot());
  const snapshot = MapLiffMode.getDebugSnapshot();
  assert.equal(snapshot.currentApplicationLiffState, "ready-external-authenticated");
  assert.equal(snapshot.authenticatedFeatureReady, true);
  assert.equal(snapshot.origin, NEW_FRONTEND_ORIGIN);
  assert.equal(snapshot.pathname, "/mapphayao1/frontend/index.html");
  assert.equal(serialized.includes(NEW_FRONTEND_ORIGIN), true);
  assert.equal(serialized.includes("/mapphayao1/frontend/index.html"), true);
  assert.equal(serialized.includes("secret-id-token"), false);
  assert.equal(serialized.includes("U00000000000000000000000000000000"), false);
  assert.equal(serialized.includes("Authorization"), false);
  assert.equal(serialized.includes("access token"), false);
  assert.equal(serialized.includes("#secret-fragment"), false);
  assert.equal(serialized.includes("Secret User"), false);
  assert.equal(clipboardWrites.length, 1);
  assert.equal(clipboardWrites[0].includes(NEW_FRONTEND_ORIGIN), true);
  assert.equal(clipboardWrites[0].includes("/mapphayao1/frontend/index.html"), true);
  assert.equal(clipboardWrites[0].includes("secret-id-token"), false);
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
