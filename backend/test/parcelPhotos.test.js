const test = require("node:test");
const assert = require("node:assert/strict");
const sharp = require("sharp");
const { normalizeImage, MAX_RAW_BYTES, MAX_LONG_EDGE, WEBP_QUALITY } = require("../src/services/parcelImageService");
const parcelImageService = require("../src/services/parcelImageService");
const parcelService = require("../src/services/parcelService");
const db = require("../src/config/database");
const { bestEffortMirror, mirrorParcel } = require("../src/services/parcelMirrorService");
const { userCells, parcelCells, parseParcelImages, imageLink, formatCoordinate, PARCEL_HEADERS, createGoogleParcelIntegration } = require("../src/services/googleParcelIntegration");
const { createFakeGoogleParcels } = require("../../scripts/fake-google-parcels.cjs");
const { logGoogleFailure, tagGoogleError } = require("../src/utils/googleError");

test("parcel photos normalize to metadata-free WebP at 1600px and quality 75", async () => {
  const input = await sharp({ create: { width: 2000, height: 1000, channels: 3, background: "red" } })
    .withMetadata({ orientation: 1 }).png().toBuffer();
  const result = await normalizeImage({ buffer: input, mimetype: "image/png" });
  const metadata = await sharp(result.bytes).metadata();
  assert.equal(metadata.format, "webp");
  assert.equal(metadata.width, 1600);
  assert.equal(metadata.height, 800);
  assert.equal(metadata.exif, undefined);
  assert.equal(MAX_LONG_EDGE, 1600);
  assert.equal(WEBP_QUALITY, 75);
  assert.equal(MAX_RAW_BYTES, 12 * 1024 * 1024);
});

test("invalid and oversized images are rejected", async () => {
  await assert.rejects(() => normalizeImage({ buffer: Buffer.from("not an image") }), { statusCode: 415 });
  await assert.rejects(() => normalizeImage({ buffer: Buffer.alloc(MAX_RAW_BYTES + 1) }), { statusCode: 413 });
});

test("EXIF orientation is applied before WebP resize and metadata is omitted", async () => {
  const input = await sharp({ create: { width: 2000, height: 1000, channels: 3, background: "blue" } })
    .jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const result = await normalizeImage({ buffer: input });
  const metadata = await sharp(result.bytes).metadata();
  assert.equal(metadata.width, 800);
  assert.equal(metadata.height, 1600);
  assert.equal(metadata.orientation, undefined);
  assert.equal(metadata.exif, undefined);
});

test("Sheet cells keep deterministic aligned JSON arrays and never export picture_url", () => {
  const user = { id: "internal-uuid", display_name: "Verified", picture_url: "private", line_user_id: "U_PRIVATE", created_at: "2026-01-01T00:00:00Z" };
  assert.deepEqual(userCells(user), ["internal-uuid", "Verified", "2026-01-01T00:00:00.000Z", ""]);
  const parcel = {
    owner_user_id: user.id, display_name: user.display_name, parcel_code: "PY-2026-0001",
    parcel_name: "Field", crop_type: "rice", rice_variety: "Khao Dawk Mali",
    planting_date: "2026-01-02", geometry: { type: "Polygon", coordinates: [[[99.818955, 19.191926]]] },
    area_sqm: 1600, area_rai: 1, representative_lat: 19.024858, representative_lng: 99.910682,
    note: "untrusted note", picture_url: user.picture_url,
    line_user_id: user.line_user_id,
  };
  const cells = parcelCells(parcel, [
    { fileName: "first.webp", linkImage: "https://drive.google.com/uc?export=view&id=first" },
    { fileName: "third.webp", linkImage: "https://drive.google.com/uc?export=view&id=third" },
    { fileName: "second.webp", linkImage: "https://drive.google.com/uc?export=view&id=second" },
  ]);
  assert.deepEqual(PARCEL_HEADERS, ["user_id", "display_name", "parcel_code", "parcel_name", "crop", "variety",
    "planting_date", "Coordinate", "geometry", "area_m2", "area_rai", "Image", "LinkImage", "note", "created_at", "updated_at"]);
  assert.equal(cells.length, 16);
  assert.deepEqual(cells.slice(0, 8), ["internal-uuid", "Verified", "PY-2026-0001", "Field", "rice", "Khao Dawk Mali", "2026-01-02", "19.024858, 99.910682"]);
  assert.deepEqual(JSON.parse(cells[8]), parcel.geometry);
  assert.deepEqual(cells.slice(9, 11), [1600, 1]);
  assert.deepEqual(JSON.parse(cells[11]), ["first.webp", "third.webp", "second.webp"]);
  assert.deepEqual(JSON.parse(cells[12]), [
    "https://drive.google.com/uc?export=view&id=first",
    "https://drive.google.com/uc?export=view&id=third",
    "https://drive.google.com/uc?export=view&id=second",
  ]);
  assert.deepEqual(parseParcelImages(cells).map((image) => image.fileId), ["first", "third", "second"]);
  assert.deepEqual(parseParcelImages(cells).map((image) => image.linkImage), [
    imageLink("first"), imageLink("third"), imageLink("second"),
  ]);
  assert.equal(cells[13], "");
  assert.deepEqual(cells.slice(14), ["", ""]);
  assert.equal(cells.join(" ").includes("private"), false);
  assert.equal(cells.join(" ").includes("U_PRIVATE"), false);
  assert.equal(parcelCells(parcel, [])[11], "[]");
  assert.equal(parcelCells(parcel, [])[12], "[]");
  assert.equal(parcelCells({ ...parcel, representative_lat: null })[7], "");
});

test("Coordinate formatter uses EPSG:4326 latitude, longitude with six decimals", () => {
  assert.equal(formatCoordinate(19.191926, 99.818955), "19.191926, 99.818955");
  assert.equal(formatCoordinate(19.2, 99.8), "19.200000, 99.800000");
  assert.equal(formatCoordinate(undefined, 99.8), "");
});

test("parcel mirror reads trusted display name by owner UUID from app.users", async () => {
  const originalQuery = db.query;
  const calls = [];
  let mirrored;
  db.query = async (sql, params) => {
    calls.push({ sql, params });
    if (calls.length === 1) return { rows: [{
      owner_user_id: "internal-uuid", display_name: "Verified", parcel_code: "PY-1",
      crop_type: "rice", geometry: { type: "Polygon", coordinates: [] }, area_sqm: 1600, area_rai: 1,
      representative_lat: 19.024858, representative_lng: 99.910682,
    }] };
    throw new Error("Unexpected image metadata query");
  };
  try {
    await mirrorParcel("parcel-id", { enabled: true, async upsertParcel(parcel) {
      mirrored = parcelCells(parcel);
    } });
    assert.match(calls[0].sql, /JOIN app\.users u ON u\.id = p\.owner_user_id/);
    assert.match(calls[0].sql, /u\.display_name/);
    assert.match(calls[0].sql, /ST_Transform\(ST_PointOnSurface\(p\.geom\), 4326\)/);
    assert.match(calls[0].sql, /ST_X\(representative\.point\) AS representative_lng/);
    assert.match(calls[0].sql, /ST_Y\(representative\.point\) AS representative_lat/);
    assert.deepEqual(calls[0].params, ["parcel-id"]);
    assert.equal(calls.length, 1);
    assert.deepEqual(mirrored.slice(0, 3), ["internal-uuid", "Verified", "PY-1"]);
    assert.equal(mirrored[7], "19.024858, 99.910682");
  } finally {
    db.query = originalQuery;
  }
});

test("fake Google integration stores only local bytes and mirrors row cells", async () => {
  const fake = createFakeGoogleParcels();
  const id = await fake.uploadImage(Buffer.from("webp"), "a.webp");
  assert.equal(fake.snapshot().files[0].fileName, "a.webp");
  await fake.upsertUser({ id: "internal", display_name: "A" });
  const parcel = { owner_user_id: "internal", parcel_code: "PY-1", crop_type: "rice", geometry: {} };
  await fake.upsertParcel(parcel);
  assert.equal(fake.snapshot().parcels[0].length, 16);
  assert.deepEqual(JSON.parse(fake.snapshot().parcels[0][11]), []);
  assert.deepEqual(JSON.parse(fake.snapshot().parcels[0][12]), []);
  await fake.appendParcelImage("PY-1", "internal", "a.webp", id);
  await fake.upsertParcel({ ...parcel, parcel_name: "Updated", representative_lat: 19.024858,
    representative_lng: 99.910682 });
  assert.equal(fake.snapshot().parcels[0][3], "Updated");
  assert.equal(fake.snapshot().parcels[0][7], "19.024858, 99.910682");
  assert.deepEqual((await fake.getParcelImages("PY-1", "internal")).map((image) => image.fileName), ["a.webp"]);
  await assert.rejects(() => fake.getParcelImages("PY-1", "other"), /owner mismatch/);
  await fake.deleteImage(id);
  await fake.deleteParcel("PY-1");
  assert.deepEqual(fake.snapshot().files, []);
  assert.deepEqual(fake.snapshot().parcels, []);
});

test("photo append restores a missing full Sheet row and retries are idempotent", async () => {
  const rows = [];
  const calls = [];
  const google = {
    auth: { GoogleAuth: class {} },
    sheets() { return { spreadsheets: { values: {
      async get({ range }) {
        calls.push(`get:${range}`);
        return { data: { values: range === "parcels!A1:P1" ? [PARCEL_HEADERS] : rows } };
      },
      async append({ requestBody }) {
        calls.push("append");
        rows.push(requestBody.values[0]);
      },
      async update({ requestBody }) {
        calls.push("update");
        rows[0].splice(11, 2, ...requestBody.values[0]);
      },
    } } }; },
  };
  const integration = createGoogleParcelIntegration({ GOOGLE_MIRROR_ENABLED: "true",
    GOOGLE_SERVICE_ACCOUNT_JSON: "{}", GOOGLE_SHEETS_SPREADSHEET_ID: "fake-sheet",
  }, google);
  const record = { owner_user_id: "owner", parcel_code: "PY-1", parcel_name: "Field",
    crop_type: "rice", geometry: { type: "Polygon", coordinates: [] }, area_sqm: 1600, area_rai: 1 };
  await assert.rejects(() => integration.appendParcelImage("PY-1", "other", "a.webp", "file_a", record),
    /row is missing/);
  const first = await integration.appendParcelImage("PY-1", "owner", "a.webp", "file_a", record);
  assert.equal(first.fileId, "file_a");
  assert.equal(rows[0].length, 16);
  assert.equal(rows[0][3], "Field");
  assert.deepEqual(JSON.parse(rows[0][11]), ["a.webp"]);
  assert.deepEqual(JSON.parse(rows[0][12]), [imageLink("file_a")]);
  assert.deepEqual(await integration.appendParcelImage("PY-1", "owner", "a.webp", "file_a", record), first);
  await assert.rejects(() => integration.appendParcelImage("PY-1", "owner", "a.webp", "different", record),
    /Duplicate parcel image/);
  await integration.appendParcelImage("PY-1", "owner", "b.webp", "file_b", record);
  assert.deepEqual(JSON.parse(rows[0][11]), ["a.webp", "b.webp"]);
  assert.deepEqual(JSON.parse(rows[0][12]), [imageLink("file_a"), imageLink("file_b")]);
  assert.equal(calls.filter((call) => call === "append").length, 1);
  assert.equal(calls.filter((call) => call === "update").length, 1);
});

test("transient Sheet retry reuses one Drive upload and never retries auth failures", async () => {
  const mirrorService = require("../src/services/parcelMirrorService");
  const originalParcelLookup = parcelService.getOwnedParcelById;
  const originalLookupRecord = mirrorService.getParcelMirrorRecord;
  const ownerId = "22222222-2222-4222-8222-222222222222";
  const record = { owner_user_id: ownerId, parcel_code: "PY-1" };
  parcelService.getOwnedParcelById = async () => ({ id: "parcel-id", parcelCode: "PY-1" });
  mirrorService.getParcelMirrorRecord = async () => record;
  const buffer = await sharp({ create: { width: 8, height: 8, channels: 3,
    background: "green" } }).png().toBuffer();
  let uploads = 0;
  let appends = 0;
  let deletions = 0;
  try {
    const result = await parcelImageService.uploadOwnedImage("parcel-id", ownerId, { buffer }, {
      enabled: true,
      async uploadImage() { uploads += 1; return "file_a"; },
      async appendParcelImage(_code, _owner, filename, fileId, fallbackRecord) {
        appends += 1;
        assert.equal(fallbackRecord, record);
        if (appends === 1) {
          const error = tagGoogleError(new Error("temporary Sheet response failure"), "sheets-append-image");
          error.statusCode = 503;
          throw error;
        }
        return { id: filename, fileName: filename, linkImage: imageLink(fileId), fileId };
      },
      async deleteImage() { deletions += 1; },
    });
    assert.equal(result.id.endsWith(".webp"), true);
    assert.deepEqual([uploads, appends, deletions], [1, 2, 0]);
    appends = 0;
    await assert.rejects(() => parcelImageService.uploadOwnedImage("parcel-id", ownerId, { buffer }, {
      enabled: true,
      async uploadImage() { uploads += 1; return "file_b"; },
      async appendParcelImage() {
        appends += 1;
        const error = tagGoogleError(new Error("denied"), "sheets-append-image");
        error.statusCode = 403;
        throw error;
      },
      async deleteImage() { deletions += 1; },
    }), { statusCode: 403 });
    assert.deepEqual([uploads, appends, deletions], [2, 1, 1]);
  } finally {
    parcelService.getOwnedParcelById = originalParcelLookup;
    mirrorService.getParcelMirrorRecord = originalLookupRecord;
  }
});

test("Drive failure leaves Sheet unchanged; Sheet failure deletes uploaded Drive file", async () => {
  const originalParcelLookup = parcelService.getOwnedParcelById;
  const mirrorService = require("../src/services/parcelMirrorService");
  const originalLookupRecord = mirrorService.getParcelMirrorRecord;
  const bytes = await sharp({ create: { width: 20, height: 10, channels: 3, background: "green" } }).png().toBuffer();
  const file = { buffer: bytes };
  const parcelId = "11111111-1111-4111-8111-111111111111";
  const ownerId = "22222222-2222-4222-8222-222222222222";
  const calls = [];
  parcelService.getOwnedParcelById = async () => ({ id: parcelId, parcelCode: "PY-2026-0001" });
  mirrorService.getParcelMirrorRecord = async () => {
    calls.push("lookup-record");
    return { owner_user_id: ownerId, parcel_code: "PY-2026-0001" };
  };
  try {
    await assert.rejects(() => parcelImageService.uploadOwnedImage(parcelId, ownerId, file, {
      enabled: true,
      async uploadImage() { throw new Error("Drive unavailable"); },
      async deleteImage() { calls.push("cleanup"); },
    }), /Drive unavailable/);
    assert.deepEqual(calls, ["lookup-record"]);
    await assert.rejects(() => parcelImageService.uploadOwnedImage(parcelId, ownerId, file, {
      enabled: true,
      async uploadImage() { calls.push("drive-upload"); return "fake-file"; },
      async appendParcelImage() { calls.push("sheet-append"); throw new Error("Sheet write failed"); },
      async deleteImage(id) { calls.push(`cleanup:${id}`); },
    }), /Sheet write failed/);
    assert.deepEqual(calls, ["lookup-record", "lookup-record", "drive-upload", "sheet-append", "cleanup:fake-file"]);
  } finally {
    parcelService.getOwnedParcelById = originalParcelLookup;
    mirrorService.getParcelMirrorRecord = originalLookupRecord;
  }
});

test("photo reads require owned parcel and matching Sheet filename, never arbitrary Drive id", async () => {
  const originalLookup = parcelService.getOwnedParcelById;
  const fake = createFakeGoogleParcels();
  const ownerId = "22222222-2222-4222-8222-222222222222";
  const parcelId = "11111111-1111-4111-8111-111111111111";
  const driveId = await fake.uploadImage(Buffer.from("webp"), "a.webp");
  await fake.upsertParcel({ owner_user_id: ownerId, parcel_code: "PY-1", crop_type: "rice", geometry: {} });
  await fake.appendParcelImage("PY-1", ownerId, "a.webp", driveId);
  parcelService.getOwnedParcelById = async (id, owner) => {
    if (id !== parcelId || owner !== ownerId) throw Object.assign(new Error("Parcel not found"), { statusCode: 404 });
    return { id, parcelCode: "PY-1" };
  };
  try {
    assert.equal((await parcelImageService.listOwnedImages(parcelId, ownerId, fake))[0].id, "a.webp");
    assert.equal(await parcelImageService.getOwnedImageFileId(parcelId, "a.webp", ownerId, fake), driveId);
    await assert.rejects(() => parcelImageService.getOwnedImageFileId(parcelId, driveId, ownerId, fake), { statusCode: 404 });
    await assert.rejects(() => parcelImageService.getOwnedImageFileId(parcelId, "a.webp", "other", fake), { statusCode: 404 });
    assert.deepEqual((await parcelImageService.getOwnedImageFiles(parcelId, ownerId, fake)).fileIds, [driveId]);
  } finally {
    parcelService.getOwnedParcelById = originalLookup;
  }
});

test("malformed or misaligned Sheet image arrays are rejected", () => {
  const row = parcelCells({ owner_user_id: "owner", parcel_code: "PY-1", crop_type: "rice", geometry: {} });
  row[11] = '["a.webp"]';
  assert.throws(() => parseParcelImages(row), /Invalid parcel image arrays/);
  row[12] = '["https://evil.example/uc?export=view&id=file"]';
  assert.throws(() => parseParcelImages(row), /Invalid parcel image link/);
});

test("LinkImage accepts only legacy and canonical Drive shapes, normalizing old rows on read", () => {
  const row = parcelCells({ owner_user_id: "owner", parcel_code: "PY-1", crop_type: "rice", geometry: {} });
  row[11] = '["a.webp","b.webp"]';
  row[12] = JSON.stringify([
    "https://drive.google.com/uc?export=view&id=ABC123",
    "https://drive.usercontent.google.com/download?id=DEF_456&export=view",
  ]);
  assert.equal(imageLink("ABC123"), "https://drive.usercontent.google.com/download?id=ABC123&export=view");
  assert.deepEqual(parseParcelImages(row).map((image) => image.linkImage), [
    imageLink("ABC123"), imageLink("DEF_456"),
  ]);
  for (const invalid of [
    "https://evil.example/download?id=ABC123&export=view",
    "https://drive.google.com/download?id=ABC123&export=view",
    "https://drive.usercontent.google.com/uc?id=ABC123&export=view",
    "https://drive.usercontent.google.com/download?export=view",
    "https://drive.usercontent.google.com/download?id=bad.id&export=view",
    "https://drive.usercontent.google.com/download?id=ABC123&export=view&authuser=0",
    "https://drive.usercontent.google.com/download?id=ABC123&id=DEF&export=view",
    "https://drive.usercontent.google.com/download?id=ABC123&export=view#fragment",
  ]) {
    row[12] = JSON.stringify([invalid, imageLink("DEF_456")]);
    assert.throws(() => parseParcelImages(row), /Invalid parcel image link/);
  }
});

test("Google mirror failure stays nonfatal", async () => {
  const originalError = console.error;
  const events = [];
  console.error = (...args) => events.push(args);
  try {
    await bestEffortMirror("parcel", "update", { parcelId: "safe-id" }, async () => {
      throw new Error("Google unavailable");
    });
    assert.equal(events[0][0], "google-mirror-sync-failed");
    assert.deepEqual(events[0][1], { entity: "parcel", operation: "update", stage: "google",
      message: "Google API request failed" });
  } finally {
    console.error = originalError;
  }
});

test("header mismatch is reported without exposing sheet contents", async () => {
  const originalError = console.error;
  const events = [];
  console.error = (...args) => events.push(args);
  try {
    await bestEffortMirror("parcel", "update", { parcelId: "safe-id" }, async () => {
      const error = new Error("private sheet contents");
      error.code = "SHEET_HEADER_MISMATCH";
      throw error;
    });
    assert.deepEqual(events[0], ["google-mirror-sync-failed", {
      entity: "parcel", operation: "update", stage: "google", code: "SHEET_HEADER_MISMATCH",
      reason: "sheet-header-mismatch", message: "Google parcels sheet headers do not match",
    }]);
  } finally {
    console.error = originalError;
  }
});

test("Google diagnostics retain only allowlisted API fields and no secrets", () => {
  const originalError = console.error;
  const events = [];
  console.error = (...args) => events.push(args);
  try {
    const error = tagGoogleError(new Error("private_key=TOP_SECRET refresh_token=TOP_SECRET"), "drive-upload");
    error.response = { status: 403, data: { error: { status: "PERMISSION_DENIED",
      message: "Bearer TOP_SECRET", errors: [{ reason: "insufficientPermissions" }] } } };
    error.code = "TOP_SECRET";
    logGoogleFailure("google-parcel-operation-failed", error, {
      parcelId: "11111111-1111-4111-8111-111111111111",
    });
    assert.deepEqual(events[0][1], { parcelId: "11111111-1111-4111-8111-111111111111",
      stage: "drive-upload", status: 403, code: "PERMISSION_DENIED",
      reason: "insufficientPermissions", message: "Google API request failed" });
    assert.equal(JSON.stringify(events).includes("TOP_SECRET"), false);
  } finally {
    console.error = originalError;
  }
});

test("malformed Google credentials fail without echoing their content", () => {
  assert.throws(() => createGoogleParcelIntegration({
    GOOGLE_MIRROR_ENABLED: "true",
    GOOGLE_SERVICE_ACCOUNT_JSON: "private-secret-{",
    GOOGLE_SHEETS_SPREADSHEET_ID: "local-test-sheet",
    GOOGLE_DRIVE_PARCEL_IMAGE_FOLDER_ID: "local-test-folder",
  }), (error) => error.message === "Google service account configuration is invalid" &&
    !error.message.includes("private-secret"));
});
