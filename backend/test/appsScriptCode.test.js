const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createHash, createHmac } = require("node:crypto");
const { createAppsScriptDriveBridge } = require("../src/services/appsScriptDriveBridge");

test("checked-in Apps Script verifies signed upload/read/delete and blocks replay or foreign files", async () => {
  const source = fs.readFileSync(path.join(__dirname, "../../scripts/google-drive-apps-script/Code.gs"), "utf8");
  const files = new Map();
  const nonces = new Map();
  let nextId = 1;
  const folder = { getId: () => "owned-folder", createFile(blob) {
    const id = `file_${nextId++}`;
    const file = {
      getId: () => id,
      getParents: () => {
        let used = false;
        return { hasNext: () => !used, next: () => { used = true; return folder; } };
      },
      isTrashed: () => file.trashed || false,
      setTrashed(value) { file.trashed = value; },
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
});
