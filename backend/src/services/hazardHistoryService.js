const db = require("../config/database");

const SOURCE = "GISTDA";
const FLOOD_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const DROUGHT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 1000;
const FLOOD_WINDOW_YEARS = 10;

const FLOOD_POINT_QUERY = `
WITH input_point AS (
  SELECT
    ST_SetSRID(ST_MakePoint($1::double precision, $2::double precision), 4326) AS geom_4326
),
year_window AS (
  SELECT
    MAX((item ->> 'year')::int) AS end_year,
    MAX((item ->> 'year')::int) - ($3::int - 1) AS start_year
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
candidate_features AS (
  SELECT
    f.freq,
    f.area_rai,
    f.province_id,
    f.province_name,
    f.district_id,
    f.district_name,
    f.subdistrict_id,
    f.subdistrict_name,
    year_window.start_year,
    year_window.end_year,
    ARRAY(
      SELECT year_value
      FROM (
        SELECT
          CASE
            WHEN (item ->> 'year') ~ '^\\d{4}$'
            THEN (item ->> 'year')::int
            ELSE NULL
          END AS year_value,
          CASE
            WHEN (item ->> 'frequency') ~ '^-?\\d+(\\.\\d+)?$'
            THEN (item ->> 'frequency')::numeric
            ELSE 0
          END AS frequency_value
        FROM jsonb_array_elements(
          CASE
            WHEN jsonb_typeof(f.yearly_frequency) = 'array'
            THEN f.yearly_frequency
            ELSE '[]'::jsonb
          END
        ) AS item
      ) yearly
      WHERE year_value BETWEEN year_window.start_year AND year_window.end_year
        AND frequency_value > 0
      ORDER BY year_value
    ) AS years_detected,
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object('year', year_value, 'frequency', frequency_value)
          ORDER BY year_value
        )
        FROM (
          SELECT
            CASE
              WHEN (item ->> 'year') ~ '^\\d{4}$'
              THEN (item ->> 'year')::int
              ELSE NULL
            END AS year_value,
            CASE
              WHEN (item ->> 'frequency') ~ '^-?\\d+(\\.\\d+)?$'
              THEN (item ->> 'frequency')::numeric
              ELSE 0
            END AS frequency_value
          FROM jsonb_array_elements(
            CASE
              WHEN jsonb_typeof(f.yearly_frequency) = 'array'
              THEN f.yearly_frequency
              ELSE '[]'::jsonb
            END
          ) AS item
        ) yearly
        WHERE year_value BETWEEN year_window.start_year AND year_window.end_year
      ),
      '[]'::jsonb
    ) AS yearly_frequency
  FROM gis.flood_recurrence_pyo f
  CROSS JOIN input_point p
  CROSS JOIN year_window
  WHERE year_window.end_year IS NOT NULL
    AND f.geom && p.geom_4326
    AND ST_Covers(
      f.geom,
      p.geom_4326
    )
)
SELECT *
FROM candidate_features
WHERE cardinality(years_detected) > 0
ORDER BY cardinality(years_detected) DESC, COALESCE(freq, 0) DESC
LIMIT 1;
`;

const DROUGHT_POINT_QUERY = `
WITH input_point AS (
  SELECT
    ST_SetSRID(ST_MakePoint($1::double precision, $2::double precision), 4326) AS geom_4326
)
SELECT
  d.tambon_name,
  d.district_name,
  d.province_name,
  d.total_occurrences,
  d.years_detected,
  d.yearly_frequency,
  d.start_year,
  d.end_year,
  d.response_status,
  d.source
FROM gis.drought_recurrence_tambon_pyo d
CROSS JOIN input_point p
WHERE d.geom && p.geom_4326
  AND ST_Covers(
    d.geom,
    p.geom_4326
  )
ORDER BY COALESCE(d.total_occurrences, 0) DESC, d.tambon_name ASC
LIMIT 1;
`;

const cache = new Map();

function toNumberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function createCheckedAt() {
  return new Date().toISOString();
}

function validateLocation({ latitude, longitude }) {
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

function roundForCache(value) {
  return Number(value).toFixed(5);
}

function getCacheKey(dataset, latitude, longitude) {
  return `${dataset}:${roundForCache(latitude)},${roundForCache(longitude)}`;
}

function getCached(key) {
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

function setCached(key, value, ttlMs) {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const firstKey = cache.keys().next().value;
    if (firstKey) {
      cache.delete(firstKey);
    }
  }
  cache.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
  });
}

function buildUnavailableResult(type, warning) {
  const base = {
    status: "unavailable",
    intersects: null,
    checkedAt: createCheckedAt(),
    source: SOURCE,
  };

  if (type === "flood") {
    return {
      ...base,
      frequency: null,
      yearsDetected: [],
      yearlyFrequency: [],
      dataPeriod: { startYear: null, endYear: null, totalYears: null },
      areaRai: null,
      administrativeArea: buildFloodAdministrativeArea(),
      _warnings: warning ? [warning] : [],
    };
  }

  return {
    ...base,
    totalOccurrences: null,
    yearsDetected: [],
    yearlyFrequency: [],
    dataPeriod: { startYear: null, endYear: null, totalYears: null },
    administrativeArea: buildDroughtAdministrativeArea(),
    _warnings: warning ? [warning] : [],
  };
}

function buildFloodAdministrativeArea(props = {}) {
  return {
    province: {
      id: toNumberOrNull(props.pv_idn),
      name: props.pv_tn ?? null,
    },
    district: {
      id: toNumberOrNull(props.ap_idn),
      name: props.ap_tn ?? null,
    },
    subdistrict: {
      id: toNumberOrNull(props.tb_idn),
      name: props.tb_tn ?? null,
    },
  };
}

function buildDroughtAdministrativeArea(record = {}) {
  return {
    province: {
      name: record.province_name ?? null,
    },
    district: {
      name: record.district_name ?? null,
    },
    subdistrict: {
      name: record.subdistrict_name ?? null,
    },
  };
}

function buildDataPeriod(years) {
  if (!years.length) {
    return { startYear: null, endYear: null, totalYears: null };
  }
  const sorted = years.slice().sort((left, right) => left - right);
  return {
    startYear: sorted[0],
    endYear: sorted[sorted.length - 1],
    totalYears: sorted.length,
  };
}

function getFloodYearlyFrequency(props = {}) {
  return Object.keys(props)
    .filter((key) => /^y_\d{4}$/.test(key))
    .map((key) => ({
      year: Number(key.slice(2)),
      frequency: toNumberOrNull(props[key]) ?? 0,
    }))
    .filter((item) => Number.isInteger(item.year))
    .sort((left, right) => left.year - right.year);
}

function normalizeFloodFeature(feature, warnings = []) {
  const props = feature.properties || {};
  const yearlyFrequency = getFloodYearlyFrequency(props);
  const yearsDetected = yearlyFrequency
    .filter((item) => item.frequency > 0)
    .map((item) => item.year);
  const frequency = toNumberOrNull(props.freq);
  const yearlySum = yearlyFrequency.reduce((sum, item) => sum + item.frequency, 0);

  if (frequency !== null && yearlyFrequency.length && frequency !== yearlySum) {
    warnings.push("FREQUENCY_MISMATCH");
  }

  return {
    status: yearsDetected.length > 0 || frequency > 0 ? "detected" : "none_detected",
    intersects: true,
    frequency,
    yearsDetected,
    yearlyFrequency,
    dataPeriod: buildDataPeriod(yearlyFrequency.map((item) => item.year)),
    areaRai: toNumberOrNull(props.area_rai),
    administrativeArea: buildFloodAdministrativeArea(props),
    checkedAt: createCheckedAt(),
    source: SOURCE,
    _warnings: warnings,
  };
}

function buildNoFloodResult() {
  return {
    status: "none_detected",
    intersects: false,
    frequency: null,
    yearsDetected: [],
    yearlyFrequency: [],
    dataPeriod: { startYear: null, endYear: null, totalYears: null },
    areaRai: null,
    administrativeArea: buildFloodAdministrativeArea(),
    checkedAt: createCheckedAt(),
    source: SOURCE,
  };
}

function buildNoDroughtResult() {
  return {
    status: "none_detected",
    intersects: false,
    totalOccurrences: null,
    yearsDetected: [],
    yearlyFrequency: [],
    dataPeriod: { startYear: null, endYear: null, totalYears: null },
    administrativeArea: buildDroughtAdministrativeArea(),
    checkedAt: createCheckedAt(),
    source: SOURCE,
  };
}

function buildNoCoverageResult(type, warning) {
  const base = {
    status: "no_coverage",
    intersects: false,
    checkedAt: createCheckedAt(),
    source: SOURCE,
    _warnings: warning ? [warning] : [],
  };

  if (type === "flood") {
    return {
      ...base,
      frequency: null,
      yearsDetected: [],
      yearlyFrequency: [],
      dataPeriod: { startYear: null, endYear: null, totalYears: null },
      areaRai: null,
      administrativeArea: buildFloodAdministrativeArea(),
    };
  }

  return {
    ...base,
    totalOccurrences: null,
    yearsDetected: [],
    yearlyFrequency: [],
    dataPeriod: { startYear: null, endYear: null, totalYears: null },
    administrativeArea: buildDroughtAdministrativeArea(),
  };
}

function getDbWarning(type, error) {
  if (error?.code === "42P01") {
    return `${type}-db-relation-missing`;
  }
  if (error?.code === "42703") {
    return `${type}-db-column-missing`;
  }
  if (error?.code === "57014") {
    return `${type}-db-timeout`;
  }
  return `${type}-db-query-failed`;
}

function normalizeYearlyFrequency(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => ({
        year: toNumberOrNull(item?.year),
        frequency: toNumberOrNull(item?.frequency) ?? 0,
      }))
      .filter((item) => Number.isInteger(item.year))
      .sort((left, right) => left.year - right.year);
  }

  return [];
}

function normalizeYears(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => Number(item))
    .filter((item) => Number.isInteger(item))
    .filter((item, index, array) => array.indexOf(item) === index)
    .sort((left, right) => left - right);
}

function mapFloodDbRow(row) {
  const yearsDetected = normalizeYears(row?.years_detected);
  const yearlyFrequency = normalizeYearlyFrequency(row?.yearly_frequency);

  return {
    status: yearsDetected.length > 0 ? "detected" : "none_detected",
    intersects: yearsDetected.length > 0,
    frequency: yearsDetected.length,
    yearsDetected,
    yearlyFrequency,
    dataPeriod: {
      startYear: toNumberOrNull(row?.start_year),
      endYear: toNumberOrNull(row?.end_year),
      totalYears:
        toNumberOrNull(row?.start_year) !== null && toNumberOrNull(row?.end_year) !== null
          ? toNumberOrNull(row.end_year) - toNumberOrNull(row.start_year) + 1
          : null,
    },
    areaRai: toNumberOrNull(row?.area_rai),
    administrativeArea: buildFloodAdministrativeArea({
      pv_idn: row?.province_id,
      pv_tn: row?.province_name,
      ap_idn: row?.district_id,
      ap_tn: row?.district_name,
      tb_idn: row?.subdistrict_id,
      tb_tn: row?.subdistrict_name,
    }),
    checkedAt: createCheckedAt(),
    source: SOURCE,
  };
}

function mapDroughtDbRow(row) {
  const yearsDetected = normalizeYears(row?.years_detected);
  const yearlyFrequency = normalizeYearlyFrequency(row?.yearly_frequency);
  const totalOccurrences = toNumberOrNull(row?.total_occurrences);

  return {
    status: yearsDetected.length > 0 || totalOccurrences > 0 ? "detected" : "none_detected",
    intersects: yearsDetected.length > 0 || totalOccurrences > 0,
    totalOccurrences,
    yearsDetected,
    yearlyFrequency,
    dataPeriod: {
      startYear: toNumberOrNull(row?.start_year),
      endYear: toNumberOrNull(row?.end_year),
      totalYears:
        toNumberOrNull(row?.start_year) !== null && toNumberOrNull(row?.end_year) !== null
          ? toNumberOrNull(row.end_year) - toNumberOrNull(row.start_year) + 1
          : null,
    },
    administrativeArea: buildDroughtAdministrativeArea({
      province_name: row?.province_name,
      district_name: row?.district_name,
      subdistrict_name: row?.tambon_name,
    }),
    checkedAt: createCheckedAt(),
    source: row?.source || SOURCE,
  };
}

async function getFloodRecurrence({ latitude, longitude }, dependencies = {}) {
  const cacheKey = getCacheKey("flood_recurrence", latitude, longitude);
  const cached = getCached(cacheKey);
  if (cached) {
    return cached;
  }

  if (!validateLocation({ latitude, longitude })) {
    return buildUnavailableResult("flood", "INVALID_LOCATION");
  }

  try {
    const query = dependencies.db || db;
    const result = await query.query(FLOOD_POINT_QUERY, [
      longitude,
      latitude,
      FLOOD_WINDOW_YEARS,
    ]);
    const value = result.rows[0] ? mapFloodDbRow(result.rows[0]) : buildNoFloodResult();
    setCached(cacheKey, value, FLOOD_CACHE_TTL_MS);
    return value;
  } catch (error) {
    return buildUnavailableResult("flood", getDbWarning("flood", error));
  }
}

function getDroughtYearlyFrequency(record = {}, warnings = []) {
  if (!Array.isArray(record.detail)) {
    warnings.push("MALFORMED_DROUGHT_DETAIL");
    return [];
  }

  return record.detail
    .map((item) => {
      const year = Number(item?.year);
      const frequency = Number(item?.freq);
      if (!Number.isInteger(year) || !Number.isFinite(frequency)) {
        warnings.push("MALFORMED_DROUGHT_YEARLY_VALUE");
        return null;
      }
      return { year, frequency };
    })
    .filter(Boolean)
    .sort((left, right) => left.year - right.year);
}

function normalizeDroughtRecord(record, warnings = []) {
  const yearlyFrequency = getDroughtYearlyFrequency(record, warnings);
  const yearsDetected = yearlyFrequency
    .filter((item) => item.frequency > 0)
    .map((item) => item.year);
  const totalOccurrences = toNumberOrNull(record.total);

  return {
    status: yearsDetected.length > 0 || totalOccurrences > 0 ? "detected" : "none_detected",
    intersects: yearsDetected.length > 0 || totalOccurrences > 0,
    totalOccurrences,
    yearsDetected,
    yearlyFrequency,
    dataPeriod: buildDataPeriod(yearlyFrequency.map((item) => item.year)),
    administrativeArea: buildDroughtAdministrativeArea(record),
    checkedAt: createCheckedAt(),
    source: SOURCE,
    _warnings: warnings,
  };
}

async function getDroughtRecurrence({ latitude, longitude }, dependencies = {}) {
  const cacheKey = getCacheKey("drought_recurrence", latitude, longitude);
  const cached = getCached(cacheKey);
  if (cached) {
    return cached;
  }

  if (!validateLocation({ latitude, longitude })) {
    return buildUnavailableResult("drought", "INVALID_LOCATION");
  }

  try {
    const query = dependencies.db || db;
    const result = await query.query(DROUGHT_POINT_QUERY, [longitude, latitude]);
    const row = result.rows[0];
    if (!row) {
      return buildNoCoverageResult("drought", "drought-admin-area-not-found");
    }

    const responseStatus = String(row.response_status || "").trim().toLowerCase();
    if (responseStatus && !["success", "empty"].includes(responseStatus)) {
      return buildUnavailableResult("drought", "drought-source-stored-unavailable");
    }
    if (responseStatus === "empty") {
      const value = buildNoDroughtResult();
      setCached(cacheKey, value, DROUGHT_CACHE_TTL_MS);
      return value;
    }

    const value = mapDroughtDbRow(row);
    setCached(cacheKey, value, DROUGHT_CACHE_TTL_MS);
    return value;
  } catch (error) {
    return buildUnavailableResult("drought", getDbWarning("drought", error));
  }
}

function clearCache() {
  cache.clear();
}

module.exports = {
  FLOOD_WINDOW_YEARS,
  getFloodRecurrence,
  getDroughtRecurrence,
  normalizeFloodFeature,
  normalizeDroughtRecord,
  buildNoFloodResult,
  buildNoDroughtResult,
  buildNoCoverageResult,
  buildUnavailableResult,
  clearCache,
};
