const test = require("node:test");
const assert = require("node:assert/strict");
const { Readable } = require("node:stream");
const { createGoogleParcelIntegration, PARCEL_HEADERS } = require("../src/services/googleParcelIntegration");

const env = {
  GOOGLE_MIRROR_ENABLED: "true",
  GOOGLE_DRIVE_PROVIDER: "oauth",
  GOOGLE_SERVICE_ACCOUNT_JSON: '{"client_email":"fake@example.invalid"}',
  GOOGLE_SHEETS_SPREADSHEET_ID: "fake-sheet",
  GOOGLE_DRIVE_PARCEL_IMAGE_FOLDER_ID: "fake-folder",
  GOOGLE_DRIVE_OAUTH_CLIENT_ID: "fake-client",
  GOOGLE_DRIVE_OAUTH_CLIENT_SECRET: "fake-secret",
  GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN: "fake-refresh",
};

function fakeGoogle() {
  const calls = [];
  class GoogleAuth {
    constructor(options) { this.options = options; }
  }
  class OAuth2 {
    constructor(clientId, clientSecret) { this.clientId = clientId; this.clientSecret = clientSecret; }
    setCredentials(credentials) { this.credentials = credentials; }
  }
  const google = {
    auth: { GoogleAuth, OAuth2 },
    sheets({ auth }) {
      calls.push({ operation: "sheets-client", auth });
      return { spreadsheets: { values: {
        async get({ range }) {
          calls.push({ operation: "sheets-get", range });
          return { data: { values: range === "parcels!A1:P1" ? [PARCEL_HEADERS] : [] } };
        },
        async append(args) { calls.push({ operation: "sheets-append", args }); },
      } } };
    },
    drive({ auth }) {
      calls.push({ operation: "drive-client", auth });
      return { files: {
        async create(args) { calls.push({ operation: "drive-create", args }); return { data: { id: "fake-id" } }; },
        async get(args, options) {
          calls.push({ operation: "drive-get", args, options });
          return { data: Readable.from(Buffer.from("webp")) };
        },
        async delete(args) { calls.push({ operation: "drive-delete", args }); },
      } };
    },
  };
  return { google, calls, GoogleAuth, OAuth2 };
}

test("Sheets uses service account while Drive create/read/delete use OAuth2", async () => {
  const fake = fakeGoogle();
  const integration = createGoogleParcelIntegration(env, fake.google);
  const sheetsAuth = fake.calls.find((call) => call.operation === "sheets-client").auth;
  const driveAuth = fake.calls.find((call) => call.operation === "drive-client").auth;
  assert.ok(sheetsAuth instanceof fake.GoogleAuth);
  assert.deepEqual(sheetsAuth.options.scopes, ["https://www.googleapis.com/auth/spreadsheets"]);
  assert.ok(driveAuth instanceof fake.OAuth2);
  assert.notEqual(driveAuth, sheetsAuth);
  assert.deepEqual(driveAuth.credentials, { refresh_token: env.GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN });
  await integration.upsertParcel({ owner_user_id: "owner", parcel_code: "PY-1", crop_type: "rice", geometry: {} });
  assert.ok(fake.calls.some((call) => call.operation === "sheets-append"));
  assert.equal(await integration.uploadImage(Buffer.from("webp"), "test.webp"), "fake-id");
  const upload = fake.calls.find((call) => call.operation === "drive-create").args;
  assert.deepEqual(upload.requestBody, { name: "test.webp", parents: ["fake-folder"] });
  assert.equal(upload.media.mimeType, "image/webp");
  assert.equal((await integration.getImage("fake-id")).readable, true);
  await integration.deleteImage("fake-id");
  assert.ok(fake.calls.some((call) => call.operation === "drive-get" && call.args.fileId === "fake-id"));
  assert.ok(fake.calls.some((call) => call.operation === "drive-delete" && call.args.fileId === "fake-id"));
});

test("missing Drive OAuth settings keep Sheets available and image operations fail sanitized", async () => {
  const fake = fakeGoogle();
  const integration = createGoogleParcelIntegration({ ...env, GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN: "" }, fake.google);
  assert.equal(fake.calls.some((call) => call.operation === "drive-client"), false);
  await integration.upsertUser({ id: "owner", display_name: "A" });
  assert.ok(fake.calls.some((call) => call.operation === "sheets-append"));
  await assert.rejects(() => integration.uploadImage(Buffer.from("webp"), "test.webp"), (error) =>
    error.statusCode === 503 && error.googleStage === "drive-config" &&
    !error.message.includes("fake-refresh"));
  await assert.rejects(() => integration.getImage("fake-id"), { statusCode: 503 });
  await assert.rejects(() => integration.deleteImage("fake-id"), { statusCode: 503 });
});

test("Drive provider must be explicit even when OAuth credentials exist", async () => {
  const fake = fakeGoogle();
  const integration = createGoogleParcelIntegration({ ...env, GOOGLE_DRIVE_PROVIDER: "" }, fake.google);
  assert.equal(fake.calls.some((call) => call.operation === "drive-client"), false);
  await assert.rejects(() => integration.uploadImage(Buffer.from("webp"), "test.webp"),
    { statusCode: 503, googleStage: "drive-config" });
});

test("Drive API failures keep their stage without logging provider payloads", async () => {
  const fake = fakeGoogle();
  fake.google.drive = ({ auth }) => {
    fake.calls.push({ operation: "drive-client", auth });
    return { files: { async create() {
      const error = new Error("refresh_token=PRIVATE");
      error.response = { status: 403, data: { error: { status: "PERMISSION_DENIED" } } };
      throw error;
    } } };
  };
  const integration = createGoogleParcelIntegration(env, fake.google);
  await assert.rejects(() => integration.uploadImage(Buffer.from("webp"), "test.webp"), (error) =>
    error.googleStage === "drive-upload" && error.response.status === 403);
});
