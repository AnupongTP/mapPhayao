const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createHash, createHmac } = require("node:crypto");
const { createAppsScriptDriveBridge } = require("../src/services/appsScriptDriveBridge");

test("checked-in Apps Script creates private uploads and keeps signed Drive operations", async () => {
  const source = fs.readFileSync(path.join(__dirname, "../../scripts/google-drive-apps-script/Code.gs"), "utf8");
  const files = new Map();
  const nonces = new Map();
  const events = [];
  const replies = [];
  let nextId = 1;
  let creationFails = false;
  const folder = { getId: () => "owned-folder", createFile(blob) {
    events.push("create");
    if (creationFails) throw new Error("private creation failure");
    const id = `file_${nextId++}`;
    const file = {
      getId: () => { events.push("fileId"); return id; },
      getParents: () => {
        let used = false;
        return { hasNext: () => !used, next: () => { used = true; return folder; } };
      },
      isTrashed: () => file.trashed || false,
      setTrashed(value) {
        events.push("trash");
        file.trashed = value;
      },
      getMimeType: () => blob.mimeType,
      getBlob: () => ({ getBytes: () => blob.bytes }),
    };
    files.set(id, file);
    return file;
  } };
  const context = vm.createContext({
    PropertiesService: { getScriptProperties: () => ({ getProperty(name) {
      return { BRIDGE_SECRET: "LOCAL_TEST_SECRET", FOLDER_ID: "owned-folder" }[name];
    } }) },
    ContentService: { MimeType: { JSON: "application/json" }, createTextOutput(value) {
      replies.push(JSON.parse(value));
      events.push("reply");
      return { value, setMimeType() { return this; } };
    } },
    CacheService: { getScriptCache: () => ({ get: (key) => nonces.get(key),
      put: (key, value) => nonces.set(key, value) }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: {
      Charset: { UTF_8: "utf8" }, DigestAlgorithm: { SHA_256: "sha256" },
      computeHmacSha256Signature: (value, key) => [...createHmac("sha256", key).update(value).digest()],
      computeDigest: (_algorithm, value) => [...createHash("sha256").update(value).digest()],
      base64EncodeWebSafe: (bytes) => Buffer.from(bytes).toString("base64url"),
      base64Encode: (bytes) => Buffer.from(bytes).toString("base64"),
      base64Decode: (value) => [...Buffer.from(value, "base64")],
      newBlob: (bytes, mimeType, name) => ({ bytes, mimeType, name }),
    },
    DriveApp: { getFolderById: () => folder, getFileById(id) { return files.get(id); } },
  });
  vm.runInContext(source, context);
  const requests = [];
  const fetchImpl = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    const output = context.doPost({ postData: { contents: options.body } });
    return { ok: true, async json() { return JSON.parse(output.value); } };
  };
  const bridge = createAppsScriptDriveBridge({
    url: "https://script.google.com/macros/s/fake/exec", secret: "LOCAL_TEST_SECRET", fetchImpl,
  });
  const id = await bridge.uploadImage(Buffer.from("WEBP"), "a.webp");
  assert.equal(id, "file_1");
  assert.deepEqual(events.slice(0, 3), ["create", "fileId", "reply"]);
  assert.equal(source.includes("setSharing"), false);
  assert.deepEqual(replies[0], { success: true, fileId: id });
  const chunks = [];
  for await (const chunk of await bridge.getImage(id)) chunks.push(chunk);
  assert.equal(Buffer.concat(chunks).toString(), "WEBP");
  await bridge.deleteImage(id);
  await assert.rejects(() => bridge.getImage(id), { bridgeCategory: "rejected" });
  const replay = context.doPost({ postData: { contents: JSON.stringify(requests[0]) } });
  assert.equal(JSON.parse(replay.value).error, "replay");
  const tampered = { ...requests[0], nonce: "AAAAAAAAAAAAAAAAAAAAAAAA" };
  const invalid = context.doPost({ postData: { contents: JSON.stringify(tampered) } });
  assert.equal(JSON.parse(invalid.value).error, "invalid-signature");
  files.set("foreign", { isTrashed: () => false, getParents: () => ({ hasNext: () => false }) });
  await assert.rejects(() => bridge.getImage("foreign"), { bridgeCategory: "rejected" });

  creationFails = true;
  const beforeFailure = events.length;
  await assert.rejects(() => bridge.uploadImage(Buffer.from("WEBP"), "b.webp"),
    { bridgeCategory: "rejected" });
  assert.deepEqual(events.slice(beforeFailure), ["create", "reply"]);
  assert.deepEqual(replies.at(-1), { success: false, error: "operation-failed" });
  assert.equal(replies.some((reply) => JSON.stringify(reply).includes("private")), false);
});

test("Apps Script signs weather coordinates and keeps Drive folder configuration separate", async () => {
  const source = fs.readFileSync(path.join(__dirname, "../../scripts/google-drive-apps-script/Code.gs"), "utf8");
  assert.equal(source.includes("LOCAL_TEST_SECRET"), false);
  const nonces = new Map();
  const providerCalls = [];
  let providerStatus = 200;
  const context = vm.createContext({
    PropertiesService: { getScriptProperties: () => ({ getProperty(name) {
      return name === "BRIDGE_SECRET" ? "LOCAL_TEST_SECRET" : null;
    } }) },
    ContentService: { MimeType: { JSON: "application/json" }, createTextOutput(value) {
      return { value, setMimeType() { return this; } };
    } },
    CacheService: { getScriptCache: () => ({ get: (key) => nonces.get(key),
      put: (key, value) => nonces.set(key, value) }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: { computeHmacSha256Signature: (value, key) =>
      [...createHmac("sha256", key).update(value).digest()],
    base64EncodeWebSafe: (bytes) => Buffer.from(bytes).toString("base64url") },
    DriveApp: { getFolderById() { throw new Error("Drive must not run"); } },
    UrlFetchApp: { fetch(url, options) {
      providerCalls.push({ url, options });
      return { getResponseCode: () => providerStatus,
        getHeaders: () => providerStatus === 429 ? { "Retry-After": "90" } : {},
        getContentText: () => JSON.stringify({ current: { temperature_2m: 28.5 },
          hourly: { time: [], precipitation_probability: [] } }),
      };
    } },
  });
  vm.runInContext(source, context);
  const requests = [];
  const fetchImpl = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    const output = context.doPost({ postData: { contents: options.body } });
    return { ok: true, async json() { return JSON.parse(output.value); } };
  };
  const bridge = createAppsScriptDriveBridge({
    url: "https://script.google.com/macros/s/fake/exec", secret: "LOCAL_TEST_SECRET", fetchImpl,
  });
  const weather = await bridge.getWeather(19.123456, 99.987654);
  assert.equal(weather.providerStatus, 200);
  assert.equal(weather.body.current.temperature_2m, 28.5);
  assert.equal(providerCalls.length, 1);
  const providerUrl = new URL(providerCalls[0].url);
  assert.equal(providerUrl.origin + providerUrl.pathname, "https://api.open-meteo.com/v1/forecast");
  assert.equal(providerUrl.searchParams.get("latitude"), "19.123456");
  assert.equal(providerUrl.searchParams.get("longitude"), "99.987654");
  assert.equal(providerUrl.searchParams.get("current"), "temperature_2m");
  assert.equal(providerUrl.searchParams.get("hourly"), "precipitation_probability");
  assert.equal(providerUrl.searchParams.get("timezone"), "Asia/Bangkok");
  assert.equal(providerUrl.searchParams.get("forecast_hours"), "3");
  assert.equal(providerUrl.searchParams.get("temperature_unit"), "celsius");
  assert.equal(providerCalls[0].options.muteHttpExceptions, true);
  const signed = requests[0];
  const canonical = ["1", "weather", String(signed.ts), signed.nonce,
    signed.latitude, signed.longitude].join("\n");
  assert.equal(signed.signature, createHmac("sha256", "LOCAL_TEST_SECRET")
    .update(canonical).digest("base64url"));
  const send = (payload) => JSON.parse(context.doPost({ postData: { contents: JSON.stringify(payload) } }).value);
  assert.equal(send({ ...signed, latitude: "19.000000" }).error, "invalid-signature");
  assert.equal(send({ ...signed, longitude: "99.000000" }).error, "invalid-signature");
  assert.equal(send(signed).error, "replay");
  const resign = (payload) => ({ ...payload, signature: createHmac("sha256", "LOCAL_TEST_SECRET")
    .update(["1", "weather", String(payload.ts), payload.nonce,
      payload.latitude, payload.longitude].join("\n")).digest("base64url") });
  assert.equal(send(resign({ ...signed, nonce: "AAAAAAAAAAAAAAAAAAAAAAAA", ts: signed.ts - 301 })).error,
    "invalid-request");
  assert.equal(send(resign({ ...signed, nonce: "BBBBBBBBBBBBBBBBBBBBBBBB", latitude: "91.000000" })).error,
    "invalid-request");
  assert.equal(send(resign({ ...signed, nonce: "CCCCCCCCCCCCCCCCCCCCCCCC", longitude: "181.000000" })).error,
    "invalid-request");
  providerStatus = 429;
  const limited = await bridge.getWeather(19.123456, 99.987654);
  assert.deepEqual({ status: limited.providerStatus, retryAfter: limited.retryAfter },
    { status: 429, retryAfter: "90" });
  await assert.rejects(() => bridge.uploadImage(Buffer.from("webp"), "a.webp"),
    { bridgeCategory: "rejected" });
});
