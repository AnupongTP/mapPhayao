const { PARCEL_HEADERS, parseParcelImages } = require("../src/services/googleParcelIntegration");

const REQUIRED_ENV = [
  "GOOGLE_SERVICE_ACCOUNT_JSON",
  "GOOGLE_SHEETS_SPREADSHEET_ID",
  "GOOGLE_DRIVE_PARCEL_IMAGE_FOLDER_ID",
];
const SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets.readonly",
  "https://www.googleapis.com/auth/drive.readonly",
];

function category(error, step) {
  const status = Number(error?.response?.status ?? error?.status);
  if (step === "auth") return "AUTH_FAILURE";
  if (status === 403) return "PERMISSION_DENIED";
  if (status === 404) return "FILE_NOT_FOUND";
  if (step === "stream") return "STREAM_FAILURE";
  return "API_FAILURE";
}

function summary(provider, samples, failures) {
  const values = samples.map((sample) => sample.totalMs).sort((a, b) => a - b);
  const round = (value) => Math.round(value * 10) / 10;
  return { provider, samples: samples.length + failures.length, successes: samples.length,
    failures: failures.length, failureCategories: failures,
    minMs: values.length ? round(values[0]) : null,
    medianMs: values.length ? round((values[Math.floor((values.length - 1) / 2)] +
      values[Math.floor(values.length / 2)]) / 2) : null,
    meanMs: values.length ? round(values.reduce((sum, value) => sum + value, 0) / values.length) : null,
    maxMs: values.length ? round(values.at(-1)) : null,
    streamOpenMs: samples.map((sample) => sample.streamOpenMs ?? null),
    firstByteMs: samples.map((sample) => sample.firstByteMs ?? null),
    headersMs: samples.map((sample) => sample.headersMs ?? null),
    bytes: samples.map((sample) => sample.bytes) };
}

async function run({ env = process.env, google, log = console.log,
  now = () => performance.now(), benchmark = false, bridgeFactory, fetchImpl = fetch } = {}) {
  if (REQUIRED_ENV.some((name) => !String(env[name] || "").trim()) ||
    (benchmark && ["GOOGLE_DRIVE_APPS_SCRIPT_URL", "GOOGLE_DRIVE_APPS_SCRIPT_SECRET"]
      .some((name) => !String(env[name] || "").trim()))) {
    log("FAIL CONFIG_MISSING");
    return 1;
  }
  let credentials;
  try {
    credentials = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON);
  } catch {
    log("FAIL CONFIG_INVALID");
    return 1;
  }
  const started = now();
  let step = "auth";
  let stream;
  try {
    const api = google || require("googleapis").google;
    const auth = new api.auth.GoogleAuth({ credentials, scopes: SCOPES });
    const client = await auth.getClient();
    await client.getAccessToken();
    const authMs = now() - started;

    step = "sheet";
    const sheets = api.sheets({ version: "v4", auth });
    const sheetStarted = now();
    const rows = (await sheets.spreadsheets.values.get({
      spreadsheetId: env.GOOGLE_SHEETS_SPREADSHEET_ID, range: "parcels!A1:P",
    }))?.data?.values;
    if (!Array.isArray(rows) || !Array.isArray(rows[0]) ||
      rows[0].length !== PARCEL_HEADERS.length ||
      rows[0].some((header, index) => header !== PARCEL_HEADERS[index])) {
      log("FAIL SHEET_CONTRACT");
      return 1;
    }
    let image;
    for (const row of rows.slice(1)) {
      const images = parseParcelImages(row);
      if (images.length) { image = images[0]; break; }
    }
    if (!image) {
      log("FAIL NO_TRUSTED_IMAGE");
      return 1;
    }
    const sheetMs = now() - sheetStarted;

    const drive = api.drive({ version: "v3", auth });
    step = "metadata";
    const metadataStarted = now();
    const metadata = (await drive.files.get({
      fileId: image.fileId, fields: "id,mimeType,parents,trashed,size",
    }))?.data;
    if (metadata?.id !== image.fileId || metadata.trashed ||
      metadata.mimeType !== "image/webp" ||
      !Array.isArray(metadata.parents) ||
      !metadata.parents.includes(env.GOOGLE_DRIVE_PARCEL_IMAGE_FOLDER_ID)) {
      log("FAIL FILE_VALIDATION");
      return 1;
    }
    const metadataMs = now() - metadataStarted;

    step = "stream";
    const streamStarted = now();
    stream = (await drive.files.get(
      { fileId: image.fileId, alt: "media" }, { responseType: "stream" },
    ))?.data;
    if (!stream || typeof stream[Symbol.asyncIterator] !== "function") {
      log("FAIL STREAM_FAILURE");
      return 1;
    }
    const streamOpenMs = now() - streamStarted;
    let firstByteMs = null;
    let bytes = 0;
    for await (const chunk of stream) {
      if (firstByteMs === null) firstByteMs = now() - streamStarted;
      bytes += chunk.length;
      if (bytes > 12 * 1024 * 1024) {
        log("FAIL FILE_VALIDATION");
        return 1;
      }
    }
    if (!bytes) {
      log("FAIL STREAM_FAILURE");
      return 1;
    }
    log(JSON.stringify({ result: "SUCCESS", authMs, sheetMs, metadataMs,
      streamOpenMs, firstByteMs, fullReadMs: now() - streamStarted,
      totalMs: now() - started, bytes }));
    if (benchmark) {
      const directSamples = [{ totalMs: now() - streamStarted, streamOpenMs, firstByteMs, bytes }];
      const directFailures = [];
      for (let index = 1; index < 5; index += 1) {
        const readStarted = now();
        let nextStream;
        try {
          nextStream = (await drive.files.get(
            { fileId: image.fileId, alt: "media" }, { responseType: "stream" },
          ))?.data;
          const nextOpenMs = now() - readStarted;
          if (!nextStream || typeof nextStream[Symbol.asyncIterator] !== "function") {
            throw new Error("Invalid stream");
          }
          let nextFirstByteMs = null;
          let nextBytes = 0;
          for await (const chunk of nextStream) {
            if (nextFirstByteMs === null) nextFirstByteMs = now() - readStarted;
            nextBytes += chunk.length;
            if (nextBytes > 12 * 1024 * 1024) throw new Error("Image too large");
          }
          if (!nextBytes) throw new Error("Empty stream");
          directSamples.push({ totalMs: now() - readStarted, streamOpenMs: nextOpenMs,
            firstByteMs: nextFirstByteMs, bytes: nextBytes });
        } catch (error) {
          directFailures.push(category(error, "stream"));
        } finally {
          nextStream?.destroy?.();
        }
      }
      log(JSON.stringify(summary("SERVICE_ACCOUNT", directSamples, directFailures)));

      const makeBridge = bridgeFactory || require("../src/services/appsScriptDriveBridge").createAppsScriptDriveBridge;
      let currentHeadersMs = null;
      const bridge = makeBridge({ url: env.GOOGLE_DRIVE_APPS_SCRIPT_URL,
        secret: env.GOOGLE_DRIVE_APPS_SCRIPT_SECRET,
        fetchImpl: async (...args) => {
          const requestStarted = now();
          const response = await fetchImpl(...args);
          currentHeadersMs = now() - requestStarted;
          return response;
        } });
      const bridgeSamples = [];
      const bridgeFailures = [];
      for (let index = 0; index < 5; index += 1) {
        currentHeadersMs = null;
        const readStarted = now();
        let bridgeStream;
        try {
          bridgeStream = await bridge.getImage(image.fileId);
          const availableMs = now() - readStarted;
          let bridgeBytes = 0;
          for await (const chunk of bridgeStream) {
            bridgeBytes += chunk.length;
            if (bridgeBytes > 12 * 1024 * 1024) throw new Error("Image too large");
          }
          if (!bridgeBytes) throw new Error("Empty stream");
          bridgeSamples.push({ totalMs: now() - readStarted, streamOpenMs: availableMs,
            headersMs: currentHeadersMs, bytes: bridgeBytes });
        } catch (error) {
          bridgeFailures.push(error?.bridgeCategory === "timeout" ? "TIMEOUT" :
            error?.bridgeCategory === "network" ? "NETWORK" : "API_FAILURE");
        } finally {
          bridgeStream?.destroy?.();
        }
      }
      log(JSON.stringify(summary("APPS_SCRIPT", bridgeSamples, bridgeFailures)));
      if (directFailures.length || bridgeFailures.length) return 1;
    }
    return 0;
  } catch (error) {
    log(`FAIL ${category(error, step)}`);
    return 1;
  } finally {
    stream?.destroy?.();
  }
}

if (require.main === module) {
  run({ benchmark: process.argv.includes("--benchmark") })
    .then((exitCode) => { process.exitCode = exitCode; });
}

module.exports = { run };
