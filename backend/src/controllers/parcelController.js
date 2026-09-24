// Controller สำหรับ CRUD แปลงเกษตร ใช้ service คุยกับ PostGIS
const parcelService = require("../services/parcelService");
const appUserService = require("../services/appUserService");
const areaAnalysisService = require("../services/areaAnalysisService");
const parcelImageService = require("../services/parcelImageService");
const parcelMirrorService = require("../services/parcelMirrorService");
const createHttpError = require("../utils/httpError");

const AUTH_REQUIRED_MESSAGE = "LINE authentication required";
const INTERNAL_ERROR_MESSAGE = "Server error";

function getLineUserId(req) {
  const lineUserId = typeof req.lineIdentity?.lineUserId === "string"
    ? req.lineIdentity.lineUserId.trim()
    : "";

  if (!lineUserId) {
    throw createHttpError(401, AUTH_REQUIRED_MESSAGE);
  }

  return lineUserId;
}

async function resolveAppUser(req) {
  const user = await appUserService.findOrCreateLineUser(getLineUserId(req));
  await appUserService.updateVerifiedDisplayName(user.id, req.lineIdentity.displayName);
  return user;
}

async function syncParcelMirror(req, parcelId, operation) {
  const google = req.googleIntegration;
  if (!google?.enabled) return;
  await parcelMirrorService.bestEffortMirror("parcel", operation, { parcelId }, async () => {
    const user = await resolveAppUser(req);
    await parcelMirrorService.mirrorUser(user.id, google);
    await parcelMirrorService.mirrorParcel(parcelId, google);
  });
}

function handleParcelError(error, next) {
  if (error.statusCode) {
    return next(error);
  }

  return next(createHttpError(500, INTERNAL_ERROR_MESSAGE));
}

async function createParcel(req, res, next) {
  try {
    const parcel = await parcelService.createParcel(req.body || {}, {
      lineUserId: getLineUserId(req),
    });
    await syncParcelMirror(req, parcel.id, "create");
    return res.status(201).json({
      success: true,
      parcel,
    });
  } catch (error) {
    return handleParcelError(error, next);
  }
}

async function getParcel(req, res, next) {
  try {
    const appUser = await resolveAppUser(req);
    const parcel = await parcelService.getOwnedParcelById(req.params.parcelId, appUser.id);
    parcel.images = await parcelImageService.listOwnedImages(parcel.id, appUser.id);
    return res.status(200).json({
      success: true,
      parcel,
    });
  } catch (error) {
    return handleParcelError(error, next);
  }
}

async function listParcels(req, res, next) {
  try {
    const appUser = await resolveAppUser(req);
    const parcels = await parcelService.listOwnedParcels(appUser.id, {
      limit: req.query.limit,
    });
    return res.status(200).json({
      success: true,
      parcels,
    });
  } catch (error) {
    return handleParcelError(error, next);
  }
}

async function updateParcel(req, res, next) {
  try {
    const appUser = await resolveAppUser(req);
    const parcel = await parcelService.updateOwnedParcel(
      req.params.parcelId,
      req.body || {},
      appUser.id,
    );
    await syncParcelMirror(req, parcel.id, "update");
    return res.status(200).json({
      success: true,
      parcel,
    });
  } catch (error) {
    return handleParcelError(error, next);
  }
}

async function deleteParcel(req, res, next) {
  try {
    const appUser = await resolveAppUser(req);
    const google = req.googleIntegration;
    const previous = google?.enabled
      ? await parcelImageService.getOwnedImageFiles(req.params.parcelId, appUser.id)
      : null;
    await parcelService.deleteOwnedParcel(req.params.parcelId, appUser.id);
    if (previous) {
      await parcelMirrorService.bestEffortMirror("parcel", "delete", { parcelId: req.params.parcelId },
        () => google.deleteParcel(previous.parcelCode));
      for (const fileId of previous.fileIds) {
        try { await google.deleteImage(fileId); } catch (error) {
          console.error("parcel-image-cleanup-failed", { parcelId: req.params.parcelId });
        }
      }
    }
    return res.status(200).json({
      success: true,
    });
  } catch (error) {
    return handleParcelError(error, next);
  }
}

async function uploadImage(req, res, next) {
  try {
    const appUser = await resolveAppUser(req);
    const image = await parcelImageService.uploadOwnedImage(
      req.params.parcelId, appUser.id, req.file, req.googleIntegration,
    );
    await syncParcelMirror(req, req.params.parcelId, "image-upload");
    return res.status(201).json({ success: true, image });
  } catch (error) {
    return handleParcelError(error, next);
  }
}

async function getImageContent(req, res, next) {
  try {
    const appUser = await resolveAppUser(req);
    const fileId = await parcelImageService.getOwnedImageFileId(
      req.params.parcelId, req.params.imageId, appUser.id,
    );
    if (!req.googleIntegration?.enabled) {
      throw createHttpError(503, "ยังไม่ได้ตั้งค่าบริการรูปภาพแปลง");
    }
    const stream = await req.googleIntegration.getImage(fileId);
    res.set({ "Content-Type": "image/webp", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
    stream.on("error", () => res.destroy());
    return stream.pipe(res);
  } catch (error) {
    return handleParcelError(error, next);
  }
}

async function analyzeParcel(req, res, next) {
  try {
    const appUser = await resolveAppUser(req);
    const analysisInput = await parcelService.getOwnedParcelAnalysisInput(
      req.params.parcelId,
      appUser.id,
    );
    const analysis = await areaAnalysisService.analyzePolygon({
      name: analysisInput.name,
      geometry: analysisInput.geometry,
    });

    return res.status(200).json(analysis);
  } catch (error) {
    return handleParcelError(error, next);
  }
}

module.exports = {
  createParcel,
  getParcel,
  listParcels,
  updateParcel,
  deleteParcel,
  analyzeParcel,
  uploadImage,
  getImageContent,
  _private: {
    getLineUserId,
    resolveAppUser,
    handleParcelError,
  },
};
