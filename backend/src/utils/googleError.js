const SAFE_CODES = new Set([
  "SHEET_HEADER_MISMATCH", "PERMISSION_DENIED", "UNAUTHENTICATED",
  "NOT_FOUND", "RESOURCE_EXHAUSTED", "INVALID_ARGUMENT", "FAILED_PRECONDITION",
  "invalid_grant", "insufficientPermissions", "storageQuotaExceeded",
  "insufficientFilePermissions", "rateLimitExceeded", "userRateLimitExceeded",
  "notFound", "forbidden",
  "PARCEL_IMAGE_CONFLICT",
]);
const SAFE_STAGES = new Set([
  "sheets-read", "sheets-header-check", "sheets-upsert-user", "sheets-upsert-parcel",
  "sheets-append-image", "sheets-delete-parcel", "drive-config", "drive-upload",
  "drive-read", "drive-delete", "drive-delete-cleanup",
  "apps-script-upload", "apps-script-read", "apps-script-delete",
  "apps-script-http", "apps-script-invalid-response",
]);
const SAFE_BRIDGE_CATEGORIES = new Set([
  "invalid-config", "timeout", "network", "http", "invalid-json", "rejected",
  "invalid-file-id", "invalid-content",
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function tagGoogleError(error, stage) {
  const tagged = error && typeof error === "object" ? error : new Error("Google API request failed");
  if (!tagged.googleStage) tagged.googleStage = stage;
  return tagged;
}

async function atGoogleStage(stage, action) {
  try { return await action(); } catch (error) { throw tagGoogleError(error, stage); }
}

function safeCode(value) {
  return typeof value === "string" && SAFE_CODES.has(value) ? value : undefined;
}

function googleErrorDetails(error) {
  const status = Number(error?.response?.status ?? error?.statusCode ?? error?.status ?? error?.code);
  const apiError = error?.response?.data?.error;
  return {
    stage: SAFE_STAGES.has(error?.googleStage) ? error.googleStage : "google",
    ...(Number.isInteger(status) && status >= 400 && status <= 599 ? { status } : {}),
    ...(safeCode(apiError?.status ?? error?.code) ? { code: safeCode(apiError?.status ?? error?.code) } : {}),
    ...(error?.code === "SHEET_HEADER_MISMATCH" ? { reason: "sheet-header-mismatch" } :
      safeCode(apiError?.errors?.[0]?.reason) ? { reason: safeCode(apiError.errors[0].reason) } : {}),
    ...(SAFE_BRIDGE_CATEGORIES.has(error?.bridgeCategory) ? { category: error.bridgeCategory } : {}),
    message: error?.googleStage === "drive-config"
      ? "Google Drive provider configuration is incomplete"
      : error?.code === "SHEET_HEADER_MISMATCH"
        ? "Google parcels sheet headers do not match"
        : "Google API request failed",
  };
}

function logGoogleFailure(event, error, context = {}) {
  console.error(event, {
    ...(["user", "parcel"].includes(context.entity) ? { entity: context.entity } : {}),
    ...(["create", "update", "delete"].includes(context.operation) ? { operation: context.operation } : {}),
    ...(UUID.test(context.parcelId || "") ? { parcelId: context.parcelId } : {}),
    ...(Number.isInteger(context.attempt) && context.attempt >= 0 && context.attempt <= 3
      ? { attempt: context.attempt } : {}),
    ...(/^[A-F0-9]{8}$/.test(context.requestId || "") ? { requestId: context.requestId } : {}),
    ...googleErrorDetails(error),
  });
}

function uploadErrorDetails(error, currentStage) {
  const googleStage = error?.googleStage;
  const category = error?.bridgeCategory;
  if (error?.code === "PARCEL_IMAGE_CONFLICT") {
    return { stage: "SHEET_UPDATE", code: "IMAGE_CONFLICT", message: "ข้อมูลรูปภาพแปลงขัดแย้งกัน" };
  }
  if (googleStage === "drive-config") {
    return { stage: "DRIVE_UPLOAD", code: "DRIVE_NOT_CONFIGURED", message: "บริการจัดเก็บรูปภาพยังไม่พร้อมใช้งาน" };
  }
  if (googleStage === "apps-script-upload") {
    const code = category === "timeout" ? "APPS_SCRIPT_TIMEOUT" :
      category === "network" ? "APPS_SCRIPT_NETWORK_ERROR" : "APPS_SCRIPT_REJECTED";
    return { stage: "DRIVE_UPLOAD", code, message: category === "timeout"
      ? "บริการจัดเก็บรูปภาพไม่ตอบกลับภายในเวลาที่กำหนด" : "บริการจัดเก็บรูปภาพขัดข้อง" };
  }
  if (googleStage === "apps-script-http" || googleStage === "apps-script-invalid-response" ||
    googleStage === "drive-upload") {
    return { stage: "DRIVE_UPLOAD", code: googleStage === "apps-script-http" ? "APPS_SCRIPT_HTTP_ERROR" :
      googleStage === "apps-script-invalid-response" ? "APPS_SCRIPT_INVALID_RESPONSE" : "DRIVE_UPLOAD_ERROR",
    message: "บริการจัดเก็บรูปภาพขัดข้อง" };
  }
  if (["sheets-read", "sheets-header-check", "sheets-append-image"].includes(googleStage)) {
    return { stage: googleStage === "sheets-append-image" ? "SHEET_UPDATE" : "SHEET_CHECK",
      code: error.code === "SHEET_HEADER_MISMATCH" ? "SHEET_HEADER_MISMATCH" :
        googleStage === "sheets-append-image" ? "SHEET_UPDATE_ERROR" : "SHEET_READ_ERROR",
      message: "บริการข้อมูลรูปภาพขัดข้อง" };
  }
  const stage = ["REQUEST_RECEIVED", "AUTH_VERIFIED", "MULTIPART_PARSED", "PARCEL_LOOKUP",
    "PARCEL_VERIFIED", "IMAGE_VALIDATION", "IMAGE_PROCESSED", "SHEET_CHECK", "DRIVE_UPLOAD",
    "SHEET_UPDATE"].includes(currentStage) ? currentStage : "REQUEST_RECEIVED";
  const status = error?.statusCode;
  return { stage, code: status === 401 ? "AUTH_REQUIRED" : status === 404 ? "PARCEL_NOT_FOUND" :
    status === 413 ? "IMAGE_TOO_LARGE" : status === 415 ? "IMAGE_UNSUPPORTED" :
      status === 400 ? "INVALID_UPLOAD" : "UPLOAD_FAILED",
  message: status === 401 ? "กรุณาเปิดระบบผ่าน LINE ใหม่อีกครั้ง" :
    status === 404 ? "ไม่พบแปลงนี้หรือไม่มีสิทธิ์เข้าถึง" :
      status === 413 ? "รูปภาพมีขนาดใหญ่เกิน 12 MB" :
        status === 415 ? "ไม่รองรับไฟล์รูปภาพนี้" :
          status === 400 ? "ข้อมูลรูปภาพไม่ถูกต้อง" : "ไม่สามารถอัปโหลดรูปภาพได้" };
}

module.exports = { tagGoogleError, atGoogleStage, googleErrorDetails, logGoogleFailure, uploadErrorDetails };
