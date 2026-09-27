// Route ของแปลงเกษตร แยกไว้เพื่อไม่ปะปนกับ point-analysis API
const express = require("express");
const parcelController = require("../controllers/parcelController");
const { createLineAuthMiddleware } = require("../middleware/lineAuthMiddleware");
const { createGoogleParcelIntegration } = require("../services/googleParcelIntegration");
const { MAX_RAW_BYTES } = require("../services/parcelImageService");
const multer = require("multer");
const { randomBytes } = require("node:crypto");
const { performance } = require("node:perf_hooks");
const createHttpError = require("../utils/httpError");
const { uploadErrorDetails, logGoogleFailure, googleErrorDetails } = require("../utils/googleError");

const TIMING_FIELDS = new Set(["sharpMs", "sheetPreflightMs", "appsScriptMs", "sheetUpdateMs"]);
const UPLOAD_CHECKPOINTS = {
  IMAGE_PROCESSED: "sharp-complete",
  SHEET_PREFLIGHT_COMPLETE: "sheet-preflight-complete",
  DRIVE_UPLOAD: "apps-script-upload-started",
  DRIVE_UPLOAD_COMPLETE: "apps-script-upload-complete",
  SHEET_UPDATE_COMPLETE: "sheet-update-complete",
};

function safeDuration(value) {
  if (!Number.isFinite(value) || value < 0) return undefined;
  const rounded = Math.round(value * 10) / 10;
  return Number.isFinite(rounded) ? rounded : undefined;
}

function uploadAttempt(req) {
  const attempt = Number(req.get("X-Photo-Attempt"));
  return Number.isInteger(attempt) && attempt >= 0 && attempt <= 3 ? attempt : 0;
}

function logUploadEvent(req, event, stage, extra = {}) {
  const diagnostic = req.uploadDiagnostic;
  try {
    console.info(event, { requestId: diagnostic.requestId, attempt: uploadAttempt(req),
      stage, elapsedMs: safeDuration(performance.now() - diagnostic.startedAt), ...extra });
  } catch { /* Logging cannot affect the upload. */ }
}

function logUploadTiming(req, error) {
  const diagnostic = req.uploadDiagnostic;
  const details = error ? googleErrorDetails(error) : null;
  const timings = Object.fromEntries(Object.entries(diagnostic.timings)
    .filter(([name, value]) => TIMING_FIELDS.has(name) && safeDuration(value) !== undefined)
    .map(([name, value]) => [name, safeDuration(value)]));
  const record = {
    requestId: diagnostic.requestId,
    attempt: uploadAttempt(req),
    stage: error ? (details.stage === "google" ? diagnostic.stage : details.stage) : "UPLOAD_COMPLETE",
    ...(error ? (details.category ? { category: details.category } : {}) : { category: "success" }),
    ...timings,
    totalMs: safeDuration(performance.now() - diagnostic.startedAt),
  };
  try { console.info("parcel-image-upload-timing", record); } catch { /* Logging cannot affect the response. */ }
}

function createParcelRoutes(dependencies = {}) {
const router = express.Router();
const requireLineAuth = createLineAuthMiddleware(dependencies);
const googleIntegration = dependencies.googleIntegration || createGoogleParcelIntegration();
router.googleIntegration = googleIntegration;
const parseImage = multer({ storage: multer.memoryStorage(), limits: {
  fileSize: MAX_RAW_BYTES, files: 1, fields: 1, parts: 2,
} }).single("image");

router.use((req, res, next) => {
  if (req.method === "POST" && /^\/[^/]+\/images$/.test(req.path)) {
    req.uploadDiagnostic = { requestId: randomBytes(4).toString("hex").toUpperCase(),
      stage: "REQUEST_RECEIVED", startedAt: performance.now(), timings: {} };
    req.uploadDiagnostic.logTiming = () => logUploadTiming(req);
    req.uploadDiagnostic.logCompleted = () => logUploadEvent(req,
      "parcel-image-upload-completed", "upload-complete", {
        category: "success", totalMs: safeDuration(performance.now() - req.uploadDiagnostic.startedAt),
      });
    req.uploadDiagnostic.logStage = (stage) => {
      if (!UPLOAD_CHECKPOINTS[stage]) return;
      const field = { IMAGE_PROCESSED: "sharpMs", SHEET_PREFLIGHT_COMPLETE: "sheetPreflightMs",
        DRIVE_UPLOAD_COMPLETE: "appsScriptMs", SHEET_UPDATE_COMPLETE: "sheetUpdateMs" }[stage];
      logUploadEvent(req, "parcel-image-upload-stage", UPLOAD_CHECKPOINTS[stage],
        field && req.uploadDiagnostic.timings[field] !== undefined
          ? { [field]: req.uploadDiagnostic.timings[field] } : {});
    };
    logUploadEvent(req, "parcel-image-upload-start", "request-received");
  }
  next();
});
router.use(requireLineAuth);
router.use((req, res, next) => {
  req.googleIntegration = googleIntegration;
  if (req.uploadDiagnostic) req.uploadDiagnostic.stage = "AUTH_VERIFIED";
  next();
});

router.post("/", parcelController.createParcel);
router.get("/mine", parcelController.listParcels);
router.get("/", parcelController.listParcels);
router.post("/:parcelId/analyze", parcelController.analyzeParcel);
router.post("/:parcelId/images", (req, res, next) => {
  parseImage(req, res, (error) => {
    if (!error) {
      req.uploadDiagnostic.stage = "MULTIPART_PARSED";
      return next();
    }
    const status = error.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    return next(createHttpError(status,
      status === 413 ? "รูปภาพมีขนาดใหญ่เกิน 12 MB" : "ข้อมูลรูปภาพไม่ถูกต้อง"));
  });
}, parcelController.uploadImage);
router.get("/:parcelId/images/:imageId/content", parcelController.getImageContent);
router.get("/:parcelId", parcelController.getParcel);
router.patch("/:parcelId", parcelController.updateParcel);
router.delete("/:parcelId", parcelController.deleteParcel);

router.use((error, req, res, next) => {
  if (!req.uploadDiagnostic || res.headersSent) return next(error);
  const details = uploadErrorDetails(error, req.uploadDiagnostic.stage);
  logUploadTiming(req, error);
  logGoogleFailure("parcel-image-upload-failed", error, {
    parcelId: req.params.parcelId, requestId: req.uploadDiagnostic.requestId,
    attempt: uploadAttempt(req),
  });
  const status = error.code === "PARCEL_IMAGE_CONFLICT" ? 409 :
    error.photoAmbiguous || error.photoRetryable ? 503 : error.statusCode || 500;
  return res.status(status).json({ success: false, error: details.message,
    stage: details.stage, code: details.code, requestId: req.uploadDiagnostic.requestId,
    ...(error.photoAmbiguous ? { ambiguous: true } : {}),
    ...(error.photoRetryable ? { retryable: true } : {}),
  });
});

return router;
}

module.exports = createParcelRoutes();
module.exports.createParcelRoutes = createParcelRoutes;
