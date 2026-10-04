const db = require("../config/database");
const { parseParcelImages } = require("./googleParcelIntegration");

// Public Dashboard requests share one read-only Sheet snapshot for 60 seconds.
const SNAPSHOT_TTL_MS = 60_000;
const FAILURE_RETRY_MS = 10_000;
const GEOMETRY_LIMIT = 500;
const UNCLASSIFIED_CODE = "__unclassified__";
const UNCLASSIFIED_NAME = "ไม่ทราบตำบล";
const dayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit",
});
const bangkokDay = (date) => {
  const parts = Object.fromEntries(dayFormatter.formatToParts(date)
    .map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
};

function sheetDate(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const local = value.trim().match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})$/);
  const date = new Date(local ? `${local[1]}T${local[2]}+07:00` : value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function coordinate(value) {
  if (typeof value !== "string") return null;
  const match = value.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (!match) return null;
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 ? { lat, lng } : null;
}

function sheetGeometry(value) {
  let shape;
  try { shape = typeof value === "string" ? JSON.parse(value) : value; } catch { return null; }
  if (shape?.type !== "MultiPolygon" || !Array.isArray(shape.coordinates) || !shape.coordinates.length) return null;
  const bounds = [Infinity, Infinity, -Infinity, -Infinity];
  let vertices = 0;
  for (const polygon of shape.coordinates) {
    if (!Array.isArray(polygon) || !polygon.length) return null;
    for (const ring of polygon) {
      if (!Array.isArray(ring) || ring.length < 4) return null;
      for (const point of ring) {
        if (!Array.isArray(point) || point.length !== 2 ||
          !point.every((part) => typeof part === "number" && Number.isFinite(part)) ||
          point[0] < -180 || point[0] > 180 || point[1] < -90 || point[1] > 90 || ++vertices > 100_000) return null;
        bounds[0] = Math.min(bounds[0], point[0]);
        bounds[1] = Math.min(bounds[1], point[1]);
        bounds[2] = Math.max(bounds[2], point[0]);
        bounds[3] = Math.max(bounds[3], point[1]);
      }
      if (ring[0][0] !== ring.at(-1)[0] || ring[0][1] !== ring.at(-1)[1]) return null;
    }
  }
  return { shape, bounds };
}

function normalizeRow(row) {
  if (!Array.isArray(row)) return null;
  const parcelCode = String(row[2] || "").trim();
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(parcelCode)) return null;
  let images = [];
  try {
    const parsed = parseParcelImages(row);
    if (parsed.length <= 5) images = parsed;
  } catch { /* A malformed photo pair must not hide otherwise valid parcel data. */ }
  const areaM2 = Number(row[9]);
  const areaRai = Number(row[10]);
  return {
    parcelCode, parcelName: String(row[3] || "").trim(),
    crop: String(row[4] || "").trim() || "ไม่ระบุ",
    variety: String(row[5] || "").trim(),
    plantingDate: /^\d{4}-\d{2}-\d{2}$/.test(row[6] || "") ? row[6] : null,
    point: coordinate(row[7]), geometry: sheetGeometry(row[8]),
    areaM2: Number.isFinite(areaM2) && areaM2 >= 0 ? areaM2 : 0,
    areaRai: Number.isFinite(areaRai) && areaRai >= 0 ? areaRai : 0,
    images, createdAt: sheetDate(row[14]), updatedAt: sheetDate(row[15]),
    tambonCode: UNCLASSIFIED_CODE, tambonName: UNCLASSIFIED_NAME,
  };
}

async function classifyTambons(rows, database) {
  const located = rows.filter((row) => row.point);
  if (!located.length) return;
  try {
    const result = await database.query(`
      WITH points AS (
        SELECT * FROM unnest($1::text[], $2::double precision[], $3::double precision[])
          AS p(parcel_code, lat, lng)
      )
      SELECT points.parcel_code, boundary.sdist_code, boundary.tambon
      FROM points LEFT JOIN LATERAL (
        SELECT t.sdist_code, t.tambon FROM gis.tambon t
        WHERE ST_Covers(t.geom, ST_Transform(ST_SetSRID(ST_MakePoint(points.lng, points.lat), 4326), 32647))
        ORDER BY t.sdist_code, t.id LIMIT 1
      ) boundary ON true`, [located.map((row) => row.parcelCode),
      located.map((row) => row.point.lat), located.map((row) => row.point.lng)]);
    const byCode = new Map(result.rows.map((row) => [row.parcel_code, row]));
    for (const row of located) {
      const match = byCode.get(row.parcelCode);
      if (match?.sdist_code && match?.tambon) {
        row.tambonCode = match.sdist_code;
        row.tambonName = match.tambon;
      }
    }
  } catch {
    console.warn("dashboard-tambon-classification-unavailable");
  }
}

function publicParcel(row) {
  return {
    parcelId: row.parcelCode, parcelCode: row.parcelCode, parcelName: row.parcelName,
    crop: row.crop, variety: row.variety, plantingDate: row.plantingDate,
    areaRai: row.areaRai, tambonCode: row.tambonCode, tambonName: row.tambonName,
    lat: row.point?.lat ?? null, lng: row.point?.lng ?? null, photoCount: row.images.length,
  };
}

function createDashboardSheetService({ google, database = db, now = () => Date.now() }) {
  let current = null;
  let previous = null;
  let inFlight = null;
  let nextRetryAt = 0;
  let generation = 0;

  async function snapshot(requestedVersion) {
    if (requestedVersion && current?.version === requestedVersion) return current;
    if (requestedVersion && previous?.version === requestedVersion) return previous;
    if (requestedVersion) throw Object.assign(new Error("Dashboard snapshot expired"), { statusCode: 409 });
    if (current && (now() - current.loadedAt < SNAPSHOT_TTL_MS || now() < nextRetryAt)) return current;
    if (now() < nextRetryAt) throw new Error("Dashboard snapshot unavailable");
    if (!inFlight) {
      inFlight = (async () => {
        if (!google?.enabled || typeof google.readDashboardRows !== "function") {
          throw new Error("Dashboard Sheet source unavailable");
        }
        const source = await google.readDashboardRows();
        if (!Array.isArray(source)) throw new Error("Invalid Dashboard Sheet rows");
        const seen = new Set();
        const rows = source.map(normalizeRow).filter((row) => {
          if (!row || seen.has(row.parcelCode)) return false;
          seen.add(row.parcelCode);
          return true;
        });
        await classifyTambons(rows, database);
        previous = current;
        current = { rows, loadedAt: now(), version: String(++generation), stale: false };
        nextRetryAt = 0;
        return current;
      })().catch(() => {
        console.warn("dashboard-sheet-snapshot-unavailable", { stage: "sheet-read" });
        nextRetryAt = now() + FAILURE_RETRY_MS;
        if (!current) throw new Error("Dashboard snapshot unavailable");
        current.stale = true;
        return current;
      }).finally(() => { inFlight = null; });
    }
    return inFlight;
  }

  function filtered(rows, { tambon, crop }) {
    return rows.filter((row) => (!tambon || row.tambonCode === tambon) && (!crop || row.crop === crop));
  }

  async function getSummary({ tambon, crop, days, snapshotVersion, today = new Date(now()) }) {
    const view = await snapshot(snapshotVersion);
    const rows = filtered(view.rows, { tambon, crop });
    const start = new Date(`${bangkokDay(today)}T12:00:00+07:00`);
    const dates = Array.from({ length: days }, (_, index) =>
      bangkokDay(new Date(start.getTime() - (days - index - 1) * 86_400_000)));
    const daily = dates.map((date) => {
      const counts = new Map();
      for (const row of rows) {
        if (row.createdAt && bangkokDay(row.createdAt) === date) {
          counts.set(row.crop, (counts.get(row.crop) || 0) + 1);
        }
      }
      const crops = [...counts].map(([name, count]) => ({ name, count }));
      return { date, count: crops.reduce((total, item) => total + item.count, 0), crops };
    });
    const todayCount = daily.at(-1).count;
    const yesterdayCount = daily.at(-2).count;
    const cropCounts = new Map();
    for (const row of rows) cropCounts.set(row.crop, (cropCounts.get(row.crop) || 0) + 1);
    const tambons = new Map(view.rows.map((row) => [row.tambonCode, row.tambonName]));
    return {
      updatedAt: new Date(view.loadedAt).toISOString(), snapshotVersion: view.version, stale: view.stale,
      filters: { selected: { tambon, crop, days },
        tambons: [...tambons].map(([code, name]) => ({ code, name })).sort((a, b) => a.code.localeCompare(b.code)),
        crops: [...new Set(view.rows.map((row) => row.crop))].sort((a, b) => a.localeCompare(b, "th")) },
      summary: { total: rows.length, today: todayCount, yesterday: yesterdayCount,
        difference: todayCount - yesterdayCount,
        percentChange: yesterdayCount === 0 ? null : Math.round(((todayCount - yesterdayCount) / yesterdayCount) * 100) },
      crops: [...cropCounts].map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
      daily,
    };
  }

  async function getPoints({ tambon, crop, snapshotVersion }) {
    const view = await snapshot(snapshotVersion);
    return { parcels: filtered(view.rows, { tambon, crop }).filter((row) => row.point).map(publicParcel),
      snapshotVersion: view.version, stale: view.stale };
  }

  async function getGeometries({ tambon, crop, bbox, snapshotVersion, parcelCode }) {
    const view = await snapshot(snapshotVersion);
    const rows = filtered(view.rows, { tambon, crop }).filter((row) => row.geometry &&
      (!parcelCode || row.parcelCode === parcelCode) &&
      row.geometry.bounds[0] <= bbox[2] && row.geometry.bounds[2] >= bbox[0] &&
      row.geometry.bounds[1] <= bbox[3] && row.geometry.bounds[3] >= bbox[1]);
    if (rows.length > GEOMETRY_LIMIT) {
      throw Object.assign(new Error("Zoom in to view parcel boundaries"), { statusCode: 413 });
    }
    return { data: { type: "FeatureCollection", features: rows.map((row) => ({
      type: "Feature", id: row.parcelCode, properties: publicParcel(row), geometry: row.geometry.shape,
    })) }, snapshotVersion: view.version, stale: view.stale };
  }

  async function getImage(parcelCode, index, snapshotVersion, diagnostic) {
    const view = await snapshot(snapshotVersion);
    diagnostic?.mark("SNAPSHOT_RESOLVED");
    const parcel = view.rows.find((row) => row.parcelCode === parcelCode);
    if (!parcel) throw Object.assign(new Error("Image not found"),
      { statusCode: 404, dashboardImageCategory: "parcel-not-found" });
    diagnostic?.context({ parcelCode });
    diagnostic?.mark("PARCEL_FOUND");
    if (index >= parcel.images.length) throw Object.assign(new Error("Image not found"),
      { statusCode: 404, dashboardImageCategory: "photo-index-out-of-range" });
    diagnostic?.mark("PHOTO_INDEX_VALIDATED");
    const image = parcel.images[index];
    if (!image?.fileId) throw Object.assign(new Error("Image not found"),
      { statusCode: 404, dashboardImageCategory: "invalid-sheet-photo-reference" });
    diagnostic?.mark("PHOTO_REFERENCE_RESOLVED");
    diagnostic?.context({ provider: ["oauth", "apps-script", "service-account"].includes(google.readProvider)
      ? google.readProvider : "unknown" });
    diagnostic?.mark("DRIVE_PROVIDER_SELECTED");
    if (google.readProvider === "apps-script") diagnostic?.mark("DRIVE_READ_STARTED");
    const stream = await google.getImage(image.fileId, diagnostic);
    if (diagnostic?.stage !== "DRIVE_READ_HEADERS_RECEIVED") diagnostic?.mark("DRIVE_READ_HEADERS_RECEIVED");
    return stream;
  }

  function invalidate() {
    current = null;
    previous = null;
    nextRetryAt = 0;
  }

  return { snapshot, getSummary, getPoints, getGeometries, getImage, invalidate };
}

module.exports = { createDashboardSheetService, normalizeRow, sheetGeometry, sheetDate, GEOMETRY_LIMIT, SNAPSHOT_TTL_MS };
