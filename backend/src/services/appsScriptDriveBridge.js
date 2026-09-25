const { createHash, createHmac, randomBytes } = require("node:crypto");
const { Readable } = require("node:stream");
const { tagGoogleError } = require("../utils/googleError");

const REQUEST_TIMEOUT_MS = 30000;
const MAX_READ_BASE64_LENGTH = 16 * 1024 * 1024;
const FILE_ID = /^[A-Za-z0-9_-]+$/;

function bridgeError(stage, category, status) {
  const error = tagGoogleError(new Error("Google Drive bridge request failed"), stage);
  error.bridgeCategory = category;
  if (status) error.statusCode = status;
  return error;
}

function createAppsScriptDriveBridge({ url, secret, fetchImpl = fetch, now = Date.now,
  randomBytesImpl = randomBytes }) {
  let endpoint;
  try { endpoint = new URL(url); } catch { /* A missing or malformed URL is an unavailable provider. */ }
  if (!endpoint || endpoint.protocol !== "https:" || endpoint.hostname !== "script.google.com" ||
    !/^\/macros\/s\/[^/]+\/exec$/.test(endpoint.pathname) || endpoint.search || endpoint.hash ||
    endpoint.username || endpoint.password || !secret || typeof secret !== "string") {
    throw bridgeError("drive-config", "invalid-config");
  }

  async function request(op, { filename = "", mimeType = "", fileId = "", bytes } = {}) {
    const contentBase64 = op === "upload" ? bytes.toString("base64") : undefined;
    const payload = {
      v: "1", op, ts: Math.floor(now() / 1000), nonce: randomBytesImpl(18).toString("base64url"),
      filename, mimeType, fileId,
      contentSha256: contentBase64 === undefined ? "" :
        createHash("sha256").update(contentBase64, "utf8").digest("hex"),
    };
    const canonical = ["1", op || "", String(payload.ts || ""), payload.nonce || "",
      filename || "", mimeType || "", fileId || "", payload.contentSha256 || ""].join("\n");
    payload.signature = createHmac("sha256", secret).update(canonical, "utf8").digest("base64url");
    if (contentBase64 !== undefined) payload.contentBase64 = contentBase64;

    let response;
    try {
      response = await fetchImpl(endpoint.href, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw bridgeError(`apps-script-${op}`, error?.name === "TimeoutError" ? "timeout" : "network");
    }
    if (!response.ok) throw bridgeError("apps-script-http", "http", response.status);
    let data;
    try { data = await response.json(); } catch {
      throw bridgeError("apps-script-invalid-response", "invalid-json");
    }
    if (!data || data.success !== true) {
      throw bridgeError(`apps-script-${op}`, "rejected");
    }
    return data;
  }

  return {
    async uploadImage(bytes, filename) {
      const data = await request("upload", { filename, mimeType: "image/webp", bytes });
      if (typeof data.fileId !== "string" || !FILE_ID.test(data.fileId)) {
        throw bridgeError("apps-script-invalid-response", "invalid-file-id");
      }
      return data.fileId;
    },
    async getImage(fileId) {
      const data = await request("read", { fileId });
      const encoded = data.contentBase64;
      if (typeof encoded !== "string" || !encoded.length || encoded.length > MAX_READ_BASE64_LENGTH ||
        encoded.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
        throw bridgeError("apps-script-invalid-response", "invalid-content");
      }
      const bytes = Buffer.from(encoded, "base64");
      if (bytes.toString("base64") !== encoded) {
        throw bridgeError("apps-script-invalid-response", "invalid-content");
      }
      return Readable.from(bytes);
    },
    async deleteImage(fileId) { await request("delete", { fileId }); },
  };
}

module.exports = { createAppsScriptDriveBridge };
