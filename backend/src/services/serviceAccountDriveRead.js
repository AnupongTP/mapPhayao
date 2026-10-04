const { PassThrough } = require("node:stream");
const createHttpError = require("../utils/httpError");
const { tagGoogleError } = require("../utils/googleError");

const DRIVE_READ_TIMEOUT_MS = 30000;
const FILE_ID = /^[a-zA-Z0-9_-]+$/;

function safeError(category, statusCode = 503) {
  const error = tagGoogleError(createHttpError(statusCode, "บริการอ่านรูปภาพแปลงขัดข้อง"), "drive-read");
  error.driveReadCategory = category;
  error.dashboardImageCategory = category;
  return error;
}

function providerFailure(error, stage) {
  const status = Number(error?.response?.status ?? error?.status);
  const code = error?.code;
  if (stage === "auth") return safeError("service-account-auth-failed");
  if (status === 403) return safeError("service-account-permission-denied");
  if (status === 404) return safeError("drive-file-not-found", 404);
  if (error?.name === "AbortError" || error?.name === "TimeoutError" ||
    ["ETIMEDOUT", "ESOCKETTIMEDOUT"].includes(code)) return safeError("drive-read-timeout");
  if (["ECONNRESET", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN"].includes(code)) {
    return safeError("drive-network-error");
  }
  return safeError("drive-api-error");
}

function createServiceAccountDriveRead({ google, credentials, folderId }) {
  if (!FILE_ID.test(folderId || "")) return null;
  const auth = new google.auth.GoogleAuth({
    credentials, scopes: ["https://www.googleapis.com/auth/drive.readonly"],
  });
  const drive = google.drive({ version: "v3", auth });

  return { async getImage(fileId, diagnostic) {
    if (!FILE_ID.test(fileId || "")) throw safeError("drive-file-invalid", 404);
    try {
      diagnostic?.mark("SERVICE_ACCOUNT_AUTH_STARTED");
      const client = await auth.getClient();
      await client.getAccessToken();
      diagnostic?.mark("SERVICE_ACCOUNT_AUTH_READY");
    } catch (error) {
      throw providerFailure(error, "auth");
    }

    let metadata;
    try {
      diagnostic?.mark("DRIVE_METADATA_STARTED");
      metadata = (await drive.files.get({ fileId,
        fields: "id,mimeType,parents,trashed,size" }, { timeout: DRIVE_READ_TIMEOUT_MS }))?.data;
    } catch (error) {
      throw providerFailure(error, "metadata");
    }
    if (metadata?.id !== fileId || metadata.trashed) throw safeError("drive-file-invalid", 404);
    if (metadata.mimeType !== "image/webp") throw safeError("drive-mime-invalid", 404);
    if (!Array.isArray(metadata.parents) || !metadata.parents.includes(folderId)) {
      throw safeError("drive-parent-mismatch", 404);
    }
    diagnostic?.mark("DRIVE_METADATA_VALIDATED");

    let source;
    try {
      diagnostic?.mark("DRIVE_READ_STARTED");
      source = (await drive.files.get({ fileId, alt: "media" },
        { responseType: "stream", timeout: DRIVE_READ_TIMEOUT_MS }))?.data;
    } catch (error) {
      throw providerFailure(error, "media");
    }
    if (!source || typeof source.pipe !== "function" || typeof source.destroy !== "function") {
      throw safeError("drive-stream-error");
    }
    diagnostic?.mark("DRIVE_READ_HEADERS_RECEIVED");
    const output = new PassThrough();
    source.once("error", () => output.destroy(safeError("drive-stream-error")));
    output.once("close", () => source.destroy());
    source.pipe(output);
    return output;
  } };
}

module.exports = { createServiceAccountDriveRead };
