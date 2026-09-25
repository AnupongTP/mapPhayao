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
    ...googleErrorDetails(error),
  });
}

module.exports = { tagGoogleError, atGoogleStage, googleErrorDetails, logGoogleFailure };
