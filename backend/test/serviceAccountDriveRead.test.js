const test = require("node:test");
const assert = require("node:assert/strict");
const { Readable } = require("node:stream");
const express = require("express");
const { createDashboardRoutes } = require("../src/routes/dashboardRoutes");
const { createGoogleParcelIntegration, PARCEL_HEADERS, imageLink } =
  require("../src/services/googleParcelIntegration");
const { googleErrorDetails } = require("../src/utils/googleError");
const { categoryFor } = require("../src/utils/dashboardImageDiagnostic");

const fileId = "PRIVATE_FILE_ID";
const folderId = "PRIVATE_FOLDER_ID";
const secret = "PRIVATE_CREDENTIAL";
const baseEnv = {
  GOOGLE_MIRROR_ENABLED: "true",
  GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({ client_email: secret }),
  GOOGLE_SHEETS_SPREADSHEET_ID: "PRIVATE_SHEET_ID",
  GOOGLE_DRIVE_PARCEL_IMAGE_FOLDER_ID: folderId,
  GOOGLE_DRIVE_PROVIDER: "apps-script",
  GOOGLE_DRIVE_READ_PROVIDER: "service-account",
  GOOGLE_DRIVE_APPS_SCRIPT_URL: "https://script.google.com/macros/s/fake/exec",
  GOOGLE_DRIVE_APPS_SCRIPT_SECRET: secret,
};

function harness({ metadata = { id: fileId, mimeType: "image/webp", parents: [folderId], trashed: false },
  failure, authFailure, streamFailure, env = {}, sheetRows } = {}) {
  const calls = [];
  const google = {
    auth: { GoogleAuth: class {
      constructor(options) {
        calls.push("auth-init");
        assert.deepEqual(options.scopes, options.scopes[0].includes("drive")
          ? ["https://www.googleapis.com/auth/drive.readonly"]
          : ["https://www.googleapis.com/auth/spreadsheets"]);
      }
      async getClient() { calls.push("auth-client"); if (authFailure) throw authFailure;
        return { async getAccessToken() { calls.push("auth-token"); return { token: secret }; } }; }
    } },
    sheets() { return { spreadsheets: { values: { async get() {
      return { data: { values: sheetRows } };
    } } } }; },
    drive({ version }) {
      assert.equal(version, "v3");
      calls.push("drive-init");
      return { files: {
        async get(args, options) {
          assert.equal(args.fileId, fileId);
          if (args.alt === "media") {
            calls.push("media");
            assert.equal(options.responseType, "stream");
            assert.equal(options.timeout, 30000);
            if (failure?.stage === "media") throw failure.error;
            return { data: streamFailure ? new Readable({ read() {
              this.destroy(new Error(`${secret} ${fileId}`));
            } }) : Readable.from(Buffer.from("webp")) };
          }
          calls.push("metadata");
          assert.equal(args.fields, "id,mimeType,parents,trashed,size");
          assert.equal(options.timeout, 30000);
          if (failure?.stage === "metadata") throw failure.error;
          return { data: metadata };
        },
        create() { throw new Error("Unexpected Drive write"); },
        delete() { throw new Error("Unexpected Drive delete"); },
      } };
    },
  };
  const bridgeOps = [];
  const bridgeOptions = { fetchImpl: async (_url, options) => {
    const op = JSON.parse(options.body).op;
    bridgeOps.push(op);
    return { ok: true, async json() { return op === "read"
      ? { success: true, contentBase64: Buffer.from("bridge").toString("base64") }
      : { success: true, fileId }; } };
  } };
  const integration = createGoogleParcelIntegration({ ...baseEnv, ...env }, google, bridgeOptions);
  return { integration, calls, bridgeOps };
}

async function body(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks).toString();
}

test("Service Account validates metadata then streams binary; writes remain on Apps Script", async () => {
  const { integration, calls, bridgeOps } = harness();
  assert.equal(integration.readProvider, "service-account");
  assert.equal(await body(await integration.getImage(fileId)), "webp");
  assert.deepEqual(calls, ["auth-init", "auth-init", "drive-init", "auth-client", "auth-token", "metadata", "media"]);
  assert.deepEqual(bridgeOps, []);
  await integration.uploadImage(Buffer.from("webp"), "test.webp");
  await integration.deleteImage(fileId);
  assert.deepEqual(bridgeOps, ["upload", "delete"]);
});

for (const [label, metadata, category] of [
  ["wrong parent", { id: fileId, mimeType: "image/webp", parents: ["other"] }, "drive-parent-mismatch"],
  ["trashed", { id: fileId, mimeType: "image/webp", parents: [folderId], trashed: true }, "drive-file-invalid"],
  ["wrong mime", { id: fileId, mimeType: "image/png", parents: [folderId] }, "drive-mime-invalid"],
  ["wrong id", { id: "other", mimeType: "image/webp", parents: [folderId] }, "drive-file-invalid"],
]) test(`${label} cannot reach media read`, async () => {
  const fake = harness({ metadata });
  await assert.rejects(() => fake.integration.getImage(fileId), (error) => {
    assert.equal(error.driveReadCategory, category);
    return true;
  });
  assert.equal(fake.calls.includes("media"), false);
});

for (const [label, options, category] of [
  ["auth", { authFailure: new Error(secret) }, "service-account-auth-failed"],
  ["permission", { failure: { stage: "metadata", error: { response: { status: 403, data: secret } } } },
    "service-account-permission-denied"],
  ["not found", { failure: { stage: "metadata", error: { response: { status: 404, data: secret } } } },
    "drive-file-not-found"],
  ["timeout", { failure: { stage: "media", error: { code: "ETIMEDOUT" } } }, "drive-read-timeout"],
  ["network", { failure: { stage: "media", error: { code: "ECONNRESET" } } }, "drive-network-error"],
  ["API", { failure: { stage: "media", error: new Error(secret) } }, "drive-api-error"],
]) test(`${label} failure is classified and sanitized without Apps Script fallback`, async () => {
  const fake = harness(options);
  await assert.rejects(() => fake.integration.getImage(fileId), (error) => {
    assert.equal(error.driveReadCategory, category);
    assert.equal(categoryFor(error, "DRIVE_READ_STARTED", "service-account"), category);
    assert.equal(googleErrorDetails(error).category, category);
    assert.doesNotMatch(JSON.stringify({ error: error.message, details: googleErrorDetails(error) }),
      /PRIVATE_/);
    return true;
  });
  assert.deepEqual(fake.bridgeOps, []);
});

test("stream error is sanitized", async () => {
  const fake = harness({ streamFailure: true });
  await assert.rejects(async () => body(await fake.integration.getImage(fileId)), (error) => {
    assert.equal(error.driveReadCategory, "drive-stream-error");
    assert.doesNotMatch(error.message, /PRIVATE_/);
    return true;
  });
});

test("missing folder and invalid read provider fail closed", async () => {
  for (const env of [{ GOOGLE_DRIVE_PARCEL_IMAGE_FOLDER_ID: "" },
    { GOOGLE_DRIVE_READ_PROVIDER: "unexpected" }]) {
    const fake = harness({ env });
    await assert.rejects(() => fake.integration.getImage(fileId), { statusCode: 503 });
    assert.deepEqual(fake.bridgeOps, []);
  }
});

test("explicit Apps Script rollback remains available", async () => {
  const fake = harness({ env: { GOOGLE_DRIVE_READ_PROVIDER: "apps-script" } });
  assert.equal(await body(await fake.integration.getImage(fileId)), "bridge");
  assert.deepEqual(fake.bridgeOps, ["read"]);
  assert.equal(fake.calls.includes("metadata"), false);
});

test("public Dashboard resolves only a snapshot photo and streams through Service Account", async () => {
  const row = Array(16).fill("");
  row[2] = "PY-TEST-01";
  row[3] = "Parcel";
  row[11] = JSON.stringify(["photo.webp"]);
  row[12] = JSON.stringify([imageLink(fileId)]);
  const fake = harness({ sheetRows: [PARCEL_HEADERS, row] });
  const events = [];
  const logger = { info(name, fields) { events.push({ name, fields }); },
    warn(name, fields) { events.push({ name, fields }); } };
  const app = express();
  app.use("/api/public/dashboard", createDashboardRoutes({ googleIntegration: fake.integration,
    database: { async query() { return { rows: [] }; } }, logger }));
  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise((resolve) => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}/api/public/dashboard`;
    const summary = await (await fetch(`${base}/summary`)).json();
    assert.equal(summary.success, true);
    const url = `${base}/images/PY-TEST-01/0?snapshot=${summary.snapshotVersion}`;
    const response = await fetch(url);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /image\/webp/);
    assert.equal(await response.text(), "webp");
    assert.equal((await fetch(`${base}/images/PY-TEST-01/1?snapshot=${summary.snapshotVersion}`)).status, 404);
    assert.equal((await fetch(`${base}/images/UNKNOWN/0?snapshot=${summary.snapshotVersion}`)).status, 404);
    assert.deepEqual(fake.bridgeOps, []);
    assert.equal(fake.calls.filter((call) => call === "media").length, 1);
    assert.equal(events.some(({ fields }) => fields.provider === "service-account"), true);
    assert.doesNotMatch(JSON.stringify(events) + JSON.stringify(summary),
      /PRIVATE_FILE_ID|PRIVATE_FOLDER_ID|PRIVATE_CREDENTIAL|PRIVATE_SHEET_ID|drive\.google\.com/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
