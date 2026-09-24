const test = require("node:test");
const assert = require("node:assert/strict");
const sharp = require("sharp");
const { normalizeImage, MAX_RAW_BYTES, MAX_LONG_EDGE, WEBP_QUALITY } = require("../src/services/parcelImageService");
const parcelImageService = require("../src/services/parcelImageService");
const parcelService = require("../src/services/parcelService");
const db = require("../src/config/database");
const { bestEffortMirror, mirrorParcel } = require("../src/services/parcelMirrorService");
const { userCells, parcelCells, formatCoordinate, PARCEL_HEADERS, createGoogleParcelIntegration } = require("../src/services/googleParcelIntegration");
const { createFakeGoogleParcels } = require("../../scripts/fake-google-parcels.cjs");

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
    area_sqm: 1600, area_rai: 1, note: "untrusted note", picture_url: user.picture_url,
    line_user_id: user.line_user_id,
  };
  const cells = parcelCells(parcel, [
    { id: "b", sort_order: 2, created_at: "2026-01-01T00:00:00Z", file_name: "second.webp", link_image: "second-url" },
    { id: "c", sort_order: 1, created_at: "2026-01-02T00:00:00Z", file_name: "third.webp", link_image: "third-url" },
    { id: "a", sort_order: 1, created_at: "2026-01-01T00:00:00Z", file_name: "first.webp", link_image: "first-url" },
  ]);
  assert.deepEqual(PARCEL_HEADERS, ["user_id", "display_name", "parcel_code", "parcel_name", "crop", "variety",
    "planting_date", "Coordinate", "geometry", "area_m2", "area_rai", "Image", "LinkImage", "note", "created_at", "updated_at"]);
  assert.equal(cells.length, 16);
  assert.deepEqual(cells.slice(0, 8), ["internal-uuid", "Verified", "PY-2026-0001", "Field", "rice", "Khao Dawk Mali", "2026-01-02", ""]);
  assert.deepEqual(JSON.parse(cells[8]), parcel.geometry);
  assert.deepEqual(cells.slice(9, 11), [1600, 1]);
  assert.deepEqual(JSON.parse(cells[11]), ["first.webp", "third.webp", "second.webp"]);
  assert.deepEqual(JSON.parse(cells[12]), ["first-url", "third-url", "second-url"]);
  assert.equal(cells[13], "");
  assert.deepEqual(cells.slice(14), ["", ""]);
  assert.equal(cells.join(" ").includes("private"), false);
  assert.equal(cells.join(" ").includes("U_PRIVATE"), false);
  assert.equal(parcelCells(parcel, [])[11], "[]");
  assert.equal(parcelCells(parcel, [])[12], "[]");
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
    }] };
    return { rows: [] };
  };
  try {
    await mirrorParcel("parcel-id", { enabled: true, async upsertParcel(parcel, images) {
      mirrored = parcelCells(parcel, images);
    } });
    assert.match(calls[0].sql, /JOIN app\.users u ON u\.id = p\.owner_user_id/);
    assert.match(calls[0].sql, /u\.display_name/);
    assert.deepEqual(calls[0].params, ["parcel-id"]);
    assert.deepEqual(mirrored.slice(0, 3), ["internal-uuid", "Verified", "PY-1"]);
  } finally {
    db.query = originalQuery;
  }
});

test("fake Google integration stores only local bytes and mirrors row cells", async () => {
  const fake = createFakeGoogleParcels();
  const id = await fake.uploadImage(Buffer.from("webp"), "a.webp");
  assert.equal(fake.snapshot().files[0].fileName, "a.webp");
  await fake.upsertUser({ id: "internal", display_name: "A" });
  await fake.upsertParcel({ owner_user_id: "internal", parcel_code: "PY-1", crop_type: "rice", geometry: {} }, []);
  assert.equal(fake.snapshot().parcels[0].length, 16);
  assert.deepEqual(JSON.parse(fake.snapshot().parcels[0][11]), []);
  assert.deepEqual(JSON.parse(fake.snapshot().parcels[0][12]), []);
  await fake.deleteImage(id);
  await fake.deleteParcel("PY-1");
  assert.deepEqual(fake.snapshot().files, []);
  assert.deepEqual(fake.snapshot().parcels, []);
});

test("Drive failure creates no DB image row; DB failure deletes uploaded Drive file", async () => {
  const originalParcelLookup = parcelService.getOwnedParcelById;
  const originalQuery = db.query;
  const bytes = await sharp({ create: { width: 20, height: 10, channels: 3, background: "green" } }).png().toBuffer();
  const file = { buffer: bytes };
  const parcelId = "11111111-1111-4111-8111-111111111111";
  const ownerId = "22222222-2222-4222-8222-222222222222";
  const calls = [];
  parcelService.getOwnedParcelById = async () => ({ id: parcelId, parcelCode: "PY-2026-0001" });
  db.query = async () => { calls.push("db-insert"); throw new Error("DB write failed"); };
  try {
    await assert.rejects(() => parcelImageService.uploadOwnedImage(parcelId, ownerId, file, {
      enabled: true,
      async uploadImage() { throw new Error("Drive unavailable"); },
      async deleteImage() { calls.push("cleanup"); },
    }), /Drive unavailable/);
    assert.deepEqual(calls, []);
    await assert.rejects(() => parcelImageService.uploadOwnedImage(parcelId, ownerId, file, {
      enabled: true,
      async uploadImage() { calls.push("drive-upload"); return "fake-file"; },
      async deleteImage(id) { calls.push(`cleanup:${id}`); },
    }), /DB write failed/);
    assert.deepEqual(calls, ["drive-upload", "db-insert", "cleanup:fake-file"]);
  } finally {
    parcelService.getOwnedParcelById = originalParcelLookup;
    db.query = originalQuery;
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
    assert.deepEqual(events[0][1], { entity: "parcel", operation: "update", parcelId: "safe-id" });
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
      entity: "parcel", operation: "update", parcelId: "safe-id", reason: "sheet-header-mismatch",
    }]);
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
