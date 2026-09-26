// Controller สำหรับ CRUD แปลงเกษตร ใช้ service คุยกับ PostGIS
const parcelService = require("../services/parcelService");
const appUserService = require("../services/appUserService");
const areaAnalysisService = require("../services/areaAnalysisService");
const parcelImageService = require("../services/parcelImageService");
const parcelMirrorService = require("../services/parcelMirrorService");
const createHttpError = require("../utils/httpError");
const { performance } = require("node:perf_hooks");
const { logGoogleFailure, tagGoogleError } = require("../utils/googleError");

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

async function syncParcelMirror(req, parcelId, operation, appUser) {
  const google = req.googleIntegration;
  if (!google?.enabled) return;
  await parcelMirrorService.bestEffortMirror("parcel", operation, { parcelId }, async () => {
    const user = appUser || await resolveAppUser(req);
    const mirror = async (database) => {
      await parcelMirrorService.mirrorUser(user.id, google, database);
      await parcelMirrorService.mirrorParcel(parcelId, google, database);
    };
    if (operation === "update") {
      await parcelService.withParcelMutationLock(parcelId, mirror);
    } else {
      await mirror();
    }
  });
}

function handleParcelError(error, next, parcelId) {
  if (error?.googleStage) logGoogleFailure("google-parcel-operation-failed", error, { parcelId });
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
    parcel.images = await parcelImageService.listOwnedImages(parcel.id, appUser.id, req.googleIntegration);
    return res.status(200).json({
      success: true,
      parcel,
    });
  } catch (error) {
    return handleParcelError(error, next, req.params.parcelId);
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
    await syncParcelMirror(req, parcel.id, "update", appUser);
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
    if (!google?.enabled) throw createHttpError(503, "ยังไม่ได้ตั้งค่าบริการรูปภาพแปลง");
    const { jobId, previous } = await parcelService.withParcelMutationLock(req.params.parcelId, async (client) => {
      const previous = await parcelImageService.getOwnedImageFiles(req.params.parcelId, appUser.id, google, client);
      const jobId = await parcelService.deleteOwnedParcel(req.params.parcelId, appUser.id,
        { parcelCode: previous.parcelCode, fileIds: previous.fileIds }, client);
      return { jobId, previous };
    });
    console.info("parcel-cleanup-job-created", { parcelId: req.params.parcelId, jobId,
      remainingFiles: previous.fileIds.length });
    return res.status(200).json({
      success: true,
    });
  } catch (error) {
    if (error?.googleStage) {
      logGoogleFailure("parcel-cleanup-metadata-failed", error, { parcelId: req.params.parcelId });
      return next(createHttpError(503, "ไม่สามารถเตรียมข้อมูลลบรูปภาพแปลงได้"));
    }
    return handleParcelError(error, next, req.params.parcelId);
  }
}

async function uploadImage(req, res, next) {
  try {
    const appUser = await resolveAppUser(req);
    const image = await parcelService.withParcelMutationLock(req.params.parcelId, (client) =>
      parcelImageService.uploadOwnedImage(req.params.parcelId, appUser.id, req.file,
        req.googleIntegration, req.body?.clientPhotoId, client,
        (stage) => { req.uploadDiagnostic.stage = stage; }));
    req.uploadDiagnostic.stage = "UPLOAD_COMPLETE";
    return res.status(201).json({ success: true, image,
      stage: "UPLOAD_COMPLETE", requestId: req.uploadDiagnostic.requestId });
  } catch (error) {
    return next(error);
  }
}

async function getImageContent(req, res, next) {
  const started = performance.now();
  try {
    const appUser = await resolveAppUser(req);
    const fileId = await parcelImageService.getOwnedImageFileId(
      req.params.parcelId, req.params.imageId, appUser.id, req.googleIntegration,
    );
    if (!req.googleIntegration?.enabled) {
      throw createHttpError(503, "ยังไม่ได้ตั้งค่าบริการรูปภาพแปลง");
    }
    const ownershipEnd = performance.now();
    const stream = await req.googleIntegration.getImage(fileId);
    const providerEnd = performance.now();
    const duration = (start, end) => Math.max(0, end - start).toFixed(1);
    res.set({ "Content-Type": "image/webp", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
      "Server-Timing": `ownership;dur=${duration(started, ownershipEnd)}, ` +
        `provider;dur=${duration(ownershipEnd, providerEnd)}, backend;dur=${duration(started, providerEnd)}` });
    stream.on("error", (error) => {
      logGoogleFailure("google-parcel-operation-failed", tagGoogleError(error, "drive-read"),
        { parcelId: req.params.parcelId });
      res.destroy();
    });
    return stream.pipe(res);
  } catch (error) {
    return handleParcelError(error, next, req.params.parcelId);
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
