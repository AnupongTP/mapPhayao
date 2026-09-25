const { randomBytes } = require("node:crypto");
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

async function uploadOwnedImage(parcelId, ownerUserId, file, google) {
  if (!google?.enabled) throw createHttpError(503, "ยังไม่ได้ตั้งค่าบริการรูปภาพแปลง");
  const parcel = await parcelService.getOwnedParcelById(parcelId, ownerUserId);
  const normalized = await normalizeImage(file);
  const mirrorRecord = await parcelMirrorService.getParcelMirrorRecord(parcel.id);
  if (!mirrorRecord || mirrorRecord.owner_user_id !== ownerUserId || mirrorRecord.parcel_code !== parcel.parcelCode) {
    throw createHttpError(404, "Parcel not found");
  }
  const timestamp = new Date().toISOString().replace(/[-:.]/g, "");
  const fileName = `${parcel.parcelCode}_${timestamp}_${randomBytes(5).toString("hex")}.webp`;
  const driveFileId = await google.uploadImage(normalized.bytes, fileName);
  try {
    let stored;
    try {
      stored = await google.appendParcelImage(parcel.parcelCode, ownerUserId, fileName, driveFileId, mirrorRecord);
    } catch (error) {
      const status = Number(error?.response?.status ?? error?.statusCode ?? error?.code);
      if (!RETRYABLE_SHEET_STAGES.has(error?.googleStage) ||
        (!RETRYABLE_SHEET_STATUSES.has(status) && !RETRYABLE_SHEET_CODES.has(error?.code))) throw error;
      await new Promise((resolve) => setTimeout(resolve, 200));
      stored = await google.appendParcelImage(parcel.parcelCode, ownerUserId, fileName, driveFileId, mirrorRecord);
    }
    const { fileId, ...image } = stored;
    return image;
  } catch (error) {
    try { await google.deleteImage(driveFileId); } catch (cleanupError) {
      logGoogleFailure("parcel-image-cleanup-failed", tagGoogleError(cleanupError, "drive-delete-cleanup"),
        { parcelId: parcel.id });
    }
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

async function getOwnedImageFiles(parcelId, ownerUserId, google) {
  const parcel = await parcelService.getOwnedParcelById(parcelId, ownerUserId);
  const images = await google.getParcelImages(parcel.parcelCode, ownerUserId);
  return { parcelCode: parcel.parcelCode, fileIds: images.map((image) => image.fileId) };
}

module.exports = {
  MAX_RAW_BYTES, MAX_LONG_EDGE, WEBP_QUALITY,
  normalizeImage, listOwnedImages, uploadOwnedImage, getOwnedImageFileId, getOwnedImageFiles,
};
