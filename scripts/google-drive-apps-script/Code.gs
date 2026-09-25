// Deploy as a Web App that executes as the Drive folder owner.
// Set BRIDGE_SECRET and FOLDER_ID in Script Properties, never in source.
var MAX_CLOCK_SKEW_SECONDS = 300;
var MAX_BASE64_LENGTH = 16 * 1024 * 1024;

function reply_(body) {
  return ContentService.createTextOutput(JSON.stringify(body))
    .setMimeType(ContentService.MimeType.JSON);
}

function hex_(bytes) {
  return bytes.map(function (byte) {
    return (byte & 255).toString(16).padStart(2, "0");
  }).join("");
}

function equal_(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  var mismatch = left.length ^ right.length;
  for (var i = 0; i < Math.max(left.length, right.length); i++) {
    mismatch |= (left.charCodeAt(i) || 0) ^ (right.charCodeAt(i) || 0);
  }
  return mismatch === 0;
}

function ownedFile_(fileId, folderId) {
  if (typeof fileId !== "string" || !/^[A-Za-z0-9_-]+$/.test(fileId)) {
    throw new Error("invalid-file");
  }
  var file = DriveApp.getFileById(fileId);
  if (file.isTrashed()) throw new Error("invalid-file");
  var parents = file.getParents();
  while (parents.hasNext()) {
    if (parents.next().getId() === folderId) return file;
  }
  throw new Error("invalid-file");
}

function fetchWeather_(body) {
  if (typeof body.latitude !== "string" || typeof body.longitude !== "string" ||
    !/^-?\d{1,3}\.\d{6}$/.test(body.latitude) ||
    !/^-?\d{1,3}\.\d{6}$/.test(body.longitude) ||
    Math.abs(Number(body.latitude)) > 90 || Math.abs(Number(body.longitude)) > 180 ||
    body.filename !== undefined || body.mimeType !== undefined ||
    body.fileId !== undefined || body.contentSha256 !== undefined ||
    body.contentBase64 !== undefined) {
    return reply_({ success: false, error: "invalid-request" });
  }
  var url = "https://api.open-meteo.com/v1/forecast?latitude=" + encodeURIComponent(body.latitude) +
    "&longitude=" + encodeURIComponent(body.longitude) +
    "&current=temperature_2m&hourly=precipitation_probability" +
    "&timezone=Asia%2FBangkok&forecast_hours=3&temperature_unit=celsius";
  var response = UrlFetchApp.fetch(url, {
    method: "get", headers: { Accept: "application/json" }, muteHttpExceptions: true,
  });
  var status = response.getResponseCode();
  var headers = response.getHeaders();
  var retryAfter = null;
  Object.keys(headers).forEach(function (name) {
    if (name.toLowerCase() === "retry-after") retryAfter = String(headers[name]).slice(0, 100);
  });
  if (status < 200 || status >= 300) {
    return reply_({ success: true, providerStatus: status, body: null, retryAfter: retryAfter });
  }
  try {
    return reply_({ success: true, providerStatus: status,
      body: JSON.parse(response.getContentText()), retryAfter: null });
  } catch (error) {
    return reply_({ success: true, providerStatus: status,
      body: null, invalidJson: true, retryAfter: null });
  }
}

function doPost(e) {
  try {
    var props = PropertiesService.getScriptProperties();
    var secret = props.getProperty("BRIDGE_SECRET");
    var folderId = props.getProperty("FOLDER_ID");
    if (!secret) return reply_({ success: false, error: "config" });
    var body = JSON.parse(e.postData.contents);
    if (!body || body.v !== "1" || ["upload", "read", "delete", "weather"].indexOf(body.op) < 0 ||
      !Number.isInteger(body.ts) || Math.abs(Math.floor(Date.now() / 1000) - body.ts) > MAX_CLOCK_SKEW_SECONDS ||
      typeof body.nonce !== "string" || !/^[A-Za-z0-9_-]{24}$/.test(body.nonce)) {
      return reply_({ success: false, error: "invalid-request" });
    }
    var canonical = body.op === "weather"
      ? ["1", "weather", String(body.ts || ""), body.nonce || "",
        body.latitude || "", body.longitude || ""].join("\n")
      : ["1", body.op || "", String(body.ts || ""), body.nonce || "",
        body.filename || "", body.mimeType || "", body.fileId || "",
        body.contentSha256 || ""].join("\n");
    var expected = Utilities.base64EncodeWebSafe(
      Utilities.computeHmacSha256Signature(canonical, secret)).replace(/=+$/, "");
    if (typeof body.signature !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(body.signature) ||
      !equal_(body.signature, expected)) {
      return reply_({ success: false, error: "invalid-signature" });
    }
    var lock = LockService.getScriptLock();
    lock.waitLock(5000);
    try {
      var cache = CacheService.getScriptCache();
      var nonceKey = "nonce:" + body.nonce;
      if (cache.get(nonceKey)) return reply_({ success: false, error: "replay" });
      cache.put(nonceKey, "1", 360);
    } finally {
      lock.releaseLock();
    }

    if (body.op === "weather") return fetchWeather_(body);
    if (!folderId) return reply_({ success: false, error: "config" });
    if (body.op === "upload") {
      if (typeof body.filename !== "string" || !/^[A-Za-z0-9_-]+\.webp$/.test(body.filename) ||
        body.mimeType !== "image/webp" || body.fileId !== "" ||
        typeof body.contentBase64 !== "string" || !body.contentBase64.length ||
        body.contentBase64.length > MAX_BASE64_LENGTH ||
        typeof body.contentSha256 !== "string" || !/^[a-f0-9]{64}$/.test(body.contentSha256)) {
        return reply_({ success: false, error: "invalid-request" });
      }
      var actualHash = hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,
        body.contentBase64, Utilities.Charset.UTF_8));
      if (!equal_(actualHash, body.contentSha256)) {
        return reply_({ success: false, error: "invalid-content" });
      }
      var bytes = Utilities.base64Decode(body.contentBase64);
      var blob = Utilities.newBlob(bytes, "image/webp", body.filename);
      var created = DriveApp.getFolderById(folderId).createFile(blob);
      return reply_({ success: true, fileId: created.getId() });
    }
    if (body.filename !== "" || body.mimeType !== "" || body.contentSha256 !== "" ||
      body.contentBase64 !== undefined) {
      return reply_({ success: false, error: "invalid-request" });
    }
    var file = ownedFile_(body.fileId, folderId);
    if (body.op === "read") {
      if (file.getMimeType() !== "image/webp") return reply_({ success: false, error: "invalid-file" });
      return reply_({ success: true, contentBase64: Utilities.base64Encode(file.getBlob().getBytes()) });
    }
    file.setTrashed(true);
    return reply_({ success: true });
  } catch (error) {
    return reply_({ success: false, error: "operation-failed" });
  }
}
