const db = require("../config/database");

const OPEN_METEO_BASE_URL = "https://api.open-meteo.com/v1/forecast";
const SOURCE = "Open-Meteo";
const DEFAULT_TIMEOUT_MS = 5000;
const CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_CACHE_ENTRIES = 500;

const cache = new Map();

function createWeatherResult(status, values = {}) {
  return {
    status,
    temperatureC: values.temperatureC ?? null,
    nextHourPrecipitationProbabilityPercent: values.nextHourPrecipitationProbabilityPercent ?? null,
    nextHourForecastAt: values.nextHourForecastAt ?? null,
    updatedAt: values.updatedAt ?? null,
    source: SOURCE,
  };
}

function buildUnavailableResult() {
  return createWeatherResult("UNAVAILABLE");
}

function buildOutsideServiceAreaResult() {
  return createWeatherResult("OUTSIDE_SERVICE_AREA");
}

function isValidCoordinate(latitude, longitude) {
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clampPercent(value) {
  const number = toNumberOrNull(value);
  if (number === null) {
    return null;
  }
  if (number < 0 || number > 100) {
    return null;
  }
  return number;
}

function getOffsetString(offsetSeconds) {
  const number = Number(offsetSeconds);
  if (!Number.isFinite(number)) {
    return "+07:00";
  }
  const sign = number < 0 ? "-" : "+";
  const absolute = Math.abs(number);
  const hours = String(Math.floor(absolute / 3600)).padStart(2, "0");
  const minutes = String(Math.floor((absolute % 3600) / 60)).padStart(2, "0");
  return `${sign}${hours}:${minutes}`;
}

function normalizeCurrentTime(value, offsetSeconds) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const trimmed = value.trim();
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(trimmed)) {
    const date = new Date(trimmed);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  const withSeconds = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(trimmed)
    ? `${trimmed}:00`
    : trimmed;
  const normalized = `${withSeconds}${getOffsetString(offsetSeconds)}`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : normalized;
}

function getComparableTimestamp(value) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const trimmed = value.trim();
  const localMatch = trimmed.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/,
  );
  if (localMatch) {
    const [, year, month, day, hour, minute, second = "0"] = localMatch;
    return Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
    );
  }

  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(trimmed)) {
    const timestamp = Date.parse(trimmed);
    return Number.isNaN(timestamp) ? null : timestamp;
  }

  return null;
}

function buildUrl(latitude, longitude) {
  const url = new URL(OPEN_METEO_BASE_URL);
  url.searchParams.set("latitude", String(latitude));
  url.searchParams.set("longitude", String(longitude));
  url.searchParams.set("current", "temperature_2m");
  url.searchParams.set("hourly", "precipitation_probability");
  url.searchParams.set("timezone", "Asia/Bangkok");
  url.searchParams.set("forecast_hours", "3");
  url.searchParams.set("temperature_unit", "celsius");
  return url;
}

function getCacheKey(latitude, longitude) {
  return `${Number(latitude).toFixed(4)},${Number(longitude).toFixed(4)}`;
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

function setCached(key, value) {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const firstKey = cache.keys().next().value;
    if (firstKey) {
      cache.delete(firstKey);
    }
  }
  cache.set(key, {
    value,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

async function isInsidePhayao(latitude, longitude) {
  if (!isValidCoordinate(latitude, longitude)) {
    return false;
  }

  const result = await db.query(
    `
    WITH point AS (
      SELECT ST_Transform(
        ST_SetSRID(
          ST_MakePoint($1::double precision, $2::double precision),
          4326
        ),
        32647
      ) AS geom
    )
    SELECT EXISTS (
      SELECT 1
      FROM gis.amphoe a
      CROSS JOIN point p
      WHERE a.prov_code = 56
        AND ST_Covers(a.geom, p.geom)
    ) AS is_inside;
    `,
    [longitude, latitude],
  );

  return Boolean(result.rows[0]?.is_inside);
}

function normalizeWeatherResponse(body) {
  if (!body || typeof body !== "object") {
    return buildUnavailableResult();
  }

  const temperatureC = toNumberOrNull(body.current?.temperature_2m);
  const currentTime = body.current?.time;
  const updatedAt = normalizeCurrentTime(body.current?.time, body.utc_offset_seconds);
  const currentComparable = getComparableTimestamp(currentTime);
  const hourlyTimes = body.hourly?.time;
  const hourlyProbabilities = body.hourly?.precipitation_probability;

  if (
    !updatedAt ||
    currentComparable === null ||
    !Array.isArray(hourlyTimes) ||
    !Array.isArray(hourlyProbabilities)
  ) {
    return buildUnavailableResult();
  }

  const nextIndex = hourlyTimes.findIndex((time) => {
    const comparable = getComparableTimestamp(time);
    return comparable !== null && comparable > currentComparable;
  });
  if (nextIndex < 0 || nextIndex >= hourlyProbabilities.length) {
    return buildUnavailableResult();
  }

  const probability = clampPercent(hourlyProbabilities[nextIndex]);
  const nextHourForecastAt = normalizeCurrentTime(hourlyTimes[nextIndex], body.utc_offset_seconds);
  if (probability === null || !nextHourForecastAt) {
    return buildUnavailableResult();
  }

  return createWeatherResult("AVAILABLE", {
    temperatureC,
    nextHourPrecipitationProbabilityPercent: probability,
    nextHourForecastAt,
    updatedAt,
  });
}

async function requestOpenMeteo(latitude, longitude, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs || DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetchImpl(buildUrl(latitude, longitude), {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      return buildUnavailableResult();
    }

    let body;
    try {
      body = await response.json();
    } catch (error) {
      return buildUnavailableResult();
    }

    return normalizeWeatherResponse(body);
  } catch (error) {
    return buildUnavailableResult();
  } finally {
    clearTimeout(timeoutId);
  }
}

async function getWeatherForLocation({ latitude, longitude }, options = {}) {
  if (!isValidCoordinate(latitude, longitude)) {
    return buildUnavailableResult();
  }

  const inside = typeof options.isInsidePhayao === "function"
    ? await options.isInsidePhayao(latitude, longitude)
    : await isInsidePhayao(latitude, longitude);
  if (!inside) {
    return buildOutsideServiceAreaResult();
  }

  const cacheKey = getCacheKey(latitude, longitude);
  const cached = getCached(cacheKey);
  if (cached) {
    return cached;
  }

  const weather = await requestOpenMeteo(latitude, longitude, options);
  setCached(cacheKey, weather);
  return weather;
}

function clearCache() {
  cache.clear();
}

module.exports = {
  OPEN_METEO_BASE_URL,
  SOURCE,
  getWeatherForLocation,
  isInsidePhayao,
  normalizeWeatherResponse,
  normalizeCurrentTime,
  buildUrl,
  buildUnavailableResult,
  buildOutsideServiceAreaResult,
  clearCache,
  _private: {
    isValidCoordinate,
    getComparableTimestamp,
    getCacheKey,
    requestOpenMeteo,
  },
};
