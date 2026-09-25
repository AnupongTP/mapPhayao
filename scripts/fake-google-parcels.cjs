const { randomUUID } = require("node:crypto");
const { Readable } = require("node:stream");

function createFakeGoogleParcels() {
  const files = new Map();
  const users = new Map();
  const parcels = new Map();
  let failUploads = 0;
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
    async uploadImage(bytes, fileName) {
      if (failUploads > 0) {
        failUploads -= 1;
        throw new Error("Fake Drive upload failure");
      }
      const id = randomUUID();
      files.set(id, { fileName, bytes: Buffer.from(bytes) });
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
      const existing = parcels.get(parcel.parcel_code);
      const images = existing ? ownedImages(parcel.parcel_code, parcel.owner_user_id) : [];
      parcels.set(parcel.parcel_code, parcelCells(parcel, images));
    }); },
    getParcelImages(code, ownerId) { return serializeWrite(() => ownedImages(code, ownerId)); },
    appendParcelImage(code, ownerId, fileName, fileId, parcelRecord) { return serializeWrite(() => {
      const row = parcels.get(code);
      if (!row && (!parcelRecord || parcelRecord.owner_user_id !== ownerId ||
        parcelRecord.parcel_code !== code)) throw new Error("Parcel Sheet row is missing");
      const images = row ? ownedImages(code, ownerId) : [];
      const existing = images.find((item) => item.fileName === fileName);
      if (existing) {
        if (existing.fileId !== fileId) throw new Error("Duplicate parcel image");
        return existing;
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
    async deleteParcel(code) { parcels.delete(code); },
    failNextUpload() { failUploads += 1; },
    snapshot() {
      return {
        files: [...files.entries()].map(([id, item]) => ({ id, fileName: item.fileName, byteSize: item.bytes.length })),
        users: [...users.values()],
        parcels: [...parcels.values()],
      };
    },
  };
}

module.exports = { createFakeGoogleParcels };
