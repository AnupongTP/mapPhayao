const { randomUUID } = require("node:crypto");
const { Readable } = require("node:stream");

function createFakeGoogleParcels() {
  const files = new Map();
  const users = new Map();
  const parcels = new Map();
  let failUploads = 0;
  let ambiguousUploads = 0;
  let failReplacements = 0;
  let failAfterReplacements = 0;
  let failParcelUpserts = 0;
  let failImageReads = 0;
  let failParcelDeletes = 0;
  let requireIdlePool = false;
  let dashboardReads = 0;
  function assertIdlePool() {
    if (!requireIdlePool) return;
    const pool = require("../backend/src/config/database").pool;
    if (pool.totalCount !== pool.idleCount) throw new Error("Provider called while a DB connection is borrowed");
  }
  const { userCells, parcelCells, parseParcelImages, imageLink } = require("../backend/src/services/googleParcelIntegration");
  let sheetWrites = Promise.resolve();
  function serializeWrite(action) {
    const operation = sheetWrites.then(action);
    sheetWrites = operation.catch(() => {});
    return operation;
  }
  function ownedImages(code, ownerId) {
    const row = parcels.get(code);
    if (!row) throw new Error("Parcel Sheet row is missing");
    if (row[0] !== ownerId) throw new Error("Parcel Sheet owner mismatch");
    return parseParcelImages(row);
  }
  return {
    enabled: true,
    files,
    users,
    parcels,
    async readDashboardRows() {
      dashboardReads += 1;
      return [...parcels.values()].map((row) => [...row]);
    },
    setDashboardParcelCells(code, { createdAt, coordinate, geometry } = {}) {
      const cells = parcels.get(code);
      if (!cells) return false;
      if (createdAt !== undefined) cells[14] = createdAt;
      if (coordinate !== undefined) cells[7] = coordinate;
      if (geometry !== undefined) cells[8] = geometry;
      return true;
    },
    pruneDashboardRows(liveCodes) {
      for (const code of parcels.keys()) if (!liveCodes.has(code)) parcels.delete(code);
    },
    seedDashboardRows({ suffix, crop, count }) {
      for (let index = 1; index <= count; index += 1) {
        const lat = 19 + Math.floor(index / 10) * 0.002;
        const lng = 99.86 + (index % 10) * 0.002;
        const geometry = { type: "MultiPolygon", coordinates: [[[
          [lng, lat], [lng + 0.0005, lat], [lng + 0.0005, lat + 0.0005], [lng, lat],
        ]]] };
        const code = `DASH-${suffix}-${index}`;
        parcels.set(code, parcelCells({ owner_user_id: "synthetic-test-owner", parcel_code: code,
          parcel_name: `Dashboard fixture ${index}`, crop_type: crop, rice_variety: "",
          planting_date: "", representative_lat: lat, representative_lng: lng,
          geometry, area_sqm: 100, area_rai: 0.0625, created_at: new Date(),
          updated_at: new Date() }));
      }
    },
    async seedDashboardPhoto(code, count = 1, failIndex = null) {
      const cells = parcels.get(code);
      if (!cells) return false;
      const bytes = await require("../backend/node_modules/sharp")({ create: { width: 4, height: 4, channels: 3,
        background: "#14866d" } }).webp().toBuffer();
      const names = [];
      const links = [];
      for (let index = 0; index < count; index += 1) {
        const id = randomUUID();
        const fileName = `e2e-dashboard-photo-${index}.webp`;
        if (index !== failIndex) files.set(id, { fileName, bytes });
        names.push(fileName);
        links.push(imageLink(id));
      }
      cells[11] = JSON.stringify(names);
      cells[12] = JSON.stringify(links);
      return true;
    },
    async uploadImage(bytes, fileName) {
      assertIdlePool();
      if (failUploads > 0) {
        failUploads -= 1;
        throw new Error("Fake Drive upload failure");
      }
      const id = randomUUID();
      files.set(id, { fileName, bytes: Buffer.from(bytes) });
      if (ambiguousUploads > 0) {
        ambiguousUploads -= 1;
        const error = new Error("Fake upload timeout");
        error.googleStage = "apps-script-upload";
        error.bridgeCategory = "timeout";
        throw error;
      }
      return id;
    },
    async deleteImage(id) { files.delete(id); },
    async getImage(id) {
      const file = files.get(id);
      if (!file) throw new Error("Fake image not found");
      return Readable.from(file.bytes);
    },
    async upsertUser(user) { users.set(user.id, userCells(user)); },
    upsertParcel(parcel) { return serializeWrite(() => {
      assertIdlePool();
      if (failParcelUpserts > 0) {
        failParcelUpserts -= 1;
        const error = new Error("Fake parcel mirror failure");
        error.statusCode = 503;
        throw error;
      }
      const existing = parcels.get(parcel.parcel_code);
      const images = existing ? ownedImages(parcel.parcel_code, parcel.owner_user_id) : [];
      parcels.set(parcel.parcel_code, parcelCells(parcel, images));
    }); },
    getParcelImages(code, ownerId) { return serializeWrite(() => {
      assertIdlePool();
      if (failImageReads > 0) {
        failImageReads -= 1;
        throw Object.assign(new Error("Fake Sheet read failed"),
          { googleStage: "sheets-read", statusCode: 503, isSheetReadFailure: true });
      }
      return ownedImages(code, ownerId);
    }); },
    findParcelImage(code, ownerId, fileName) { return serializeWrite(() => {
      if (!parcels.has(code)) return null;
      return ownedImages(code, ownerId).find((image) => image.fileName === fileName) || null;
    }); },
    getParcelImageCount(code, ownerId) { return serializeWrite(() =>
      parcels.has(code) ? ownedImages(code, ownerId).length : 0); },
    appendParcelImage(code, ownerId, fileName, fileId, parcelRecord) { return serializeWrite(() => {
      const row = parcels.get(code);
      if (!row && (!parcelRecord || parcelRecord.owner_user_id !== ownerId ||
        parcelRecord.parcel_code !== code)) throw new Error("Parcel Sheet row is missing");
      const images = row ? ownedImages(code, ownerId) : [];
      const existing = images.find((item) => item.fileName === fileName);
      if (existing) {
        if (existing.fileId !== fileId) {
          const error = new Error("ข้อมูลรูปภาพแปลงขัดแย้งกัน");
          error.statusCode = 409;
          error.code = "PARCEL_IMAGE_CONFLICT";
          throw error;
        }
        return existing;
      }
      if (images.length >= 5) {
        const error = new Error("เลือกได้สูงสุด 5 รูป");
        error.statusCode = 400;
        throw error;
      }
      const image = { id: fileName, fileName, linkImage: imageLink(fileId), fileId };
      images.push(image);
      if (row) {
        row[11] = JSON.stringify(images.map((item) => item.fileName));
        row[12] = JSON.stringify(images.map((item) => item.linkImage));
      } else {
        parcels.set(code, parcelCells(parcelRecord, images));
      }
      return image;
    }); },
    replaceParcelImages(code, ownerId, expected, finalImages) { return serializeWrite(() => {
      assertIdlePool();
      if (failReplacements > 0) {
        failReplacements -= 1;
        const error = new Error("Fake Sheet write failed");
        error.statusCode = 503;
        throw error;
      }
      const current = ownedImages(code, ownerId);
      const same = (left, right) => left.length === right.length && left.every((image, index) =>
        image.fileName === right[index]?.fileName && image.fileId === right[index]?.fileId);
      if (same(current, finalImages)) return current;
      if (!same(current, expected) || finalImages.length > 5) {
        const error = new Error("Parcel image conflict");
        error.statusCode = 409;
        throw error;
      }
      const row = parcels.get(code);
      row[11] = JSON.stringify(finalImages.map((image) => image.fileName));
      row[12] = JSON.stringify(finalImages.map((image) => imageLink(image.fileId)));
      if (failAfterReplacements > 0) {
        failAfterReplacements -= 1;
        const error = new Error("Fake response lost after Sheet write");
        error.statusCode = 503;
        throw error;
      }
      return finalImages;
    }); },
    async deleteParcel(code) {
      if (failParcelDeletes > 0) {
        failParcelDeletes -= 1;
        throw Object.assign(new Error("Fake Sheet delete failed"),
          { googleStage: "sheets-delete-parcel", statusCode: 503 });
      }
      parcels.delete(code);
    },
    failNextUpload() { failUploads += 1; },
    failNextAmbiguousUpload() { ambiguousUploads += 1; },
    failNextReplacement() { failReplacements += 1; },
    failAfterNextReplacement() { failAfterReplacements += 1; },
    failNextParcelUpsert() { failParcelUpserts += 1; },
    failNextImageRead() { failImageReads += 1; },
    failNextParcelDelete() { failParcelDeletes += 1; },
    requireIdlePool(value) { requireIdlePool = value === true; },
    snapshot() {
      return {
        dashboardReads,
        files: [...files.entries()].map(([id, item]) => ({ id, fileName: item.fileName, byteSize: item.bytes.length })),
        users: [...users.values()],
        parcels: [...parcels.values()],
      };
    },
  };
}

module.exports = { createFakeGoogleParcels };
