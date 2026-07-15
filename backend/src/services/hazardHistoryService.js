const db = require("../config/database");
const gistdaClient = require("./gistdaClient");

const SOURCE = "GISTDA";
const FLOOD_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const DROUGHT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 1000;
const FLOOD_BBOX_DELTA_DEGREES = 0.0001;
const FLOOD_LIMIT = 1000;
const FLOOD_FEATURE_CAP = 5000;

const POINT_COVER_QUERY = `
SELECT ST_Covers(
  ST_MakeValid(
    ST_SetSRID(
      ST_GeomFromGeoJSON($1),
      4326
    )
  ),
  ST_SetSRID(
    ST_MakePoint($2::double precision, $3::double precision),
    4326
  )
) AS covers;
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

function assertSupportedGeometry(feature) {
  const type = feature?.geometry?.type;
  if (type !== "Polygon" && type !== "MultiPolygon") {
    throw gistdaClient.createGistdaError("UNSUPPORTED_GEOMETRY", "Unsupported flood geometry");
  }
}

async function defaultCoversPoint(feature, { latitude, longitude }) {
  assertSupportedGeometry(feature);
  const result = await db.query(POINT_COVER_QUERY, [
    JSON.stringify(feature.geometry),
    longitude,
    latitude,
  ]);
  return Boolean(result.rows[0]?.covers);
}

function buildFloodBbox({ latitude, longitude }, delta = FLOOD_BBOX_DELTA_DEGREES) {
  return [
    longitude - delta,
    latitude - delta,
    longitude + delta,
    latitude + delta,
  ].join(",");
}

async function fetchFloodCandidates({ latitude, longitude }, dependencies = {}) {
  const requestJson = dependencies.requestJson || gistdaClient.requestJson;
  const features = [];
  let offset = 0;
  let numberMatched = null;

  while (features.length < FLOOD_FEATURE_CAP) {
    const { body } = await requestJson("/features/flood-freq", {
      query: {
        bbox: buildFloodBbox({ latitude, longitude }, dependencies.bboxDelta),
        limit: FLOOD_LIMIT,
        offset,
      },
      accept: "application/geo+json",
    });

    if (!body || body.type !== "FeatureCollection" || !Array.isArray(body.features)) {
      throw gistdaClient.createGistdaError("INVALID_GEOJSON", "Invalid flood GeoJSON");
    }

    numberMatched = toNumberOrNull(body.numberMatched);
    features.push(...body.features);

    const numberReturned = toNumberOrNull(body.numberReturned) ?? body.features.length;
    if (!numberMatched || offset + numberReturned >= numberMatched || numberReturned === 0) {
      break;
    }

    offset += numberReturned;
  }

  if (numberMatched !== null && numberMatched > features.length) {
    return {
      features,
      capped: features.length >= FLOOD_FEATURE_CAP,
    };
  }

  return {
    features,
    capped: false,
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
    const { features, capped } = await fetchFloodCandidates({ latitude, longitude }, dependencies);
    if (capped) {
      return buildUnavailableResult("flood", "FEATURE_CAP_EXCEEDED");
    }

    const coversPoint = dependencies.coversPoint || defaultCoversPoint;
    const matches = [];

    for (const feature of features) {
      assertSupportedGeometry(feature);
      if (await coversPoint(feature, { latitude, longitude })) {
        matches.push(feature);
      }
    }

    const value = matches.length
      ? normalizeFloodFeature(
          matches
            .slice()
            .sort((left, right) => {
              const rightFreq = toNumberOrNull(right.properties?.freq) ?? -Infinity;
              const leftFreq = toNumberOrNull(left.properties?.freq) ?? -Infinity;
              return rightFreq - leftFreq;
            })[0],
          matches.length > 1 ? ["MULTIPLE_MATCHING_FEATURES"] : [],
        )
      : buildNoFloodResult();

    setCached(cacheKey, value, FLOOD_CACHE_TTL_MS);
    return value;
  } catch (error) {
    return buildUnavailableResult("flood", error.code || "UPSTREAM_ERROR");
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
    const requestJson = dependencies.requestJson || gistdaClient.requestJson;
    const { body } = await requestJson("/gi-service/v1.1/disasters/drought-recurrence", {
      query: {
        lat: latitude,
        lon: longitude,
      },
      accept: "application/json",
    });

    if (!Array.isArray(body)) {
      return buildUnavailableResult("drought", "MALFORMED_DROUGHT_RESPONSE");
    }

    if (!body.length) {
      const value = buildNoDroughtResult();
      setCached(cacheKey, value, DROUGHT_CACHE_TTL_MS);
      return value;
    }

    const records = body
      .map((record) => normalizeDroughtRecord(record))
      .sort((left, right) => {
        const rightTotal = right.totalOccurrences ?? -Infinity;
        const leftTotal = left.totalOccurrences ?? -Infinity;
        return rightTotal - leftTotal;
      });
    const value = {
      ...records[0],
      _warnings: [
        ...(records[0]._warnings || []),
        ...(records.length > 1 ? ["MULTIPLE_DROUGHT_RECORDS"] : []),
      ],
    };

    setCached(cacheKey, value, DROUGHT_CACHE_TTL_MS);
    return value;
  } catch (error) {
    return buildUnavailableResult("drought", error.code || "UPSTREAM_ERROR");
  }
}

function clearCache() {
  cache.clear();
}

module.exports = {
  FLOOD_FEATURE_CAP,
  buildFloodBbox,
  getFloodRecurrence,
  getDroughtRecurrence,
  normalizeFloodFeature,
  normalizeDroughtRecord,
  buildNoFloodResult,
  buildNoDroughtResult,
  buildUnavailableResult,
  clearCache,
};
