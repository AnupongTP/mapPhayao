const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash, createHmac } = require("node:crypto");
const { createAppsScriptDriveBridge } = require("../src/services/appsScriptDriveBridge");
const { createGoogleParcelIntegration, PARCEL_HEADERS } = require("../src/services/googleParcelIntegration");
const { googleErrorDetails } = require("../src/utils/googleError");
const { logGoogleFailure } = require("../src/utils/googleError");
const parcelImageService = require("../src/services/parcelImageService");
const parcelService = require("../src/services/parcelService");
const parcelMirrorService = require("../src/services/parcelMirrorService");
const sharp = require("sharp");

const url = "https://script.google.com/macros/s/fake/exec";
const secret = "LOCAL_TEST_SECRET";
const env = {
  GOOGLE_MIRROR_ENABLED: "true",
  GOOGLE_SERVICE_ACCOUNT_JSON: '{"client_email":"fake@example.invalid"}',
  GOOGLE_SHEETS_SPREADSHEET_ID: "fake-sheet",
  GOOGLE_DRIVE_PROVIDER: "apps-script",
  GOOGLE_DRIVE_APPS_SCRIPT_URL: url,
  GOOGLE_DRIVE_APPS_SCRIPT_SECRET: secret,
  GOOGLE_DRIVE_PARCEL_IMAGE_FOLDER_ID: "oauth-folder-should-not-be-used",
  GOOGLE_DRIVE_OAUTH_CLIENT_ID: "oauth-client-should-not-be-used",
  GOOGLE_DRIVE_OAUTH_CLIENT_SECRET: "oauth-secret-should-not-be-used",
  GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN: "oauth-refresh-should-not-be-used",
};

function harness(reply = { success: true, fileId: "file_1" }) {
  const calls = [];
  const fetchImpl = async (target, options) => {
    calls.push({ target, options, payload: JSON.parse(options.body) });
    return { ok: true, status: 200, async json() { return reply; } };
  };
  const bridge = createAppsScriptDriveBridge({ url, secret, fetchImpl,
    now: () => 1700000000123, randomBytesImpl: (length) => Buffer.alloc(length, 7) });
  return { bridge, calls, fetchImpl };
}

test("upload signs exact canonical fields, Base64-string digest, seconds, and URL-safe nonce", async () => {
  const { bridge, calls } = harness();
  const bytes = Buffer.from([0, 255, 100, 10]);
  assert.equal(await bridge.uploadImage(bytes, "parcel_1.webp"), "file_1");
  const { target, options, payload } = calls[0];
  assert.equal(target, url);
  assert.equal(options.method, "POST");
  assert.equal(options.headers["Content-Type"], "application/json");
  assert.equal(payload.v, "1");
  assert.equal(payload.op, "upload");
  assert.equal(payload.ts, 1700000000);
  assert.equal(payload.nonce, Buffer.alloc(18, 7).toString("base64url"));
  assert.match(payload.nonce, /^[A-Za-z0-9_-]+$/);
  assert.equal(payload.filename, "parcel_1.webp");
  assert.equal(payload.mimeType, "image/webp");
  assert.equal(payload.fileId, "");
  assert.equal(payload.contentBase64, bytes.toString("base64"));
  assert.equal(payload.contentSha256,
    createHash("sha256").update(payload.contentBase64, "utf8").digest("hex"));
  assert.notEqual(payload.contentSha256, createHash("sha256").update(bytes).digest("hex"));
  const canonical = ["1", "upload", "1700000000", payload.nonce, "parcel_1.webp", "image/webp", "",
    payload.contentSha256].join("\n");
  assert.equal(payload.signature, createHmac("sha256", secret).update(canonical).digest("base64url"));
  assert.match(payload.signature, /^[A-Za-z0-9_-]+$/);
  assert.equal(payload.signature.includes("="), false);
});

test("default nonce generator is random and changes for consecutive requests", async () => {
  const calls = [];
  const bridge = createAppsScriptDriveBridge({ url, secret, fetchImpl: async (_target, options) => {
    calls.push(JSON.parse(options.body));
    return { ok: true, async json() { return { success: true }; } };
  } });
  await bridge.deleteImage("file_1");
  await bridge.deleteImage("file_1");
  assert.match(calls[0].nonce, /^[A-Za-z0-9_-]{24}$/);
  assert.notEqual(calls[0].nonce, calls[1].nonce);
});

test("read decodes bytes to the existing stream contract; delete signs only trusted file ID", async () => {
  const { bridge, calls } = harness({ success: true, contentBase64: Buffer.from("webp").toString("base64") });
  const chunks = [];
  for await (const chunk of await bridge.getImage("file_1")) chunks.push(chunk);
  assert.equal(Buffer.concat(chunks).toString(), "webp");
  assert.deepEqual({ op: calls[0].payload.op, fileId: calls[0].payload.fileId,
    filename: calls[0].payload.filename, mimeType: calls[0].payload.mimeType,
    contentSha256: calls[0].payload.contentSha256 },
  { op: "read", fileId: "file_1", filename: "", mimeType: "", contentSha256: "" });
  const deletion = harness({ success: true });
  await deletion.bridge.deleteImage("file_1");
  assert.equal(deletion.calls[0].payload.op, "delete");
  assert.equal(deletion.calls[0].payload.fileId, "file_1");
  assert.equal("contentBase64" in deletion.calls[0].payload, false);
});

test("malformed, rejected and failed HTTP bridge responses have safe stages and categories", async () => {
  for (const [reply, category] of [
    [{ success: false, error: `signature=${secret}` }, "rejected"],
    [{ success: true, fileId: "not a file id" }, "invalid-file-id"],
  ]) {
    const { bridge } = harness(reply);
    await assert.rejects(() => bridge.uploadImage(Buffer.from("webp"), "a.webp"), (error) => {
      const details = googleErrorDetails(error);
      assert.equal(details.category, category);
      assert.equal(JSON.stringify(details).includes(secret), false);
      return true;
    });
  }
  const http = createAppsScriptDriveBridge({ url, secret,
    fetchImpl: async () => ({ ok: false, status: 502 }) });
  await assert.rejects(() => http.deleteImage("file_1"), (error) =>
    error.googleStage === "apps-script-http" && googleErrorDetails(error).status === 502);
  const malformed = createAppsScriptDriveBridge({ url, secret,
    fetchImpl: async () => ({ ok: true, async json() { throw new Error(`base64=${secret}`); } }) });
  await assert.rejects(() => malformed.deleteImage("file_1"), (error) =>
    googleErrorDetails(error).category === "invalid-json" && !error.message.includes(secret));
  const { bridge: invalidRead } = harness({ success: true, contentBase64: "!!!!" });
  await assert.rejects(() => invalidRead.getImage("file_1"), (error) =>
    googleErrorDetails(error).category === "invalid-content");
});

test("Apps Script provider never instantiates OAuth Drive or silently falls back", async () => {
  let driveCalls = 0;
  const sheetCalls = [];
  const google = {
    auth: { GoogleAuth: class { constructor(options) { this.options = options; } },
      OAuth2: class { constructor() { throw new Error("OAuth must not run"); } } },
    sheets({ auth }) {
      assert.deepEqual(auth.options.scopes, ["https://www.googleapis.com/auth/spreadsheets"]);
      return { spreadsheets: { values: {
        async get({ range }) {
          return { data: { values: range === "parcels!A1:P1" ? [PARCEL_HEADERS] : [] } };
        },
        async append(args) { sheetCalls.push(args); },
      } } };
    },
    drive() { driveCalls++; throw new Error("OAuth Drive must not run"); },
  };
  const bridgeCalls = [];
  const integration = createGoogleParcelIntegration(env, google, {
    fetchImpl: async (_target, options) => {
      bridgeCalls.push(JSON.parse(options.body));
      return { ok: true, async json() { return { success: false, error: "unavailable" }; } };
    },
  });
  await integration.upsertParcel({ owner_user_id: "owner", parcel_code: "PY-1", crop_type: "rice", geometry: {} });
  assert.equal(sheetCalls.length, 1);
  assert.deepEqual(JSON.parse(sheetCalls[0].requestBody.values[0][11]), []);
  assert.deepEqual(JSON.parse(sheetCalls[0].requestBody.values[0][12]), []);
  await assert.rejects(() => integration.uploadImage(Buffer.from("webp"), "a.webp"),
    { googleStage: "apps-script-upload" });
  assert.equal(bridgeCalls.length, 1);
  assert.equal(driveCalls, 0);
  assert.equal(sheetCalls.length, 1);
});

test("missing or invalid Apps Script config fails closed while Sheets stays available", async () => {
  assert.throws(() => createAppsScriptDriveBridge({ url: "http://unsafe.invalid", secret }),
    { googleStage: "drive-config" });
  assert.throws(() => createAppsScriptDriveBridge({ url: "https://unrelated.example/macros/s/fake/exec", secret }),
    { googleStage: "drive-config" });
  const google = {
    auth: { GoogleAuth: class {} },
    sheets() { return { spreadsheets: { values: { async get() { return { data: { values: [] } }; },
      async append() {} } } }; },
    drive() { throw new Error("OAuth must not run"); },
  };
  const integration = createGoogleParcelIntegration({ ...env, GOOGLE_DRIVE_APPS_SCRIPT_SECRET: "" }, google);
  await integration.upsertUser({ id: "owner" });
  await assert.rejects(() => integration.getImage("file_1"), { statusCode: 503 });
});

test("failed Sheet append triggers a signed Apps Script delete of the uploaded file", async () => {
  const operations = [];
  const bridge = createAppsScriptDriveBridge({ url, secret, fetchImpl: async (_target, options) => {
    const payload = JSON.parse(options.body);
    operations.push(payload);
    return { ok: true, async json() {
      return payload.op === "upload" ? { success: true, fileId: "uploaded_file" } : { success: true };
    } };
  } });
  const originalLookup = parcelService.getOwnedParcelById;
  const originalMirror = parcelMirrorService.mirrorParcel;
  parcelService.getOwnedParcelById = async () => ({ id: "parcel-id", parcelCode: "PY-1" });
  parcelMirrorService.mirrorParcel = async () => {};
  try {
    const buffer = await sharp({ create: { width: 4, height: 4, channels: 3,
      background: "green" } }).png().toBuffer();
    await assert.rejects(() => parcelImageService.uploadOwnedImage("parcel-id", "owner", { buffer }, {
      enabled: true,
      uploadImage: bridge.uploadImage,
      deleteImage: bridge.deleteImage,
      async appendParcelImage() { throw new Error("Sheet append failed"); },
    }), /Sheet append failed/);
    assert.deepEqual(operations.map((operation) => operation.op), ["upload", "delete"]);
    assert.equal(operations[1].fileId, "uploaded_file");
    assert.equal(operations[0].filename.endsWith(".webp"), true);
  } finally {
    parcelService.getOwnedParcelById = originalLookup;
    parcelMirrorService.mirrorParcel = originalMirror;
  }
});

test("bridge diagnostics never log secret, signature, Base64 or provider response", async () => {
  const bytes = Buffer.from("SENSITIVE_IMAGE_BYTES");
  const { bridge, calls } = harness({ success: false, error: `secret=${secret}` });
  let caught;
  try { await bridge.uploadImage(bytes, "test.webp"); } catch (error) { caught = error; }
  assert.ok(caught);
  const output = [];
  const original = console.error;
  console.error = (...args) => output.push(args);
  try { logGoogleFailure("google-parcel-operation-failed", caught); } finally { console.error = original; }
  const logged = JSON.stringify(output);
  assert.equal(logged.includes(secret), false);
  assert.equal(logged.includes(calls[0].payload.signature), false);
  assert.equal(logged.includes(calls[0].payload.contentBase64), false);
  assert.deepEqual(output[0][1], { stage: "apps-script-upload", category: "rejected",
    message: "Google API request failed" });
});
