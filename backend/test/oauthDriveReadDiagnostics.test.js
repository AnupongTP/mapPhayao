const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { Readable } = require("node:stream");
const { createDashboardRoutes } = require("../src/routes/dashboardRoutes");
const { createGoogleParcelIntegration, PARCEL_HEADERS, imageLink } =
  require("../src/services/googleParcelIntegration");

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

test("successful OAuth Dashboard read logs token and Drive stages", async () => {
  const h = createHarness();
  await withServer(h.app, async (url) => {
    const response = await fetch(url);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "webp-test");
  });
  assert.deepEqual(h.calls, ["oauth", "drive-get"]);
  const stages = h.events.map(({ fields }) => fields.stage);
  for (const stage of ["SNAPSHOT_RESOLVED", "PARCEL_FOUND", "PHOTO_INDEX_VALIDATED",
    "PHOTO_REFERENCE_RESOLVED", "DRIVE_PROVIDER_SELECTED", "OAUTH_TOKEN_REQUEST_STARTED",
    "OAUTH_TOKEN_READY", "DRIVE_READ_STARTED", "DRIVE_READ_HEADERS_RECEIVED",
    "DRIVE_READ_COMPLETE", "RESPONSE_STREAM_STARTED", "RESPONSE_COMPLETE"]) {
    assert.ok(stages.includes(stage), stage);
  }
  assert.equal(h.events.at(-1).name, "dashboard-image-complete");
  assertSafe(h.events);
});

test("OAuth invalid_grant is categorized and the browser receives only a request ID", async () => {
  const h = createHarness("oauth");
  await withServer(h.app, async (url) => {
    const response = await fetch(url);
    assert.equal(response.status, 503);
    const body = await response.text();
    assert.match(body, /requestId/);
    assertSafe(h.events, body);
  });
  assert.deepEqual(h.calls, ["oauth"]);
  const failed = h.events.find(({ name }) => name === "dashboard-image-failed");
  assert.equal(failed.fields.category, "oauth-invalid-grant");
  assert.equal(failed.fields.stage, "OAUTH_TOKEN_REQUEST_STARTED");
  assert.equal(failed.fields.lastSuccessfulStage, "DRIVE_PROVIDER_SELECTED");
});

for (const status of [403, 404]) {
  test(`OAuth Drive ${status} is distinguished without exposing provider data`, async () => {
    const h = createHarness(status);
    await withServer(h.app, async (url) => {
      const response = await fetch(url);
      assert.equal(response.status, 503);
      assertSafe(h.events, await response.text());
    });
    const failed = h.events.find(({ name }) => name === "dashboard-image-failed");
    assert.equal(failed.fields.category, status === 403 ? "drive-permission-denied" : "drive-file-not-found");
    assert.equal(failed.fields.providerStatus, status);
  });
}
