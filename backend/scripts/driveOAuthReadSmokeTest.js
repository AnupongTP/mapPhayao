const REQUIRED_ENV = [
  "GOOGLE_DRIVE_OAUTH_CLIENT_ID",
  "GOOGLE_DRIVE_OAUTH_CLIENT_SECRET",
  "GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN",
  "GOOGLE_DRIVE_PARCEL_IMAGE_FOLDER_ID",
];

function classify(error, step) {
  const code = error?.code;
  const status = Number(error?.response?.status ?? error?.status);
  const reason = error?.response?.data?.error?.errors?.[0]?.reason ?? error?.errors?.[0]?.reason;
  if (code === "invalid_grant" || error?.response?.data?.error === "invalid_grant") return "invalid_grant";
  if (reason === "accessNotConfigured" || reason === "apiDisabled") return "api_disabled";
  if (status === 403) return "permission_denied";
  if (status === 404 && step === "folder") return "folder_not_found";
  if (["ENOTFOUND", "ECONNRESET", "ETIMEDOUT", "EAI_AGAIN", "ECONNREFUSED"].includes(code)) return "network";
  if (step === "oauth" && status === 400) return "invalid_grant";
  return "unknown";
}

async function run({ env = process.env, google, log = console.log } = {}) {
  if (REQUIRED_ENV.some((name) => !String(env[name] || "").trim())) {
    log("FAIL oauth_config");
    return 1;
  }
  const folderId = env.GOOGLE_DRIVE_PARCEL_IMAGE_FOLDER_ID;
  if (!/^[A-Za-z0-9_-]+$/.test(folderId)) {
    log("FAIL oauth_config");
    return 1;
  }

  let step = "oauth";
  try {
    const api = google || require("googleapis").google;
    const auth = new api.auth.OAuth2(
      env.GOOGLE_DRIVE_OAUTH_CLIENT_ID, env.GOOGLE_DRIVE_OAUTH_CLIENT_SECRET,
    );
    auth.setCredentials({ refresh_token: env.GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN });
    const token = await auth.getAccessToken();
    if (!token?.token) throw new Error("OAuth refresh returned no token");
    log("PASS OAuth authentication");

    step = "api";
    const drive = api.drive({ version: "v3", auth });
    await drive.about.get({ fields: "kind" });
    log("PASS Drive API");

    step = "folder";
    const folder = await drive.files.get({ fileId: folderId, fields: "id,name,mimeType" });
    if (folder?.data?.mimeType !== "application/vnd.google-apps.folder") {
      log("FAIL folder_not_found");
      return 1;
    }
    log("PASS folder access");

    step = "list";
    const listed = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      pageSize: 5,
      fields: "files(id,name,mimeType,size)",
    });
    const image = listed?.data?.files?.find((file) =>
      typeof file.id === "string" &&
      (file.mimeType === "image/webp" || /\.webp$/i.test(file.name || "")));
    if (!image) {
      log("FAIL no_image");
      return 1;
    }
    log("PASS image found");

    step = "metadata";
    const metadata = await drive.files.get({ fileId: image.id, fields: "id,name,mimeType,size" });
    if (metadata?.data?.id !== image.id) throw new Error("Image metadata mismatch");
    log("PASS metadata read");

    step = "stream";
    const response = await drive.files.get(
      { fileId: image.id, alt: "media" }, { responseType: "stream" },
    );
    const stream = response?.data;
    if (!stream || typeof stream[Symbol.asyncIterator] !== "function") {
      throw new Error("Image stream unavailable");
    }
    let bytesRead = 0;
    try {
      for await (const chunk of stream) {
        bytesRead += chunk.length;
        break;
      }
    } finally {
      stream.destroy?.();
    }
    if (bytesRead === 0) throw new Error("Empty image stream");
    log(`PASS binary stream read (bytesRead: ${bytesRead})`);
    return 0;
  } catch (error) {
    log(`FAIL ${classify(error, step)}`);
    return 1;
  }
}

if (require.main === module) {
  run().then((exitCode) => { process.exitCode = exitCode; });
}

module.exports = { run };
