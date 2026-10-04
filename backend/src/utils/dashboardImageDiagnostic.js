const { randomBytes } = require("node:crypto");
const { performance } = require("node:perf_hooks");
const SAFE_CATEGORIES = new Set(["oauth-config-missing", "oauth-refresh-failed", "oauth-invalid-grant",
  "oauth-http-401", "drive-file-not-found", "drive-permission-denied", "drive-http-401",
  "drive-rate-limited", "drive-timeout", "drive-network-error", "snapshot-not-found",
  "parcel-not-found", "photo-index-out-of-range", "invalid-sheet-photo-reference",
  "snapshot-photo-mismatch", "response-stream-error", "unknown-drive-read-error"]);
for (const category of ["service-account-auth-failed", "service-account-permission-denied",
  "drive-file-invalid", "drive-parent-mismatch", "drive-mime-invalid", "drive-read-timeout",
  "drive-stream-error", "drive-api-error"]) SAFE_CATEGORIES.add(category);
const APP_SCRIPT_CATEGORIES = Object.freeze({
  timeout: "apps-script-timeout",
  aborted: "apps-script-aborted",
  network: "apps-script-network-error",
  http: "apps-script-http-error",
  rejected: "apps-script-rejected",
  "invalid-json": "apps-script-invalid-json",
  "invalid-content": "apps-script-invalid-content",
});
for (const category of Object.values(APP_SCRIPT_CATEGORIES)) SAFE_CATEGORIES.add(category);

function providerStatus(error) {
  const value = Number(error?.response?.status ??
    (error?.googleStage === "apps-script-http" ? error?.statusCode : undefined));
  return Number.isInteger(value) && value >= 400 && value <= 599 ? value : null;
}

function categoryFor(error, stage, provider) {
  if (SAFE_CATEGORIES.has(error?.dashboardImageCategory)) return error.dashboardImageCategory;
  if (provider === "apps-script" &&
    (error?.googleStage === "apps-script-read" || error?.googleStage === "apps-script-http" ||
      error?.googleStage === "apps-script-invalid-response")) {
    return APP_SCRIPT_CATEGORIES[error?.bridgeCategory] || "unknown-drive-read-error";
  }
  if (provider === "oauth" && error?.googleStage === "drive-config") return "oauth-config-missing";
  const status = providerStatus(error);
  if (stage === "OAUTH_TOKEN_REQUEST_STARTED") {
    if (error?.response?.data?.error === "invalid_grant" || error?.code === "invalid_grant") {
      return "oauth-invalid-grant";
    }
    return status === 401 ? "oauth-http-401" : "oauth-refresh-failed";
  }
  if (stage === "DRIVE_READ_STARTED" || stage === "DRIVE_READ_HEADERS_RECEIVED") {
    if (status === 401) return "drive-http-401";
    if (status === 403) return "drive-permission-denied";
    if (status === 404) return "drive-file-not-found";
    if (status === 429) return "drive-rate-limited";
    if (error?.name === "AbortError" || error?.code === "ETIMEDOUT") return "drive-timeout";
    if (["ECONNRESET", "ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED"].includes(error?.code)) {
      return "drive-network-error";
    }
    return "unknown-drive-read-error";
  }
  if (stage === "RESPONSE_STREAM_STARTED" || stage === "DRIVE_READ_COMPLETE") return "response-stream-error";
  if (error?.statusCode === 409) return "snapshot-not-found";
  return "unknown-drive-read-error";
}

function createDashboardImageDiagnostic(logger = console) {
  const requestId = randomBytes(4).toString("hex").toUpperCase();
  const startedAt = performance.now();
  const context = { requestId };
  let stage = "REQUEST_RECEIVED";
  let lastSuccessfulStage = "REQUEST_RECEIVED";
  let providerFailure = null;
  let failed = false;
  const emit = (event, extra = {}) => {
    try {
      const method = event === "dashboard-image-failed" ? "warn" : "info";
      logger[method]?.(event, { ...context, stage, elapsedMs: Math.round(performance.now() - startedAt),
        ...extra });
    } catch { /* Diagnostic logging must not change the image response. */ }
  };
  emit("dashboard-image-start");
  return {
    requestId,
    get stage() { return stage; },
    context(values) { Object.assign(context, values); },
    mark(nextStage) {
      stage = nextStage;
      if (!nextStage.endsWith("_STARTED")) lastSuccessfulStage = nextStage;
      emit("dashboard-image-stage");
    },
    providerError(error) { providerFailure = { category: categoryFor(error, stage, context.provider),
      status: providerStatus(error) }; },
    fail(error, override) {
      if (failed) return;
      failed = true;
      const category = SAFE_CATEGORIES.has(override) ? override
        : providerFailure?.category || categoryFor(error, stage, context.provider);
      emit("dashboard-image-failed", { lastSuccessfulStage, category,
        ...(providerFailure?.status || providerStatus(error)
          ? { providerStatus: providerFailure?.status || providerStatus(error) } : {}) });
    },
    complete() {
      if (failed) return;
      stage = "RESPONSE_COMPLETE";
      emit("dashboard-image-complete", { lastSuccessfulStage });
    },
  };
}

module.exports = { createDashboardImageDiagnostic, categoryFor };
