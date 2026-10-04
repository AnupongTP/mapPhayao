const { pipeline } = require("node:stream/promises");
const { createDashboardImageDiagnostic } = require("../utils/dashboardImageDiagnostic");

function parseFilters(query) {
  const days = query.days === undefined ? 7 : Number(query.days);
  if (![7, 14, 30].includes(days) || (query.days !== undefined && !["7", "14", "30"].includes(query.days))) {
    throw new Error("Invalid days filter");
  }
  const tambon = query.tambon === undefined ? null : query.tambon;
  const crop = query.crop === undefined ? null : query.crop;
  if (tambon !== null && (typeof tambon !== "string" || !/^[A-Za-z0-9_-]{1,40}$/.test(tambon))) {
    throw new Error("Invalid tambon filter");
  }
  if (crop !== null && (typeof crop !== "string" || !crop.trim() || crop.length > 100 || /[\x00-\x1f\x7f]/.test(crop))) {
    throw new Error("Invalid crop filter");
  }
  return { tambon, crop, days };
}

function parseBbox(value) {
  if (typeof value !== "string") throw new Error("Invalid bbox");
  const parts = value.split(",");
  if (parts.length !== 4 || parts.some((part) => !part.trim() || !Number.isFinite(Number(part)))) {
    throw new Error("Invalid bbox");
  }
  const bbox = parts.map(Number);
  const [west, south, east, north] = bbox;
  if (west < -180 || east > 180 || south < -90 || north > 90 || west >= east || south >= north ||
    east - west > 1 || north - south > 1) throw new Error("Invalid bbox");
  return bbox;
}

function parseSnapshotVersion(value) {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^[1-9]\d{0,12}$/.test(value)) throw new Error("Invalid snapshot version");
  return value;
}

function parseParcelCode(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(value)) throw new Error("Invalid parcel code");
  return value;
}

function parsePhotoIndex(value) {
  if (typeof value !== "string" || !/^(0|[1-9]\d*)$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new Error("Invalid photo index");
  }
  return Number(value);
}

function handleError(error, res, requestId) {
  const status = [404, 409, 413].includes(error.statusCode) ? error.statusCode
    : error.message?.startsWith("Invalid ") ? 400 : 503;
  res.status(status).json({ success: false, error: status === 413
    ? "กรุณาซูมเข้าเพื่อดูขอบเขตแปลง"
    : status === 400 ? "ตัวกรองหรือขอบเขตแผนที่ไม่ถูกต้อง"
      : status === 404 ? "ไม่พบรูปภาพแปลง" : status === 409 ? "ข้อมูลแผนที่เปลี่ยนแปลง กรุณารีเฟรช"
        : "ไม่สามารถโหลดข้อมูลแดชบอร์ดได้", ...(requestId ? { requestId } : {}) });
}

function createDashboardController(service, logger) {
  async function summary(req, res) {
    try {
      res.json({ success: true, ...await service.getSummary({ ...parseFilters(req.query),
        snapshotVersion: parseSnapshotVersion(req.query.snapshot) }) });
    } catch (error) { handleError(error, res); }
  }

  async function points(req, res) {
    try {
      res.json({ success: true, ...await service.getPoints({ ...parseFilters(req.query),
        snapshotVersion: parseSnapshotVersion(req.query.snapshot) }) });
    } catch (error) { handleError(error, res); }
  }

  async function geometries(req, res) {
    try {
      const bbox = parseBbox(req.query.bbox);
      const parcelCode = req.query.parcel === undefined ? undefined : parseParcelCode(req.query.parcel);
      res.json({ success: true, ...await service.getGeometries({ ...parseFilters(req.query), bbox, parcelCode,
        snapshotVersion: parseSnapshotVersion(req.query.snapshot) }) });
    } catch (error) { handleError(error, res); }
  }

  async function sendImage(req, res, rawIndex) {
    const diagnostic = createDashboardImageDiagnostic(logger);
    let streaming = false;
    let streamEnded = false;
    res.once("finish", () => {
      if (streaming && streamEnded) diagnostic.complete();
    });
    res.once("close", () => {
      if (streaming && !res.writableFinished) diagnostic.fail(null, "response-stream-error");
    });
    try {
      const parcelCode = parseParcelCode(req.params.parcelCode);
      const version = parseSnapshotVersion(req.query.snapshot);
      const index = rawIndex === null ? parsePhotoIndex(req.params.index) : rawIndex;
      diagnostic.context({ photoIndex: index, ...(version ? { snapshotId: version } : {}) });
      const stream = await service.getImage(parcelCode, index, version, diagnostic);
      res.set({ "Content-Type": "image/webp", "Cache-Control": "public, max-age=60",
        "X-Content-Type-Options": "nosniff" });
      stream.once("end", () => { streamEnded = true; diagnostic.mark("DRIVE_READ_COMPLETE"); });
      stream.once("error", (error) => diagnostic.providerError(error));
      diagnostic.mark("RESPONSE_STREAM_STARTED");
      streaming = true;
      await pipeline(stream, res);
    } catch (error) {
      diagnostic.fail(error);
      if (res.headersSent) res.destroy();
      else handleError(error, res, diagnostic.requestId);
    }
  }

  const firstImage = (req, res) => sendImage(req, res, 0);
  const indexedImage = (req, res) => sendImage(req, res, null);

  return { summary, points, geometries, firstImage, indexedImage };
}

module.exports = { createDashboardController, _private: { parseFilters, parseBbox, parseSnapshotVersion, parsePhotoIndex } };
