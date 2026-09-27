const test = require("node:test");
const assert = require("node:assert/strict");
const { Readable } = require("node:stream");
const { createApp } = require("../src/server");
const appUserService = require("../src/services/appUserService");
const parcelService = require("../src/services/parcelService");
const parcelImageService = require("../src/services/parcelImageService");

const PARCEL_ID = "11111111-1111-4111-8111-111111111111";
const PHOTO_ID = "22222222-2222-4222-8222-222222222222";
const origin = "https://mapphayaoliff.netlify.app";
const oldFind = appUserService.findOrCreateLineUser;
const oldUpdate = appUserService.updateVerifiedDisplayName;
const oldLock = parcelService.withParcelMutationLock;
const oldUpload = parcelImageService.uploadOwnedImage;
const oldGetOwnedImageFileId = parcelImageService.getOwnedImageFileId;

test.afterEach(() => {
  appUserService.findOrCreateLineUser = oldFind;
  appUserService.updateVerifiedDisplayName = oldUpdate;
  parcelService.withParcelMutationLock = oldLock;
  parcelImageService.uploadOwnedImage = oldUpload;
  parcelImageService.getOwnedImageFileId = oldGetOwnedImageFileId;
});

async function withServer(action, googleOverrides = {}) {
  const app = createApp({
    lineTokenService: { verifyIdToken: async () => ({ sub: "U_TEST" }) },
    googleIntegration: { enabled: true, ...googleOverrides },
  });
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  try { return await action(`http://127.0.0.1:${server.address().port}`); } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function upload(base) {
  const body = new FormData();
  body.append("image", new Blob(["image"], { type: "image/png" }), "photo.png");
  body.append("clientPhotoId", PHOTO_ID);
  return fetch(`${base}/api/parcels/${PARCEL_ID}/images`, {
    method: "POST", headers: { Origin: origin, Authorization: "Bearer synthetic-test-token",
      "X-Photo-Attempt": "0" }, body,
  });
}

async function captureTiming(action) {
  const original = console.info;
  const records = [];
  records.events = [];
  console.info = (event, details) => {
    if (typeof event === "string" && event.startsWith("parcel-image-upload-")) {
      records.events.push({ event, details });
    } else original(event, details);
    if (event === "parcel-image-upload-timing") records.push(details);
  };
  try { await action(records); } finally { console.info = original; }
}

test("protected image GET exposes safe Server-Timing while preserving ownership and streaming", async () => {
  appUserService.findOrCreateLineUser = async () => ({ id: PARCEL_ID });
  appUserService.updateVerifiedDisplayName = async () => {};
  let ownerChecks = 0;
  parcelImageService.getOwnedImageFileId = async (parcelId, imageId, ownerId) => {
    ownerChecks++;
    assert.deepEqual([parcelId, imageId, ownerId], [PARCEL_ID, "photo.webp", PARCEL_ID]);
    return "private-drive-id";
  };
  const bytes = Buffer.from("test-image-bytes");
  await withServer(async (base) => {
    const response = await fetch(`${base}/api/parcels/${PARCEL_ID}/images/photo.webp/content`, {
      headers: { Origin: origin, Authorization: "Bearer synthetic-test-token" },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/webp");
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
    assert.equal(response.headers.get("access-control-allow-origin"), origin);
    assert.ok(response.headers.get("access-control-expose-headers").toLowerCase()
      .split(/,\s*/).includes("server-timing"));
    const timing = response.headers.get("server-timing");
    for (const name of ["ownership", "provider", "backend"]) {
      const match = timing.match(new RegExp(`(?:^|,)\\s*${name};dur=([0-9]+(?:\\.[0-9]+)?)`));
      assert.ok(match, `${name} timing missing`);
      assert.ok(Number.isFinite(Number(match[1])) && Number(match[1]) >= 0);
    }
    assert.doesNotMatch(timing, /private-drive-id|synthetic-test-token|test-image-bytes/);
    const unauthenticated = await fetch(`${base}/api/parcels/${PARCEL_ID}/images/photo.webp/content`);
    assert.equal(unauthenticated.status, 401);
    assert.equal(ownerChecks, 1);
  }, { getImage: async (fileId) => {
    assert.equal(fileId, "private-drive-id");
    return Readable.from([bytes]);
  } });
});

test("production photo preflight allows authorization and x-photo-attempt without wildcard origin", async () => {
  await withServer(async (base) => {
    const path = `/api/parcels/${PARCEL_ID}/images`;
    const response = await fetch(`${base}${path}`, { method: "OPTIONS", headers: {
      Origin: origin, "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "authorization,x-photo-attempt",
    } });
    assert.equal(response.status, 204);
    assert.equal(response.headers.get("access-control-allow-origin"), origin);
    const allowed = response.headers.get("access-control-allow-headers").toLowerCase().split(/,\s*/);
    assert.ok(allowed.includes("authorization"));
    assert.ok(allowed.includes("x-photo-attempt"));
    assert.notEqual(response.headers.get("access-control-allow-origin"), "*");
    const denied = await fetch(`${base}${path}`, { method: "OPTIONS", headers: {
      Origin: "https://untrusted.example.test", "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "authorization,x-photo-attempt",
    } });
    assert.equal(denied.headers.get("access-control-allow-origin"), null);
  });
});

test("upload success includes request-scoped diagnostics without changing image", async () => {
  appUserService.findOrCreateLineUser = async () => ({ id: PARCEL_ID });
  appUserService.updateVerifiedDisplayName = async () => {};
  parcelService.withParcelMutationLock = async (_id, work) => work({});
  parcelImageService.uploadOwnedImage = async (_id, _owner, _file, _google, _photo, _db, onStage, onTiming) => {
    onStage("PARCEL_VERIFIED");
    onTiming("sharpMs", 1.2);
    onStage("IMAGE_PROCESSED");
    onTiming("sheetPreflightMs", 2.3);
    onStage("SHEET_PREFLIGHT_COMPLETE");
    onStage("DRIVE_UPLOAD");
    onTiming("appsScriptMs", 3.4);
    onStage("DRIVE_UPLOAD_COMPLETE");
    onStage("SHEET_UPDATE");
    onTiming("sheetUpdateMs", 4.5);
    onStage("SHEET_UPDATE_COMPLETE");
    return { id: "photo.webp" };
  };
  await captureTiming(async (records) => withServer(async (base) => {
    const response = await upload(base);
    const body = await response.json();
    assert.equal(response.status, 201);
    assert.deepEqual(body.image, { id: "photo.webp" });
    assert.equal(body.stage, "UPLOAD_COMPLETE");
    assert.match(body.requestId, /^[A-F0-9]{8}$/);
    assert.deepEqual(records[0], {
      requestId: body.requestId, attempt: 0, stage: "UPLOAD_COMPLETE", category: "success",
      sharpMs: 1.2, sheetPreflightMs: 2.3, appsScriptMs: 3.4, sheetUpdateMs: 4.5,
      totalMs: records[0].totalMs,
    });
    assert.ok(Number.isFinite(records[0].totalMs) && records[0].totalMs >= 0);
    assert.deepEqual(records.events.map(({ event, details }) => [event, details.stage]), [
      ["parcel-image-upload-start", "request-received"],
      ["parcel-image-upload-stage", "sharp-complete"],
      ["parcel-image-upload-stage", "sheet-preflight-complete"],
      ["parcel-image-upload-stage", "apps-script-upload-started"],
      ["parcel-image-upload-stage", "apps-script-upload-complete"],
      ["parcel-image-upload-stage", "sheet-update-complete"],
      ["parcel-image-upload-timing", "UPLOAD_COMPLETE"],
      ["parcel-image-upload-completed", "upload-complete"],
    ]);
    for (const { details } of records.events) {
      assert.equal(details.requestId, body.requestId);
      assert.equal(details.attempt, 0);
      assert.doesNotMatch(JSON.stringify(details), /synthetic-test-token|U_TEST|private_key|image-bytes/);
    }
  }));
});

test("upload auth failure stays sanitized and carries only the request diagnostic ID", async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/api/parcels/${PARCEL_ID}/images`, {
      method: "POST", headers: { Origin: origin },
    });
    const body = await response.json();
    assert.equal(response.status, 401);
    assert.equal(body.code, "AUTH_REQUIRED");
    assert.equal(body.stage, "REQUEST_RECEIVED");
    assert.match(body.requestId, /^[A-F0-9]{8}$/);
    assert.doesNotMatch(JSON.stringify(body), /U_TEST|Authorization|Bearer/);
  });
});

test("upload failures expose safe stage/code/id and retain ambiguous, retryable and conflict semantics", async () => {
  appUserService.findOrCreateLineUser = async () => ({ id: PARCEL_ID });
  appUserService.updateVerifiedDisplayName = async () => {};
  parcelService.withParcelMutationLock = async (_id, work) => work({});
  const failures = [
    { stage: "apps-script-upload", category: "timeout", ambiguous: true,
      status: 503, code: "APPS_SCRIPT_TIMEOUT", boundary: "DRIVE_UPLOAD" },
    { stage: "sheets-read", category: "", retryable: true,
      status: 503, code: "SHEET_READ_ERROR", boundary: "SHEET_CHECK" },
    { stage: "sheets-append-image", category: "", conflict: true,
      status: 409, code: "IMAGE_CONFLICT", boundary: "SHEET_UPDATE" },
  ];
  await captureTiming(async (records) => withServer(async (base) => {
    for (const item of failures) {
      parcelImageService.uploadOwnedImage = async (_id, _owner, _file, _google, _photo, _db, onStage, onTiming) => {
        onStage(item.boundary);
        onTiming("sharpMs", 1);
        onTiming("sheetPreflightMs", 2);
        if (item.category === "timeout") onTiming("appsScriptMs", 30000);
        onTiming("secret-field", "SECRET_PROVIDER_PAYLOAD");
        onTiming("sheetUpdateMs", "SECRET_PROVIDER_PAYLOAD");
        const error = new Error("SECRET_PROVIDER_PAYLOAD");
        error.googleStage = item.stage;
        error.bridgeCategory = item.category;
        error.photoAmbiguous = item.ambiguous;
        error.photoRetryable = item.retryable;
        if (item.conflict) error.code = "PARCEL_IMAGE_CONFLICT";
        throw error;
      };
      const response = await upload(base);
      const body = await response.json();
      assert.equal(response.status, item.status);
      assert.equal(body.stage, item.boundary);
      assert.equal(body.code, item.code);
      assert.match(body.requestId, /^[A-F0-9]{8}$/);
      assert.equal(body.ambiguous === true, item.ambiguous === true);
      assert.equal(body.retryable === true, item.retryable === true);
      assert.doesNotMatch(JSON.stringify(body), /SECRET_PROVIDER_PAYLOAD|synthetic-test-token|U_TEST/);
      const timing = records.at(-1);
      assert.equal(timing.requestId, body.requestId);
      assert.equal(timing.stage, item.stage);
      assert.equal(timing.sharpMs, 1);
      assert.equal(timing.sheetPreflightMs, 2);
      if (item.category === "timeout") {
        assert.equal(timing.category, "timeout");
        assert.equal(timing.appsScriptMs, 30000);
        assert.equal(timing.sheetUpdateMs, undefined);
      }
      assert.ok(Number.isFinite(timing.totalMs) && timing.totalMs >= 0);
      assert.doesNotMatch(JSON.stringify(timing), /SECRET_PROVIDER_PAYLOAD|synthetic-test-token|U_TEST|secret-field/);
      const uploadEvents = records.events.filter(({ details }) => details.requestId === body.requestId);
      assert.equal(uploadEvents[0].event, "parcel-image-upload-start");
      assert.ok(uploadEvents.some(({ event }) => event === "parcel-image-upload-timing"));
      assert.ok(uploadEvents.length <= 9);
      assert.doesNotMatch(JSON.stringify(uploadEvents), /SECRET_PROVIDER_PAYLOAD|synthetic-test-token|U_TEST/);
    }
  }));
});
