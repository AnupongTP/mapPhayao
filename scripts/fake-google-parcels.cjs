const { randomUUID } = require("node:crypto");
const { Readable } = require("node:stream");

function createFakeGoogleParcels() {
  const files = new Map();
  const users = new Map();
  const parcels = new Map();
  let failUploads = 0;
  const { userCells, parcelCells } = require("../backend/src/services/googleParcelIntegration");
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
    async upsertParcel(parcel, images) {
      parcels.set(parcel.parcel_code, parcelCells(parcel, images));
    },
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
