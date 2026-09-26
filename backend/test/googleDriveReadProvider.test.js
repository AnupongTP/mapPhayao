const test = require("node:test");
const assert = require("node:assert/strict");
const { Readable } = require("node:stream");
const { createGoogleParcelIntegration } = require("../src/services/googleParcelIntegration");
const { googleErrorDetails } = require("../src/utils/googleError");

const env = {
  GOOGLE_MIRROR_ENABLED: "true",
  GOOGLE_SERVICE_ACCOUNT_JSON: '{"client_email":"fake@example.invalid"}',
  GOOGLE_SHEETS_SPREADSHEET_ID: "fake-sheet",
  GOOGLE_DRIVE_PROVIDER: "apps-script",
  GOOGLE_DRIVE_APPS_SCRIPT_URL: "https://script.google.com/macros/s/fake/exec",
  GOOGLE_DRIVE_APPS_SCRIPT_SECRET: "fake-bridge-secret",
  GOOGLE_DRIVE_OAUTH_CLIENT_ID: "fake-client-id",
  GOOGLE_DRIVE_OAUTH_CLIENT_SECRET: "fake-client-secret",
  GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN: "fake-refresh-token",
};

function harness({ oauthError } = {}) {
  const bridgeOps = [];
  const oauthCalls = [];
  const directStream = Readable.from([Buffer.from("direct-webp")]);
  const google = {
    auth: {
      GoogleAuth: class {},
      OAuth2: class {
        constructor(clientId, clientSecret) {
          assert.equal(clientId, env.GOOGLE_DRIVE_OAUTH_CLIENT_ID);
          assert.equal(clientSecret, env.GOOGLE_DRIVE_OAUTH_CLIENT_SECRET);
        }
        setCredentials(credentials) {
          assert.deepEqual(credentials, { refresh_token: env.GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN });
        }
      },
    },
    sheets() { return { spreadsheets: { values: {} } }; },
    drive({ version }) {
      assert.equal(version, "v3");
      oauthCalls.push("client");
      return { files: {
        async get(args, options) {
          oauthCalls.push("get");
          assert.deepEqual(args, { fileId: "trusted-file", alt: "media" });
          assert.deepEqual(options, { responseType: "stream" });
          if (oauthError) throw oauthError;
          return { data: directStream };
        },
        create() { throw new Error("OAuth upload must not run"); },
        delete() { throw new Error("OAuth delete must not run"); },
      } };
    },
  };
  const bridgeOptions = { fetchImpl: async (_url, options) => {
    const payload = JSON.parse(options.body);
    bridgeOps.push(payload.op);
    return { ok: true, async json() {
      return payload.op === "read"
        ? { success: true, contentBase64: Buffer.from("bridge-webp").toString("base64") }
        : { success: true, fileId: "uploaded-file" };
    } };
  } };
  return { google, bridgeOptions, bridgeOps, oauthCalls, directStream };
}

async function contents(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks).toString();
}

test("missing, empty, and explicit apps-script read flags retain the bridge path", async () => {
  for (const flag of [undefined, "", "apps-script"]) {
    const fake = harness();
    const integration = createGoogleParcelIntegration(
      { ...env, GOOGLE_DRIVE_READ_PROVIDER: flag }, fake.google, fake.bridgeOptions);
    assert.equal(await contents(await integration.getImage("trusted-file")), "bridge-webp");
    assert.deepEqual(fake.bridgeOps, ["read"]);
    assert.deepEqual(fake.oauthCalls, []);
  }
});

test("oauth read returns the direct stream while upload and cleanup delete stay on Apps Script", async () => {
  const fake = harness();
  const integration = createGoogleParcelIntegration(
    { ...env, GOOGLE_DRIVE_READ_PROVIDER: "oauth" }, fake.google, fake.bridgeOptions);
  const stream = await integration.getImage("trusted-file");
  assert.equal(stream, fake.directStream);
  assert.equal(await contents(stream), "direct-webp");
  assert.deepEqual(fake.oauthCalls, ["client", "get"]);
  assert.deepEqual(fake.bridgeOps, []);
  assert.equal(await integration.uploadImage(Buffer.from("webp"), "photo.webp"), "uploaded-file");
  await integration.deleteImage("trusted-file");
  assert.deepEqual(fake.bridgeOps, ["upload", "delete"]);
});

test("oauth read failure stays sanitized and never falls back to Apps Script", async () => {
  const fake = harness({ oauthError: Object.assign(new Error("fake-refresh-token trusted-file"), {
    statusCode: 403, response: { status: 403, data: { secret: "fake-client-secret" } },
  }) });
  const integration = createGoogleParcelIntegration(
    { ...env, GOOGLE_DRIVE_READ_PROVIDER: "oauth" }, fake.google, fake.bridgeOptions);
  await assert.rejects(() => integration.getImage("trusted-file"), (error) => {
    assert.equal(error.statusCode, 503);
    assert.equal(error.googleStage, "drive-read");
    assert.doesNotMatch(JSON.stringify(googleErrorDetails(error)), /trusted-file|fake-refresh-token|fake-client-secret/);
    assert.doesNotMatch(error.message, /trusted-file|fake-refresh-token|fake-client-secret/);
    return true;
  });
  assert.deepEqual(fake.bridgeOps, []);
  assert.deepEqual(fake.oauthCalls, ["client", "get"]);
});

test("incomplete OAuth configuration and invalid read provider fail without bridge fallback", async () => {
  for (const config of [
    { GOOGLE_DRIVE_READ_PROVIDER: "oauth", GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN: "" },
    { GOOGLE_DRIVE_READ_PROVIDER: "other" },
  ]) {
    const fake = harness();
    const integration = createGoogleParcelIntegration({ ...env, ...config }, fake.google, fake.bridgeOptions);
    await assert.rejects(() => integration.getImage("trusted-file"), (error) =>
      error.statusCode === 503 && error.googleStage === "drive-config" &&
      !/fake-client|fake-refresh|trusted-file/.test(error.message));
    assert.deepEqual(fake.bridgeOps, []);
    assert.deepEqual(fake.oauthCalls, []);
    assert.equal(await integration.uploadImage(Buffer.from("webp"), "photo.webp"), "uploaded-file");
  }
});

test("cleanup worker still uses integration.deleteImage instead of the read provider", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const worker = fs.readFileSync(path.join(__dirname, "../src/services/parcelCleanupWorker.js"), "utf8");
  assert.match(worker, /await google\.deleteImage\(fileId\)/);
  assert.doesNotMatch(worker, /getImage\(/);
});
