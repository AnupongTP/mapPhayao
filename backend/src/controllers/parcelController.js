// Controller สำหรับ CRUD แปลงเกษตร ใช้ service คุยกับ PostGIS
const parcelService = require("../services/parcelService");
const appUserService = require("../services/appUserService");
const areaAnalysisService = require("../services/areaAnalysisService");
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
  return appUserService.findOrCreateLineUser(getLineUserId(req));
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
    await parcelService.deleteOwnedParcel(req.params.parcelId, appUser.id);
    return res.status(200).json({
      success: true,
    });
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
  _private: {
    getLineUserId,
    resolveAppUser,
    handleParcelError,
  },
};
