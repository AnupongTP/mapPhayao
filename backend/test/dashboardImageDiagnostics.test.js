const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { Readable } = require("node:stream");
const { createDashboardRoutes } = require("../src/routes/dashboardRoutes");
const { createGoogleParcelIntegration, PARCEL_HEADERS, imageLink } =
  require("../src/services/googleParcelIntegration");
const { categoryFor, createDashboardImageDiagnostic } = require("../src/utils/dashboardImageDiagnostic");
const { createAppsScriptDriveBridge } = require("../src/services/appsScriptDriveBridge");

const FILE_ID = "PRIVATE_DRIVE_FILE_ID";
const SECRET = "PRIVATE_OAUTH_SECRET";
const REFRESH = "PRIVATE_REFRESH_TOKEN";

function createHarness(failure) {
  const events = [];
  const calls = [];
  const logger = {
    info(name, fields) { events.push({ name, fields }); },
    warn(name, fields) { events.push({ name, fields }); },
  };
  const cells = Array(16).fill("");
  cells[2] = "PY-TEST-01";
  cells[3] = "Test parcel";
  cells[4] = "rice";
  cells[11] = JSON.stringify(["private.webp"]);
  cells[12] = JSON.stringify([imageLink(FILE_ID)]);
  cells[14] = "2026-09-28 10:00:00";
  class GoogleAuth {}
  class OAuth2 {
    setCredentials() {}
    async getRequestMetadataAsync() {
      calls.push("oauth");
      if (failure === "oauth") {
        const error = new Error(`invalid_grant ${SECRET} ${REFRESH}`);
        error.response = { status: 400, data: { error: "invalid_grant", token: REFRESH } };
        throw error;
      }
      return { headers: { authorization: `Bearer ${SECRET}` } };
    }
  }
  const googleApi = {
    auth: { GoogleAuth, OAuth2 },
    sheets() { return { spreadsheets: { values: { async get() {
      return { data: { values: [PARCEL_HEADERS, cells] } };
    } } } }; },
    drive({ auth }) { return { files: { async get() {
      await auth.getRequestMetadataAsync();
      calls.push("drive-get");
      if (failure === 403 || failure === 404) {
        const error = new Error(`Drive failure ${FILE_ID} ${SECRET}`);
        error.response = { status: failure, data: { secret: SECRET } };
        throw error;
      }
      if (failure === "stream") {
        return { data: new Readable({ read() { this.destroy(new Error(`stream ${SECRET}`)); } }) };
      }
      return { data: Readable.from(Buffer.from("webp-test")) };
    } } }; },
  };
  const integration = createGoogleParcelIntegration({ GOOGLE_MIRROR_ENABLED: "true",
    GOOGLE_SERVICE_ACCOUNT_JSON: '{"client_email":"fake@example.invalid"}',
    GOOGLE_SHEETS_SPREADSHEET_ID: "fake-sheet", GOOGLE_DRIVE_PROVIDER: "",
    GOOGLE_DRIVE_READ_PROVIDER: "oauth", GOOGLE_DRIVE_OAUTH_CLIENT_ID: "PRIVATE_CLIENT_ID",
    GOOGLE_DRIVE_OAUTH_CLIENT_SECRET: SECRET, GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN: REFRESH }, googleApi);
  const app = express();
  app.use("/api/public/dashboard", createDashboardRoutes({ googleIntegration: integration,
    database: { async query() { return { rows: [] }; } }, logger }));
  return { app, events, calls };
}

async function withServer(app, callback) {
  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise((resolve) => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}/api/public/dashboard`;
    const summary = await (await fetch(`${base}/summary`)).json();
    assert.equal(summary.success, true);
    return await callback(`${base}/images/PY-TEST-01/0?snapshot=${summary.snapshotVersion}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function assertSafe(events, responseText = "") {
  const output = JSON.stringify(events) + responseText;
  for (const secret of [FILE_ID, SECRET, REFRESH, "PRIVATE_CLIENT_ID", "drive.google.com"]) {
    assert.equal(output.includes(secret), false, `unexpected sensitive value: ${secret.slice(0, 7)}`);
  }
  const ids = new Set(events.map(({ fields }) => fields.requestId));
  assert.equal(ids.size, 1);
  assert.match([...ids][0], /^[A-F0-9]{8}$/);
}

test("unknown path values resembling Drive IDs are not echoed in server logs", async () => {
  const h = createHarness();
  await withServer(h.app, async (url) => {
    const response = await fetch(url.replace("PY-TEST-01", FILE_ID));
    assert.equal(response.status, 404);
    assertSafe(h.events, await response.text());
  });
  assert.deepEqual(h.calls, []);
  assert.equal(h.events.find(({ name }) => name === "dashboard-image-failed")?.fields.category,
    "parcel-not-found");
});

test("stream failure is logged but cannot be reported as response complete", async () => {
  const h = createHarness("stream");
  await withServer(h.app, async (url) => {
    try { await (await fetch(url)).arrayBuffer(); } catch { /* A broken stream may terminate fetch. */ }
  });
  assert.equal(h.events.some(({ name }) => name === "dashboard-image-complete"), false);
  assert.equal(h.events.find(({ name }) => name === "dashboard-image-failed")?.fields.category,
    "response-stream-error");
  assertSafe(h.events);
});

test("remaining provider failures use only allowlisted diagnostic categories", () => {
  const providerError = (status) => ({ response: { status } });
  assert.equal(categoryFor({ googleStage: "drive-config" }, "DRIVE_PROVIDER_SELECTED", "oauth"),
    "oauth-config-missing");
  assert.equal(categoryFor(providerError(401), "OAUTH_TOKEN_REQUEST_STARTED"), "oauth-http-401");
  assert.equal(categoryFor(providerError(401), "DRIVE_READ_STARTED"), "drive-http-401");
  assert.equal(categoryFor(providerError(429), "DRIVE_READ_STARTED"), "drive-rate-limited");
  assert.equal(categoryFor({ code: "ETIMEDOUT" }, "DRIVE_READ_STARTED"), "drive-timeout");
  assert.equal(categoryFor({ code: "ECONNRESET" }, "DRIVE_READ_STARTED"), "drive-network-error");
  assert.equal(categoryFor({ dashboardImageCategory: SECRET }, "DRIVE_READ_STARTED"),
    "unknown-drive-read-error");
  const events = [];
  const diagnostic = createDashboardImageDiagnostic({ info(name, fields) { events.push(fields); },
    warn(name, fields) { events.push(fields); } });
  diagnostic.fail({ dashboardImageCategory: SECRET }, SECRET);
  assert.equal(JSON.stringify(events).includes(SECRET), false);
});

test("Apps Script read failures retain only safe bridge categories and HTTP status", () => {
  for (const [bridgeCategory, expected] of Object.entries({
    timeout: "apps-script-timeout", aborted: "apps-script-aborted",
    network: "apps-script-network-error", http: "apps-script-http-error",
    rejected: "apps-script-rejected", "invalid-json": "apps-script-invalid-json",
    "invalid-content": "apps-script-invalid-content",
  })) {
    const error = { googleStage: bridgeCategory === "http" ? "apps-script-http" : "apps-script-read",
      bridgeCategory, statusCode: bridgeCategory === "http" ? 503 : undefined,
      message: `${SECRET} ${FILE_ID}` };
    assert.equal(categoryFor(error, "DRIVE_READ_STARTED", "apps-script"), expected);
    const events = [];
    const diagnostic = createDashboardImageDiagnostic({ info() {}, warn(name, fields) {
      events.push({ name, fields });
    } });
    diagnostic.context({ provider: "apps-script", parcelCode: "PY-TEST-01", photoIndex: 0 });
    diagnostic.mark("DRIVE_READ_STARTED");
    diagnostic.fail(error);
    assert.equal(events[0].fields.category, expected);
    assert.equal(events[0].fields.providerStatus, bridgeCategory === "http" ? 503 : undefined);
    assertSafe(events);
  }
  assert.equal(categoryFor({ googleStage: "apps-script-read", bridgeCategory: SECRET },
    "DRIVE_READ_STARTED", "apps-script"), "unknown-drive-read-error");
});

test("public Apps Script image route sanitizes pre-header failures and logs their safe cause", async () => {
  const replies = [
    { fetchImpl: async () => { throw new DOMException(SECRET, "TimeoutError"); },
      category: "apps-script-timeout" },
    { fetchImpl: async () => { throw new TypeError(SECRET); },
      category: "apps-script-network-error" },
    { fetchImpl: async () => ({ ok: false, status: 503 }),
      category: "apps-script-http-error", status: 503 },
    { fetchImpl: async () => ({ ok: true, async json() { return { success: false, error: SECRET }; } }),
      category: "apps-script-rejected" },
  ];
  for (const { fetchImpl, category, status } of replies) {
    const events = [];
    const cells = Array(16).fill("");
    cells[2] = "PY-TEST-01";
    cells[11] = JSON.stringify(["private.webp"]);
    cells[12] = JSON.stringify([imageLink(FILE_ID)]);
    const bridge = createAppsScriptDriveBridge({
      url: "https://script.google.com/macros/s/fake/exec", secret: SECRET, fetchImpl,
    });
    const integration = {
      enabled: true, readProvider: "apps-script",
      async readDashboardRows() { return [cells]; },
      getImage(fileId) { assert.equal(fileId, FILE_ID); return bridge.getImage(fileId); },
    };
    const app = express();
    app.use("/api/public/dashboard", createDashboardRoutes({ googleIntegration: integration,
      database: { async query() { return { rows: [] }; } },
      logger: { info(name, fields) { events.push({ name, fields }); },
        warn(name, fields) { events.push({ name, fields }); } } }));
    await withServer(app, async (url) => {
      const response = await fetch(url);
      assert.equal(response.status, 503);
      assertSafe(events, await response.text());
    });
    const failed = events.find(({ name }) => name === "dashboard-image-failed");
    assert.equal(failed.fields.category, category);
    assert.equal(failed.fields.providerStatus, status);
    assert.equal(failed.fields.lastSuccessfulStage, "DRIVE_PROVIDER_SELECTED");
  }
});
