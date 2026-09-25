// Route ของแปลงเกษตร แยกไว้เพื่อไม่ปะปนกับ point-analysis API
const express = require("express");
const parcelController = require("../controllers/parcelController");
const { createLineAuthMiddleware } = require("../middleware/lineAuthMiddleware");
const { createGoogleParcelIntegration } = require("../services/googleParcelIntegration");
const { MAX_RAW_BYTES } = require("../services/parcelImageService");
const multer = require("multer");
const { randomBytes } = require("node:crypto");
const createHttpError = require("../utils/httpError");
const { uploadErrorDetails, logGoogleFailure } = require("../utils/googleError");

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
    req.uploadDiagnostic = { requestId: randomBytes(4).toString("hex").toUpperCase(), stage: "REQUEST_RECEIVED" };
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
  const attempt = Number(req.get("X-Photo-Attempt"));
  logGoogleFailure("parcel-image-upload-failed", error, {
    parcelId: req.params.parcelId, requestId: req.uploadDiagnostic.requestId,
    attempt: Number.isInteger(attempt) && attempt >= 0 && attempt <= 3 ? attempt : 0,
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
