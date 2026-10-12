"use strict";

const DEFAULT_SOURCE_LIMIT = 5000;
const DEFAULT_OUTPUT_LIMIT = 5000;
const DEFAULT_RESPONSE_BYTE_LIMIT = 8 * 1024 * 1024;
const DEFAULT_CACHE_BYTE_LIMIT = 32 * 1024 * 1024;
const FLOOD_LAYER_WINDOW_YEARS = 5;
const FLOOD_SIMPLIFY_CRS = 32647;
const GEOJSON_PRECISION = 9;

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function parseBbox(value) {
  const parts = String(value || "").split(",").map((part) => Number(part.trim()));
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
  const canonicalParts = parts.map((part) => part.toFixed(6));
  return {
    bbox: {
      minLng: Number(canonicalParts[0]), minLat: Number(canonicalParts[1]),
      maxLng: Number(canonicalParts[2]), maxLat: Number(canonicalParts[3]),
    },
    canonical: canonicalParts.join(","),
  };
}

function getFloodTolerance(zoom) {
  if (zoom >= 15) return 0;
  if (zoom >= 12) return 5;
  if (zoom >= 9) return 10;
  return 20;
}

function createHttpError(statusCode, code, message, details = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  Object.assign(error, details);
  return error;
}

function normalizeDatasetGeneration(value) {
  const normalized = String(value ?? "").trim();
  if (!/^[1-9]\d*$/.test(normalized)) {
    throw createHttpError(503, "FLOOD_DATASET_GENERATION_UNAVAILABLE",
      "Flood dataset generation is unavailable");
  }
  return normalized;
}

const FLOOD_BBOX_SQL = `
WITH available_years AS (
  SELECT DISTINCT (item->>'year')::int AS year
  FROM gis.flood_recurrence_pyo AS f
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(f.yearly_frequency)='array'
      THEN f.yearly_frequency ELSE '[]'::jsonb END
  ) AS item
  WHERE (item->>'year') ~ '^\\d{4}$'
), latest_years AS (
  SELECT year FROM available_years ORDER BY year DESC LIMIT $5
), flood_window AS MATERIALIZED (
  SELECT MIN(year)::int AS start_year,MAX(year)::int AS end_year,
    COALESCE(array_agg(year ORDER BY year),'{}'::int[]) AS years
  FROM latest_years
), bounds AS MATERIALIZED (
  SELECT ST_MakeEnvelope($1,$2,$3,$4,4326) AS geom
), classified_candidates AS (
  SELECT f.id,f.province_id,f.province_name,f.district_id,f.district_name,
    f.subdistrict_id,f.subdistrict_name,f.geom,f.synced_at,
    classification.frequency,classification.years_detected
  FROM gis.flood_recurrence_pyo AS f CROSS JOIN bounds AS b
  CROSS JOIN flood_window AS fw
  CROSS JOIN LATERAL (
    SELECT COUNT(DISTINCT year_value)::int AS frequency,
      COALESCE(array_agg(DISTINCT year_value ORDER BY year_value),'{}'::int[])
        AS years_detected
    FROM (
      SELECT (item->>'year')::int AS year_value
      FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(f.yearly_frequency)='array'
          THEN f.yearly_frequency ELSE '[]'::jsonb END
      ) AS item
      WHERE (item->>'year') ~ '^\\d{4}$'
        AND (item->>'year')::int=ANY(fw.years)
        AND CASE WHEN (item->>'frequency') ~ '^-?\\d+(\\.\\d+)?$'
          THEN (item->>'frequency')::numeric ELSE 0 END>0
    ) AS detected
  ) AS classification
  WHERE f.geom && b.geom AND classification.frequency>0
), repaired_candidates AS (
  SELECT c.id,c.province_id,c.province_name,c.district_id,c.district_name,
    c.subdistrict_id,c.subdistrict_name,c.synced_at,c.frequency,c.years_detected,
    ST_CollectionExtract(ST_MakeValid(c.geom),3) AS valid_geom
  FROM classified_candidates AS c
), qualified_source AS MATERIALIZED (
  SELECT c.* FROM repaired_candidates AS c CROSS JOIN bounds AS b
  WHERE NOT ST_IsEmpty(c.valid_geom) AND ST_Intersects(c.valid_geom,b.geom)
), source_stats AS (
  SELECT COUNT(*)::bigint AS source_count,
    COALESCE(MAX(synced_at)::text,'unsynced') AS latest_synced_at
  FROM qualified_source
), clipped AS MATERIALIZED (
  SELECT q.province_id,q.province_name,q.district_id,q.district_name,
    q.subdistrict_id,q.subdistrict_name,q.frequency,q.years_detected,
    ST_Force2D(ST_CollectionExtract(ST_Intersection(q.valid_geom,b.geom),3)) AS geom
  FROM qualified_source AS q CROSS JOIN bounds AS b CROSS JOIN source_stats AS s
  WHERE s.source_count<=$6
), dissolved AS (
  SELECT province_id,province_name,district_id,district_name,
    subdistrict_id,subdistrict_name,frequency,years_detected,
    ST_CollectionExtract(ST_UnaryUnion(ST_Collect(geom)),3) AS geom
  FROM clipped WHERE NOT ST_IsEmpty(geom)
  GROUP BY province_id,province_name,district_id,district_name,
    subdistrict_id,subdistrict_name,frequency,years_detected
), dumped AS (
  SELECT d.province_id,d.province_name,d.district_id,d.district_name,
    d.subdistrict_id,d.subdistrict_name,d.frequency,d.years_detected,
    part.path AS dump_path,part.geom
  FROM dissolved AS d CROSS JOIN LATERAL ST_Dump(d.geom) AS part
  WHERE NOT ST_IsEmpty(d.geom)
), simplified AS (
  SELECT province_id,province_name,district_id,district_name,
    subdistrict_id,subdistrict_name,frequency,years_detected,dump_path,
    ST_CollectionExtract(
      CASE WHEN $8::float8>0 THEN ST_Transform(
        ST_SimplifyPreserveTopology(ST_Transform(geom,${FLOOD_SIMPLIFY_CRS}),$8::float8),4326)
      ELSE geom END,3) AS geom
  FROM dumped
), bounded_output AS MATERIALIZED (
  SELECT * FROM simplified WHERE NOT ST_IsEmpty(geom)
  ORDER BY province_id NULLS FIRST,province_name NULLS FIRST,
    district_id NULLS FIRST,district_name NULLS FIRST,
    subdistrict_id NULLS FIRST,subdistrict_name NULLS FIRST,
    frequency,years_detected,dump_path
  LIMIT ($7 + 1)
), serialized AS MATERIALIZED (
  SELECT province_id,province_name,district_id,district_name,
    subdistrict_id,subdistrict_name,frequency,years_detected,dump_path,
    jsonb_build_object(
      'type','Feature',
      'properties',jsonb_build_object(
        'frequency',frequency,'yearsDetected',years_detected,
        'startYear',fw.start_year,'endYear',fw.end_year,
        'areaRai',ROUND((ST_Area(ST_Transform(geom,${FLOOD_SIMPLIFY_CRS}))/1600.0)::numeric,2),
        'province',province_name,'district',district_name,
        'subdistrict',subdistrict_name,'source','GISTDA'
      ),
      'geometry',ST_AsGeoJSON(geom,${GEOJSON_PRECISION})::jsonb
    ) AS feature
  FROM bounded_output CROSS JOIN flood_window AS fw
), output_stats AS (
  SELECT COUNT(*)::bigint AS output_count_bounded FROM serialized
), collection_candidate AS (
  SELECT jsonb_build_object(
    'type','FeatureCollection',
    'properties',jsonb_build_object(
      'startYear',fw.start_year,'endYear',fw.end_year,'years',fw.years,
      'yearCount',COALESCE(array_length(fw.years,1),0)
    ),
    'features',COALESCE(jsonb_agg(s.feature ORDER BY
      s.province_id NULLS FIRST,s.province_name NULLS FIRST,
      s.district_id NULLS FIRST,s.district_name NULLS FIRST,
      s.subdistrict_id NULLS FIRST,s.subdistrict_name NULLS FIRST,
      s.frequency,s.years_detected,s.dump_path)
      FILTER (WHERE s.feature IS NOT NULL),'[]'::jsonb)
  ) AS collection
  FROM flood_window AS fw LEFT JOIN serialized AS s ON true
  GROUP BY fw.start_year,fw.end_year,fw.years
), response_stats AS (
  SELECT collection,
    octet_length(convert_to(collection::text,'UTF8'))::bigint AS response_bytes_bounded
  FROM collection_candidate
)
SELECT fw.start_year,fw.end_year,fw.years,s.source_count,s.latest_synced_at,
  o.output_count_bounded,r.response_bytes_bounded,
  (s.source_count>$6) AS source_overflow,
  (o.output_count_bounded>$7) AS output_overflow,
  (r.response_bytes_bounded>$9) AS byte_overflow,
  CASE WHEN s.source_count<=$6 AND o.output_count_bounded<=$7
      AND r.response_bytes_bounded<=$9 THEN r.collection ELSE NULL END AS collection
FROM flood_window AS fw CROSS JOIN source_stats AS s CROSS JOIN output_stats AS o
CROSS JOIN response_stats AS r;
`;

function createHazardLayerService({
  db,
  getDatasetGeneration,
  sourceLimit = DEFAULT_SOURCE_LIMIT,
  outputLimit = DEFAULT_OUTPUT_LIMIT,
  responseByteLimit = DEFAULT_RESPONSE_BYTE_LIMIT,
  cacheTtlMs = 5 * 60 * 1000,
  maxCacheEntries = 50,
  maxCacheBytes = DEFAULT_CACHE_BYTE_LIMIT,
  maxGenerationRetries = 1,
  now = () => Date.now(),
} = {}) {
  if (!db || typeof db.query !== "function") throw new TypeError("db.query is required");
  if (typeof getDatasetGeneration !== "function") {
    throw new TypeError("getDatasetGeneration is required");
  }
  const cache = new Map();
  const pending = new Map();
  let activeGeneration = null;
  let cacheEpoch = 0;
  let cacheBytes = 0;

  function cacheGet(key) {
    const entry = cache.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= now()) {
      cacheBytes -= entry.bytes;
      cache.delete(key);
      return null;
    }
    return entry.value;
  }

  function cacheSet(key, value, bytes) {
    const existing = cache.get(key);
    if (existing) cacheBytes -= existing.bytes;
    cache.set(key, { value, bytes, expiresAt: now() + cacheTtlMs });
    cacheBytes += bytes;
    while (cache.size > maxCacheEntries || cacheBytes > maxCacheBytes) {
      const oldestKey = cache.keys().next().value;
      const oldest = cache.get(oldestKey);
      cacheBytes -= oldest.bytes;
      cache.delete(oldestKey);
    }
  }

  function clearCache() {
    cacheEpoch += 1;
    cache.clear();
    cacheBytes = 0;
    pending.clear();
  }

  async function refreshDatasetGeneration() {
    const generation = normalizeDatasetGeneration(await getDatasetGeneration());
    if (activeGeneration !== null
        && BigInt(generation) < BigInt(activeGeneration)) {
      throw createHttpError(503, "FLOOD_DATASET_GENERATION_REGRESSION",
        "Flood dataset generation moved backwards");
    }
    if (activeGeneration !== null && generation !== activeGeneration) clearCache();
    activeGeneration = generation;
    return generation;
  }

  async function build({ parsed, tolerance }) {
    const result = await db.query(FLOOD_BBOX_SQL, [
      parsed.bbox.minLng, parsed.bbox.minLat, parsed.bbox.maxLng, parsed.bbox.maxLat,
      FLOOD_LAYER_WINDOW_YEARS, sourceLimit, outputLimit, tolerance, responseByteLimit,
    ]);
    const row = result.rows[0] || {};
    const years = Array.isArray(row.years) ? row.years.map(Number) : [];
    if (!years.length) {
      const collection = { type: "FeatureCollection", features: [] };
      return { collection, bytes: Buffer.byteLength(JSON.stringify(collection)) };
    }
    if (row.source_overflow) {
      throw createHttpError(413, "FLOOD_SOURCE_BUDGET_EXCEEDED",
        "Requested extent contains too many flood recurrence source features", {
          sourceCount: Number(row.source_count), sourceLimit,
        });
    }
    if (row.output_overflow) {
      throw createHttpError(413, "FLOOD_OUTPUT_BUDGET_EXCEEDED",
        "Requested extent produces too many flood recurrence output features", {
          outputCountLowerBound: Number(row.output_count_bounded), outputLimit,
        });
    }
    if (row.byte_overflow) {
      throw createHttpError(413, "FLOOD_RESPONSE_BUDGET_EXCEEDED",
        "Requested extent produces a flood recurrence response that is too large", {
          responseBytesUpperBound: Number(row.response_bytes_bounded), responseByteLimit,
        });
    }
    const collection = row.collection || { type: "FeatureCollection", features: [] };
    const exactResponseBytes = Buffer.byteLength(JSON.stringify(collection));
    if (exactResponseBytes > responseByteLimit) {
      throw createHttpError(413, "FLOOD_RESPONSE_BUDGET_EXCEEDED",
        "Requested extent produces a flood recurrence response that is too large", {
          exactResponseBytes, responseByteLimit,
        });
    }
    return { collection, bytes: exactResponseBytes };
  }

  async function getFloodRecurrenceLayer({ bbox, zoom }) {
    const parsed = parseBbox(bbox);
    if (parsed.error) throw createHttpError(400, "INVALID_BBOX", parsed.error);
    const numericZoom = toNumber(zoom) ?? 12;
    const tolerance = getFloodTolerance(numericZoom);
    for (let attempt = 0; attempt <= maxGenerationRetries; attempt += 1) {
      const generation = await refreshDatasetGeneration();
      const key = ["flood-bbox-v3",generation,parsed.canonical,tolerance].join(":");
      const cached = cacheGet(key);
      if (cached) return cached;

      let promise = pending.get(key);
      if (!promise) {
        const buildEpoch = cacheEpoch;
        promise = build({ parsed, tolerance })
          .then(async (built) => {
            const completedGeneration = await refreshDatasetGeneration();
            if (completedGeneration !== generation) {
              throw createHttpError(409, "FLOOD_DATASET_CHANGED_DURING_REQUEST",
                "Flood dataset changed while the response was being prepared");
            }
            const collection = {
              ...built.collection,
              properties: {
                ...(built.collection.properties || {}),
                datasetGeneration: generation,
              },
            };
            const bytes = Buffer.byteLength(JSON.stringify(collection));
            if (bytes > responseByteLimit) {
              throw createHttpError(413, "FLOOD_RESPONSE_BUDGET_EXCEEDED",
                "Requested extent produces a flood recurrence response that is too large", {
                  exactResponseBytes: bytes, responseByteLimit,
                });
            }
            if (buildEpoch === cacheEpoch && generation === activeGeneration) {
              cacheSet(key, collection, bytes);
            }
            return collection;
          })
          .finally(() => {
            if (pending.get(key) === promise) pending.delete(key);
          });
        pending.set(key, promise);
      }

      try {
        return await promise;
      } catch (error) {
        if (error?.code !== "FLOOD_DATASET_CHANGED_DURING_REQUEST"
            || attempt >= maxGenerationRetries) {
          throw error;
        }
      }
    }
    throw createHttpError(503, "FLOOD_DATASET_REFRESH_IN_PROGRESS",
      "Flood dataset refresh did not stabilize");
  }

  return {
    getFloodRecurrenceLayer,
    clearCache,
    refreshDatasetGeneration,
    getCacheKeys() { return [...cache.keys()]; },
    getCacheState() {
      return {
        generation: activeGeneration,
        epoch: cacheEpoch,
        entries: cache.size,
        bytes: cacheBytes,
        pending: pending.size,
      };
    },
  };
}

module.exports = {
  FLOOD_BBOX_SQL,
  GEOJSON_PRECISION,
  parseBbox,
  getFloodTolerance,
  normalizeDatasetGeneration,
  createHazardLayerService,
};
