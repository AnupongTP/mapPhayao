const test = require("node:test");
const assert = require("node:assert/strict");
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

test.afterEach(() => {
  appUserService.findOrCreateLineUser = oldFind;
  appUserService.updateVerifiedDisplayName = oldUpdate;
  parcelService.withParcelMutationLock = oldLock;
  parcelImageService.uploadOwnedImage = oldUpload;
});

async function withServer(action) {
  const app = createApp({
    lineTokenService: { verifyIdToken: async () => ({ sub: "U_TEST" }) },
    googleIntegration: { enabled: true },
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
  parcelImageService.uploadOwnedImage = async (_id, _owner, _file, _google, _photo, _db, onStage) => {
    onStage("PARCEL_VERIFIED"); onStage("IMAGE_PROCESSED"); onStage("DRIVE_UPLOAD");
    onStage("SHEET_UPDATE");
    return { id: "photo.webp" };
  };
  await withServer(async (base) => {
    const response = await upload(base);
    const body = await response.json();
    assert.equal(response.status, 201);
    assert.deepEqual(body.image, { id: "photo.webp" });
    assert.equal(body.stage, "UPLOAD_COMPLETE");
    assert.match(body.requestId, /^[A-F0-9]{8}$/);
  });
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
  await withServer(async (base) => {
    for (const item of failures) {
      parcelImageService.uploadOwnedImage = async (_id, _owner, _file, _google, _photo, _db, onStage) => {
        onStage(item.boundary);
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
    }
  });
});
