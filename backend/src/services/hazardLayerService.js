const db = require("../config/database");
const { createHazardLayerService } = require("./floodRecurrenceBboxService");
const { getFloodDatasetGeneration } = require("./floodDatasetGeneration");

const FLOOD_FEATURE_LIMIT = 5000;
const FLOOD_CACHE_TTL_MS = 5 * 60 * 1000;
const DROUGHT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const FLOOD_WINDOW_YEARS = 10;
const FLOOD_LAYER_WINDOW_YEARS = 5;
const FLOOD_CACHE_VERSION = "latest5-dissolve-v1";
const FLOOD_SIMPLIFY_CRS = 32647;

const cache = new Map();
const pendingBuilds = new Map();

const floodBboxService = createHazardLayerService({
  db,
  getDatasetGeneration: () => getFloodDatasetGeneration(db),
});

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function parseBbox(value) {
  const parts = String(value || "")
    .split(",")
    .map((part) => Number(part.trim()));

  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) {
    return { error: "bbox must contain minLng,minLat,maxLng,maxLat" };
  }

  const [minLng, minLat, maxLng, maxLat] = parts;
  if (minLng < -180 || maxLng > 180 || minLat < -90 || maxLat > 90) {
    return { error: "bbox values are outside valid coordinate ranges" };
  }
  if (minLng >= maxLng || minLat >= maxLat) {
    return { error: "bbox min values must be smaller than max values" };
  }

  return { bbox: { minLng, minLat, maxLng, maxLat } };
}

function getFloodTolerance(zoom) {
  if (zoom >= 15) {
    return 0;
  }
  if (zoom >= 12) {
    return 5;
  }
  if (zoom >= 9) {
    return 10;
  }
  return 20;
}

function getCache(key) {
  const entry = cache.get(key);
  if (!entry) {
    return null;
  }
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function setCache(key, value, ttlMs) {
  cache.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
  });
  if (cache.size > 500) {
    cache.delete(cache.keys().next().value);
  }
}

async function getOrBuildCache(key, ttlMs, build) {
  const cached = getCache(key);
  if (cached) {
    return cached;
  }
  const pending = pendingBuilds.get(key);
  if (pending) {
    return pending;
  }

  const promise = Promise.resolve()
    .then(build)
    .then((value) => {
      setCache(key, value, ttlMs);
      return value;
    })
    .finally(() => {
      pendingBuilds.delete(key);
    });
  pendingBuilds.set(key, promise);
  return promise;
}

function featureCollection(features, properties) {
  return {
    type: "FeatureCollection",
    ...(properties ? { properties } : {}),
    features,
  };
}

function parseGeometry(geometryText) {
  return geometryText ? JSON.parse(geometryText) : null;
}

async function getFloodYearWindow(windowYears = FLOOD_WINDOW_YEARS) {
  const result = await db.query(
    `
    WITH available_years AS (
      SELECT DISTINCT (item ->> 'year')::int AS year
      FROM gis.flood_recurrence_pyo f
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE
          WHEN jsonb_typeof(f.yearly_frequency) = 'array'
          THEN f.yearly_frequency
          ELSE '[]'::jsonb
        END
      ) AS item
      WHERE (item ->> 'year') ~ '^\\d{4}$'
    ),
    latest_years AS (
      SELECT year
      FROM available_years
      ORDER BY year DESC
      LIMIT $1
    )
    SELECT
      MIN(year)::int AS start_year,
      MAX(year)::int AS end_year,
      COALESCE(array_agg(year ORDER BY year), '{}'::integer[]) AS years
    FROM latest_years;
    `,
    [windowYears],
  );
  const years = Array.isArray(result.rows[0]?.years)
    ? result.rows[0].years.map(toNumber).filter((year) => Number.isInteger(year))
    : [];
  if (!years.length) {
    return null;
  }

  return {
    startYear: toNumber(result.rows[0]?.start_year),
    endYear: toNumber(result.rows[0]?.end_year),
    years,
  };
}

async function getDroughtRecurrenceLayer() {
  const cacheKey = "drought:phayao";
  const cached = getCache(cacheKey);
  if (cached) {
    return cached;
  }

  const result = await db.query(
    `
    SELECT
      jsonb_build_object(
        'totalOccurrences', d.total_occurrences,
        'yearsDetected', d.years_detected,
        'startYear', d.start_year,
        'endYear', d.end_year,
        'tambon', d.tambon_name,
        'district', d.district_name,
        'province', d.province_name,
        'source', 'GISTDA',
        'summaryLevel', 'tambon'
      ) AS properties,
      ST_AsGeoJSON(d.geom) AS geometry
    FROM gis.drought_recurrence_tambon_pyo d
    ORDER BY d.district_name, d.tambon_name;
    `,
  );

  const response = featureCollection(result.rows.map((row) => ({
    type: "Feature",
    properties: row.properties,
    geometry: parseGeometry(row.geometry),
  })));
  setCache(cacheKey, response, DROUGHT_CACHE_TTL_MS);
  return response;
}

function clearCache() {
  cache.clear();
  pendingBuilds.clear();
  floodBboxService.clearCache();
}

module.exports = {
  parseBbox,
  getFloodTolerance,
  getFloodYearWindow,
  getFloodRecurrenceLayer: floodBboxService.getFloodRecurrenceLayer,
  getFloodRecurrenceGeneration: floodBboxService.refreshDatasetGeneration,
  getDroughtRecurrenceLayer,
  clearCache,
};
