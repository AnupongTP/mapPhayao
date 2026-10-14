const test = require("node:test");
const assert = require("node:assert/strict");
const { Readable } = require("node:stream");
const { run } = require("../scripts/driveServiceAccountReadSmokeTest");
const { PARCEL_HEADERS, imageLink } = require("../src/services/googleParcelIntegration");

const env = {
  GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({
    client_email: "private@example.invalid", private_key: "SECRET_PRIVATE_KEY",
  }),
  GOOGLE_SHEETS_SPREADSHEET_ID: "SECRET_SHEET_ID",
  GOOGLE_DRIVE_PARCEL_IMAGE_FOLDER_ID: "SECRET_FOLDER_ID",
};

function fixture({ metadataError, metadataValues, streamError, authError, sheetError } = {}) {
  const calls = [];
  const row = Array(16).fill("");
  row[11] = JSON.stringify(["parcel_1.webp"]);
  row[12] = JSON.stringify([imageLink("SECRET_FILE_ID")]);
  const google = {
    auth: { GoogleAuth: class {
      constructor({ scopes }) { calls.push({ method: "auth", scopes }); }
      async getClient() { return { getAccessToken: async () => {
        if (authError) throw authError;
        return { token: "SECRET_ACCESS_TOKEN" };
      } }; }
    } },
    sheets: () => ({ spreadsheets: { values: { get: async () => {
      calls.push({ method: "sheets.values.get" });
      if (sheetError) throw sheetError;
      return { data: { values: [PARCEL_HEADERS, row] } };
    } } } }),
    drive: () => ({ files: { get: async (params) => {
      calls.push({ method: "drive.files.get", alt: params.alt || "metadata" });
      if (params.alt === "media") {
        if (streamError) return { data: Readable.from((async function* () { throw streamError; })()) };
        return { data: Readable.from([Buffer.from("WEBP")]) };
      }
      if (metadataError) throw metadataError;
      return { data: { id: "SECRET_FILE_ID", mimeType: "image/webp",
        parents: [env.GOOGLE_DRIVE_PARCEL_IMAGE_FOLDER_ID], trashed: false,
        ...metadataValues } };
    } } }),
  };
  return { google, calls };
}

async function probe(options = {}, config = env) {
  const { google, calls } = fixture(options);
  const output = [];
  const exitCode = await run({ env: config, google, log: (line) => output.push(line) });
  const printed = output.join("\n");
  for (const secret of ["SECRET_PRIVATE_KEY", "SECRET_SHEET_ID", "SECRET_FOLDER_ID",
    "SECRET_FILE_ID", "SECRET_ACCESS_TOKEN"]) assert.doesNotMatch(printed, new RegExp(secret));
  assert.ok(calls.every(({ method }) => ["auth", "sheets.values.get", "drive.files.get"].includes(method)));
  return { exitCode, output, calls };
}

test("service-account read probe streams a trusted Sheet image without writes or identifiers in output", async () => {
  const result = await probe();
  assert.equal(result.exitCode, 0);
  const success = JSON.parse(result.output[0]);
  assert.equal(success.result, "SUCCESS");
  assert.equal(success.bytes, 4);
  for (const field of ["authMs", "sheetMs", "metadataMs", "streamOpenMs", "firstByteMs",
    "fullReadMs", "totalMs"]) assert.ok(Number.isFinite(success[field]));
  assert.deepEqual(result.calls.filter(({ method }) => method === "drive.files.get")
    .map(({ alt }) => alt), ["metadata", "media"]);
});

test("service-account read probe fails safely without configuration", async () => {
  const result = await probe({}, {});
  assert.equal(result.exitCode, 1);
  assert.deepEqual(result.output, ["FAIL CONFIG_MISSING"]);
  assert.deepEqual(result.calls, []);
});

test("service-account read probe classifies auth, permission and not-found failures", async () => {
  assert.deepEqual((await probe({ authError: new Error("SECRET_PRIVATE_KEY") })).output,
    ["FAIL AUTH_FAILURE"]);
  assert.deepEqual((await probe({ metadataError: { response: { status: 403 } } })).output,
    ["FAIL PERMISSION_DENIED"]);
  assert.deepEqual((await probe({ metadataError: { response: { status: 404 } } })).output,
    ["FAIL FILE_NOT_FOUND"]);
});

test("service-account read probe classifies Sheet API and stream errors without raw details", async () => {
  assert.deepEqual((await probe({ sheetError: new Error("SECRET_PRIVATE_KEY") })).output,
    ["FAIL API_FAILURE"]);
  assert.deepEqual((await probe({ streamError: new Error("SECRET_PRIVATE_KEY") })).output,
    ["FAIL STREAM_FAILURE"]);
});

test("service-account read probe rejects invalid MIME, wrong parent, and trashed files before media read", async () => {
  for (const metadataValues of [
    { mimeType: "image/png" },
    { parents: ["different-folder"] },
    { trashed: true },
  ]) {
    const result = await probe({ metadataValues });
    assert.equal(result.exitCode, 1);
    assert.deepEqual(result.output, ["FAIL FILE_VALIDATION"]);
    assert.deepEqual(result.calls.filter(({ method }) => method === "drive.files.get")
      .map(({ alt }) => alt), ["metadata"]);
  }
});

test("bounded benchmark reads the same trusted image five times per provider without writes", async () => {
  const { google, calls } = fixture();
  const output = [];
  let bridgeReads = 0;
  const exitCode = await run({ env: { ...env,
    GOOGLE_DRIVE_APPS_SCRIPT_URL: "https://script.google.com/macros/s/fake/exec",
    GOOGLE_DRIVE_APPS_SCRIPT_SECRET: "SECRET_BRIDGE_KEY",
  }, google, benchmark: true, log: (line) => output.push(line),
  bridgeFactory: () => ({ getImage: async (fileId) => {
    assert.equal(fileId, "SECRET_FILE_ID");
    bridgeReads += 1;
    return Readable.from([Buffer.from("WEBP")]);
  } }) });
  assert.equal(exitCode, 0);
  assert.equal(bridgeReads, 5);
  assert.equal(calls.filter(({ method, alt }) => method === "drive.files.get" && alt === "media").length, 5);
  assert.deepEqual(output.slice(1).map((line) => JSON.parse(line).provider),
    ["SERVICE_ACCOUNT", "APPS_SCRIPT"]);
  for (const line of output.slice(1)) {
    const result = JSON.parse(line);
    assert.equal(result.samples, 5);
    assert.equal(result.successes, 5);
    assert.equal(result.failures, 0);
    assert.doesNotMatch(line, /SECRET_FILE_ID|SECRET_BRIDGE_KEY|SECRET_PRIVATE_KEY/);
  }
  assert.ok(calls.every(({ method }) => ["auth", "sheets.values.get", "drive.files.get"].includes(method)));
});

test("benchmark records one timeout without retrying that sample or exposing provider details", async () => {
  const { google } = fixture();
  const output = [];
  let bridgeReads = 0;
  const exitCode = await run({ env: { ...env,
    GOOGLE_DRIVE_APPS_SCRIPT_URL: "https://script.google.com/macros/s/fake/exec",
    GOOGLE_DRIVE_APPS_SCRIPT_SECRET: "SECRET_BRIDGE_KEY",
  }, google, benchmark: true, log: (line) => output.push(line),
  bridgeFactory: () => ({ getImage: async () => {
    bridgeReads += 1;
    if (bridgeReads === 2) throw Object.assign(new Error("SECRET_BRIDGE_KEY"),
      { bridgeCategory: "timeout" });
    return Readable.from([Buffer.from("WEBP")]);
  } }) });
  assert.equal(exitCode, 1);
  assert.equal(bridgeReads, 5);
  const result = JSON.parse(output.at(-1));
  assert.equal(result.samples, 5);
  assert.equal(result.successes, 4);
  assert.equal(result.failures, 1);
  assert.deepEqual(result.failureCategories, ["TIMEOUT"]);
  assert.doesNotMatch(output.join("\n"), /SECRET_BRIDGE_KEY|SECRET_FILE_ID/);
});
