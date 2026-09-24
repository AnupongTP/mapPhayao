const { randomBytes } = require("node:crypto");
const sharp = require("sharp");
const db = require("../config/database");
const parcelService = require("./parcelService");
const createHttpError = require("../utils/httpError");

const MAX_RAW_BYTES = 12 * 1024 * 1024;
const MAX_LONG_EDGE = 1600;
const WEBP_QUALITY = 75;

function mapImage(row) {
  return {
    id: row.id, fileName: row.file_name, linkImage: row.link_image,
    mimeType: row.mime_type, byteSize: Number(row.byte_size),
    width: row.width, height: row.height, sortOrder: row.sort_order,
    createdAt: row.created_at,
  };
}

async function listOwnedImages(parcelId, ownerUserId) {
  const id = parcelService._private.validateUuid(parcelId);
  const owner = parcelService._private.validateUuid(ownerUserId);
  const result = await db.query(`
    SELECT i.id, i.file_name, i.link_image, i.mime_type, i.byte_size,
      i.width, i.height, i.sort_order, i.created_at
    FROM app.parcel_images i
    JOIN app.parcels p ON p.id = i.parcel_id
    WHERE p.id = $1 AND p.owner_user_id = $2
    ORDER BY i.sort_order, i.created_at, i.id;
  `, [id, owner]);
  return result.rows.map(mapImage);
}

async function normalizeImage(file) {
  if (!file?.buffer?.length) throw createHttpError(400, "กรุณาเลือกรูปภาพ");
  if (file.buffer.length > MAX_RAW_BYTES) throw createHttpError(413, "รูปภาพมีขนาดใหญ่เกิน 12 MB");
  let metadata;
  try {
    metadata = await sharp(file.buffer, { failOn: "error", limitInputPixels: 40_000_000 }).metadata();
  } catch (error) {
    throw createHttpError(415, "ไม่รองรับไฟล์รูปภาพนี้");
  }
  if (!["jpeg", "png", "webp", "heif"].includes(metadata.format)) {
    throw createHttpError(415, "ไม่รองรับไฟล์รูปภาพนี้");
  }
  try {
    const { data, info } = await sharp(file.buffer, { failOn: "error", limitInputPixels: 40_000_000 })
      .rotate()
      .resize({ width: MAX_LONG_EDGE, height: MAX_LONG_EDGE, fit: "inside", withoutEnlargement: true })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer({ resolveWithObject: true });
    return { bytes: data, width: info.width, height: info.height };
  } catch (error) {
    throw createHttpError(415, "ไม่รองรับไฟล์รูปภาพนี้");
  }
}

async function uploadOwnedImage(parcelId, ownerUserId, file, google) {
  if (!google?.enabled) throw createHttpError(503, "ยังไม่ได้ตั้งค่าบริการรูปภาพแปลง");
  const parcel = await parcelService.getOwnedParcelById(parcelId, ownerUserId);
  const normalized = await normalizeImage(file);
  const timestamp = new Date().toISOString().replace(/[-:.]/g, "");
  const fileName = `${parcel.parcelCode}_${timestamp}_${randomBytes(5).toString("hex")}.webp`;
  const driveFileId = await google.uploadImage(normalized.bytes, fileName);
  try {
    const result = await db.query(`
      INSERT INTO app.parcel_images (
        parcel_id, drive_file_id, file_name, link_image, mime_type,
        byte_size, width, height, sort_order
      )
      SELECT p.id, $3, $4, $5, 'image/webp', $6, $7, $8,
        COALESCE((SELECT MAX(sort_order) FROM app.parcel_images WHERE parcel_id = p.id), 0) + 1
      FROM app.parcels p WHERE p.id = $1 AND p.owner_user_id = $2
      RETURNING id, file_name, link_image, mime_type, byte_size,
        width, height, sort_order, created_at;
    `, [parcel.id, ownerUserId, driveFileId, fileName,
      `https://drive.google.com/uc?export=view&id=${encodeURIComponent(driveFileId)}`,
      normalized.bytes.length, normalized.width, normalized.height]);
    if (!result.rows[0]) throw createHttpError(404, "Parcel not found");
    return mapImage(result.rows[0]);
  } catch (error) {
    try { await google.deleteImage(driveFileId); } catch (cleanupError) {
      console.error("parcel-image-cleanup-failed", { parcelId: parcel.id });
    }
    throw error;
  }
}

async function getOwnedImageFileId(parcelId, imageId, ownerUserId) {
  const id = parcelService._private.validateUuid(parcelId);
  const image = parcelService._private.validateUuid(imageId);
  const owner = parcelService._private.validateUuid(ownerUserId);
  const result = await db.query(`
    SELECT i.drive_file_id
    FROM app.parcel_images i JOIN app.parcels p ON p.id = i.parcel_id
    WHERE p.id = $1 AND i.id = $2 AND p.owner_user_id = $3;
  `, [id, image, owner]);
  if (!result.rows[0]) throw createHttpError(404, "Parcel not found");
  return result.rows[0].drive_file_id;
}

async function getOwnedImageFiles(parcelId, ownerUserId) {
  const id = parcelService._private.validateUuid(parcelId);
  const owner = parcelService._private.validateUuid(ownerUserId);
  const result = await db.query(`
    SELECT p.parcel_code, i.drive_file_id
    FROM app.parcels p LEFT JOIN app.parcel_images i ON i.parcel_id = p.id
    WHERE p.id = $1 AND p.owner_user_id = $2;
  `, [id, owner]);
  if (!result.rows.length) throw createHttpError(404, "Parcel not found");
  return { parcelCode: result.rows[0].parcel_code,
    fileIds: result.rows.map((row) => row.drive_file_id).filter(Boolean) };
}

module.exports = {
  MAX_RAW_BYTES, MAX_LONG_EDGE, WEBP_QUALITY,
  normalizeImage, listOwnedImages, uploadOwnedImage, getOwnedImageFileId, getOwnedImageFiles,
};
