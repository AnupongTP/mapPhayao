const sharp = require("sharp");
const parcelService = require("./parcelService");
const parcelMirrorService = require("./parcelMirrorService");
const createHttpError = require("../utils/httpError");
const { logGoogleFailure, tagGoogleError } = require("../utils/googleError");

const MAX_RAW_BYTES = 12 * 1024 * 1024;
const MAX_LONG_EDGE = 1600;
const WEBP_QUALITY = 75;
const RETRYABLE_SHEET_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const RETRYABLE_SHEET_CODES = new Set(["ECONNRESET", "ETIMEDOUT", "EAI_AGAIN"]);
const RETRYABLE_SHEET_STAGES = new Set(["sheets-header-check", "sheets-read", "sheets-append-image"]);
const CLIENT_PHOTO_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validateClientPhotoId(value) {
  if (typeof value !== "string" || !CLIENT_PHOTO_ID.test(value)) {
    throw createHttpError(400, "รหัสรูปภาพไม่ถูกต้อง");
  }
  return value.toLowerCase();
}

function safeSheetRetry(error) {
  const status = Number(error?.response?.status ?? error?.statusCode ?? error?.code);
  return RETRYABLE_SHEET_STAGES.has(error?.googleStage) &&
    (RETRYABLE_SHEET_STATUSES.has(status) || RETRYABLE_SHEET_CODES.has(error?.code));
}

function ambiguousDriveWrite(error) {
  if (["apps-script-upload", "drive-upload"].includes(error?.googleStage)) {
    return ["timeout", "network", "rejected"].includes(error?.bridgeCategory) ||
      ["ECONNRESET", "ETIMEDOUT", "EAI_AGAIN"].includes(error?.code) ||
      [408, 429, 500, 502, 503, 504].includes(Number(error?.response?.status));
  }
  return error?.googleStage === "apps-script-invalid-response" ||
    (error?.googleStage === "apps-script-http" &&
      [408, 429, 500, 502, 503, 504].includes(Number(error?.statusCode)));
}

async function listOwnedImages(parcelId, ownerUserId, google) {
  const parcel = await parcelService.getOwnedParcelById(parcelId, ownerUserId);
  if (!google?.enabled) return [];
  const images = await google.getParcelImages(parcel.parcelCode, ownerUserId);
  return images.map(({ fileId, ...image }) => image);
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

async function uploadOwnedImage(parcelId, ownerUserId, file, google, clientPhotoId, database, onStage = () => {}) {
  const photoId = validateClientPhotoId(clientPhotoId);
  if (!google?.enabled) throw createHttpError(503, "ยังไม่ได้ตั้งค่าบริการรูปภาพแปลง");
  onStage("PARCEL_LOOKUP");
  const parcel = await parcelService.getOwnedParcelById(parcelId, ownerUserId, database);
  onStage("PARCEL_VERIFIED");
  onStage("IMAGE_VALIDATION");
  const normalized = await normalizeImage(file);
  onStage("IMAGE_PROCESSED");
  const mirrorRecord = await parcelMirrorService.getParcelMirrorRecord(parcel.id, database);
  if (!mirrorRecord || mirrorRecord.owner_user_id !== ownerUserId || mirrorRecord.parcel_code !== parcel.parcelCode) {
    throw createHttpError(404, "Parcel not found");
  }
  const fileName = `${parcel.parcelCode}_${photoId}.webp`;
  let existing;
  onStage("SHEET_CHECK");
  try {
    existing = await google.findParcelImage?.(parcel.parcelCode, ownerUserId, fileName);
  } catch (error) {
    if (safeSheetRetry(error)) error.photoRetryable = true;
    throw error;
  }
  if (existing) {
    console.info("parcel-image-idempotent-match", { parcelId: parcel.id, stage: "sheets-read" });
    const { fileId, ...image } = existing;
    return image;
  }
  try {
    if (await google.getParcelImageCount?.(parcel.parcelCode, ownerUserId) >= 5) {
      throw createHttpError(400, "เลือกได้สูงสุด 5 รูป");
    }
  } catch (error) {
    if (safeSheetRetry(error)) error.photoRetryable = true;
    throw error;
  }
  let driveFileId;
  onStage("DRIVE_UPLOAD");
  try {
    driveFileId = await google.uploadImage(normalized.bytes, fileName);
  } catch (error) {
    if (ambiguousDriveWrite(error)) error.photoAmbiguous = true;
    throw error;
  }
  try {
    onStage("SHEET_UPDATE");
    let stored;
    try {
      stored = await google.appendParcelImage(parcel.parcelCode, ownerUserId, fileName, driveFileId, mirrorRecord);
    } catch (error) {
      if (!safeSheetRetry(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 200));
      stored = await google.appendParcelImage(parcel.parcelCode, ownerUserId, fileName, driveFileId, mirrorRecord);
    }
    const { fileId, ...image } = stored;
    return image;
  } catch (error) {
    if (google.findParcelImage) {
      let registered;
      try {
        registered = await google.findParcelImage(parcel.parcelCode, ownerUserId, fileName);
      } catch (readError) {
        error.photoAmbiguous = true;
        throw error;
      }
      if (registered?.fileId === driveFileId) {
        console.info("parcel-image-idempotent-match", { parcelId: parcel.id, stage: "sheets-read" });
        const { fileId, ...image } = registered;
        return image;
      }
      if (registered && registered.fileId !== driveFileId) {
        error = createHttpError(409, "ข้อมูลรูปภาพแปลงขัดแย้งกัน");
        error.code = "PARCEL_IMAGE_CONFLICT";
      }
    }
    try { await google.deleteImage(driveFileId); } catch (cleanupError) {
      logGoogleFailure("parcel-image-cleanup-failed", tagGoogleError(cleanupError, "drive-delete-cleanup"),
        { parcelId: parcel.id });
      error.photoAmbiguous = true;
    }
    if (!error.photoAmbiguous && safeSheetRetry(error)) error.photoRetryable = true;
    throw error;
  }
}

async function getOwnedImageFileId(parcelId, imageId, ownerUserId, google) {
  const parcel = await parcelService.getOwnedParcelById(parcelId, ownerUserId);
  if (!google?.enabled) throw createHttpError(503, "ยังไม่ได้ตั้งค่าบริการรูปภาพแปลง");
  const images = await google.getParcelImages(parcel.parcelCode, ownerUserId);
  const image = images.find((item) => item.fileName === imageId);
  if (!image) throw createHttpError(404, "Parcel not found");
  return image.fileId;
}

async function getOwnedImageFiles(parcelId, ownerUserId, google, database) {
  const parcel = await parcelService.getOwnedParcelById(parcelId, ownerUserId, database);
  const images = await google.getParcelImages(parcel.parcelCode, ownerUserId);
  return { parcelCode: parcel.parcelCode, fileIds: images.map((image) => image.fileId) };
}

module.exports = {
  MAX_RAW_BYTES, MAX_LONG_EDGE, WEBP_QUALITY,
  normalizeImage, listOwnedImages, uploadOwnedImage, getOwnedImageFileId, getOwnedImageFiles,
  validateClientPhotoId, safeSheetRetry, ambiguousDriveWrite,
};
