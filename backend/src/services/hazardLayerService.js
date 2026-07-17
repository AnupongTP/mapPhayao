const db = require("../config/database");

const FLOOD_FEATURE_LIMIT = 5000;
const FLOOD_CACHE_TTL_MS = 5 * 60 * 1000;
const DROUGHT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const FLOOD_WINDOW_YEARS = 10;
const FLOOD_LAYER_WINDOW_YEARS = 5;
const FLOOD_CACHE_VERSION = "latest5-dissolve-v1";
const FLOOD_SIMPLIFY_CRS = 32647;

const cache = new Map();
const pendingBuilds = new Map();

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

async function getFloodRecurrenceLayer({ bbox, zoom }) {
  const parsed = parseBbox(bbox);
  if (parsed.error) {
    const error = new Error(parsed.error);
    error.statusCode = 400;
    throw error;
  }

  const numericZoom = toNumber(zoom) ?? 12;
  const roundedBbox = [
    parsed.bbox.minLng,
    parsed.bbox.minLat,
    parsed.bbox.maxLng,
    parsed.bbox.maxLat,
  ].map((value) => value.toFixed(5)).join(",");
  const yearWindow = await getFloodYearWindow(FLOOD_LAYER_WINDOW_YEARS);
  if (!yearWindow) {
    return featureCollection([]);
  }

  const versionResult = await db.query(
    `
    WITH bounds AS (
      SELECT ST_MakeEnvelope($1, $2, $3, $4, 4326) AS geom
    )
    SELECT
      COUNT(*)::int AS count,
      COALESCE(MAX(f.synced_at)::text, 'unsynced') AS latest_synced_at
    FROM gis.flood_recurrence_pyo f, bounds b
    WHERE f.geom && b.geom
      AND ST_Intersects(f.geom, b.geom)
      AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements(f.yearly_frequency) AS item
        WHERE (item ->> 'year') ~ '^\\d{4}$'
          AND (item ->> 'year')::int = ANY($5::int[])
          AND CASE
            WHEN (item ->> 'frequency') ~ '^-?\\d+(\\.\\d+)?$'
            THEN (item ->> 'frequency')::numeric
            ELSE 0
          END > 0
      );
    `,
    [
      parsed.bbox.minLng,
      parsed.bbox.minLat,
      parsed.bbox.maxLng,
      parsed.bbox.maxLat,
      yearWindow.years,
    ],
  );
  const versionRow = versionResult.rows[0] || {};
  const count = versionRow.count || 0;
  if (count > FLOOD_FEATURE_LIMIT) {
    const error = new Error("Requested extent contains too many flood recurrence features");
    error.statusCode = 413;
    throw error;
  }

  const tolerance = getFloodTolerance(numericZoom);
  const cacheKey = [
    "flood",
    FLOOD_CACHE_VERSION,
    yearWindow.years.join(","),
    roundedBbox,
    Math.round(numericZoom),
    tolerance,
    count,
    versionRow.latest_synced_at || "unsynced",
  ].join(":");

  return getOrBuildCache(cacheKey, FLOOD_CACHE_TTL_MS, async () => {
    const result = await db.query(
      `
      WITH bounds AS (
        SELECT ST_MakeEnvelope($1, $2, $3, $4, 4326) AS geom
      ),
      flood_window AS (
        SELECT
          $5::int[] AS years,
          $6::int AS start_year,
          $7::int AS end_year
      ),
      qualified AS (
        SELECT
          f.province_id,
          f.province_name,
          f.district_id,
          f.district_name,
          f.subdistrict_id,
          f.subdistrict_name,
          w.frequency,
          w.years_detected,
          ST_Force2D(
            ST_CollectionExtract(
              ST_MakeValid(ST_Intersection(f.geom, b.geom)),
              3
            )
          ) AS geom
        FROM gis.flood_recurrence_pyo f
        CROSS JOIN bounds b
        CROSS JOIN flood_window
        CROSS JOIN LATERAL (
          SELECT
            COUNT(DISTINCT year_value)::int AS frequency,
            COALESCE(array_agg(DISTINCT year_value ORDER BY year_value), '{}'::int[]) AS years_detected
          FROM (
            SELECT (item ->> 'year')::int AS year_value
            FROM jsonb_array_elements(f.yearly_frequency) AS item
            WHERE (item ->> 'year') ~ '^\\d{4}$'
              AND (item ->> 'year')::int = ANY(flood_window.years)
              AND CASE
                WHEN (item ->> 'frequency') ~ '^-?\\d+(\\.\\d+)?$'
                THEN (item ->> 'frequency')::numeric
                ELSE 0
              END > 0
          ) AS detected_years
        ) AS w
        WHERE f.geom && b.geom
          AND ST_Intersects(f.geom, b.geom)
          AND w.frequency > 0
      ),
      valid_polygons AS (
        SELECT *
        FROM qualified
        WHERE NOT ST_IsEmpty(geom)
      ),
      dissolved AS (
        SELECT
          province_id,
          province_name,
          district_id,
          district_name,
          subdistrict_id,
          subdistrict_name,
          frequency,
          years_detected,
          ST_CollectionExtract(
            ST_MakeValid(ST_UnaryUnion(ST_Collect(geom))),
            3
          ) AS geom
        FROM valid_polygons
        GROUP BY
          province_id,
          province_name,
          district_id,
          district_name,
          subdistrict_id,
          subdistrict_name,
          frequency,
          years_detected
      ),
      dumped AS (
        SELECT
          province_id,
          province_name,
          district_id,
          district_name,
          subdistrict_id,
          subdistrict_name,
          frequency,
          years_detected,
          (ST_Dump(geom)).geom AS geom
        FROM dissolved
        WHERE NOT ST_IsEmpty(geom)
      ),
      simplified AS (
        SELECT
          province_id,
          province_name,
          district_id,
          district_name,
          subdistrict_id,
          subdistrict_name,
          frequency,
          years_detected,
          ST_CollectionExtract(
            ST_MakeValid(
              CASE
                WHEN $8::double precision > 0
                THEN ST_Transform(
                  ST_SimplifyPreserveTopology(
                    ST_Transform(geom, ${FLOOD_SIMPLIFY_CRS}),
                    $8::double precision
                  ),
                  4326
                )
                ELSE geom
              END
            ),
            3
          ) AS geom
        FROM dumped
      )
      SELECT
        jsonb_build_object(
          'frequency', frequency,
          'yearsDetected', years_detected,
          'startYear', flood_window.start_year,
          'endYear', flood_window.end_year,
          'areaRai', ROUND((ST_Area(ST_Transform(geom, ${FLOOD_SIMPLIFY_CRS})) / 1600.0)::numeric, 2),
          'province', province_name,
          'district', district_name,
          'subdistrict', subdistrict_name,
          'source', 'GISTDA'
        ) AS properties,
        ST_AsGeoJSON(geom) AS geometry
      FROM simplified
      CROSS JOIN flood_window
      WHERE NOT ST_IsEmpty(geom)
      LIMIT $9;
      `,
      [
        parsed.bbox.minLng,
        parsed.bbox.minLat,
        parsed.bbox.maxLng,
        parsed.bbox.maxLat,
        yearWindow.years,
        yearWindow.startYear,
        yearWindow.endYear,
        tolerance,
        FLOOD_FEATURE_LIMIT,
      ],
    );

    return featureCollection(result.rows.map((row) => ({
      type: "Feature",
      properties: row.properties,
      geometry: parseGeometry(row.geometry),
    })), {
      startYear: yearWindow.startYear,
      endYear: yearWindow.endYear,
      years: yearWindow.years,
      yearCount: yearWindow.years.length,
    });
  });
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
}

module.exports = {
  parseBbox,
  getFloodTolerance,
  getFloodYearWindow,
  getFloodRecurrenceLayer,
  getDroughtRecurrenceLayer,
  clearCache,
};
