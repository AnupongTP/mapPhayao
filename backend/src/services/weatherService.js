const db = require("../config/database");

const WEATHERAPI_BASE_URL = "https://api.weatherapi.com/v1/forecast.json";
const SOURCE = "WeatherAPI";
const DEFAULT_TIMEOUT_MS = 5000;
const CACHE_TTL_MS = 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 500;
const DEFAULT_RATE_LIMIT_SECONDS = 60;
const MAX_RATE_LIMIT_SECONDS = 5 * 60;
const WEATHER_API_KEY_PATTERN = /^[A-Za-z0-9_-]{10,128}$/;

const cache = new Map();
const inFlight = new Map();
let rateLimitedUntil = 0;

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
  return Number.isFinite(latitude) && Number.isFinite(longitude) &&
    latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180;
}

function bangkokTimestamp(epochSeconds) {
  if (!Number.isInteger(epochSeconds) || epochSeconds <= 0) return null;
  const date = new Date(epochSeconds * 1000);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(date).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}+07:00`;
}

function normalizeWeatherResponse(body) {
  const localTime = body?.location?.localtime_epoch;
  const temperature = body?.current?.temp_c;
  const updatedAt = bangkokTimestamp(body?.current?.last_updated_epoch);
  const days = body?.forecast?.forecastday;
  if (body?.location?.tz_id !== "Asia/Bangkok" || !Number.isInteger(localTime) ||
    !Number.isFinite(temperature) || !updatedAt || !Array.isArray(days)) {
    return buildUnavailableResult();
  }
  if (days.some((day) => !Array.isArray(day?.hour))) return buildUnavailableResult();
  const hours = days.flatMap((day) => day.hour);
  if (hours.some((hour) => !Number.isInteger(hour?.time_epoch))) return buildUnavailableResult();
  const nextHour = hours
    .filter((hour) => hour.time_epoch > localTime)
    .sort((a, b) => a.time_epoch - b.time_epoch)[0];
  const probability = nextHour?.chance_of_rain;
  const nextHourForecastAt = bangkokTimestamp(nextHour?.time_epoch);
  if (!Number.isInteger(probability) || probability < 0 || probability > 100 ||
    !nextHourForecastAt) return buildUnavailableResult();
  return createWeatherResult("AVAILABLE", {
    temperatureC: temperature,
    nextHourPrecipitationProbabilityPercent: probability,
    nextHourForecastAt,
    updatedAt,
  });
}

function buildUrl(latitude, longitude, key) {
  const url = new URL(WEATHERAPI_BASE_URL);
  url.searchParams.set("key", key);
  url.searchParams.set("q", `${latitude},${longitude}`);
  url.searchParams.set("days", "2");
  url.searchParams.set("aqi", "no");
  url.searchParams.set("alerts", "no");
  url.searchParams.set("current_fields", "temp_c,last_updated_epoch");
  url.searchParams.set("hour_fields", "time_epoch,chance_of_rain");
  return url;
}

function getCacheKey(latitude, longitude) {
  return `${Number(latitude).toFixed(4)},${Number(longitude).toFixed(4)}`;
}

function getCached(key, now) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= now) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function setCached(key, value, now) {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const firstKey = cache.keys().next().value;
    if (firstKey) cache.delete(firstKey);
  }
  cache.set(key, { value, expiresAt: now + CACHE_TTL_MS });
}

function retryAfterSeconds(value, now) {
  let seconds;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    seconds = Number(value.trim());
  } else if (typeof value === "string") {
    const date = Date.parse(value);
    if (Number.isFinite(date)) seconds = Math.ceil((date - now) / 1000);
  }
  if (!Number.isFinite(seconds) || seconds < 1) return DEFAULT_RATE_LIMIT_SECONDS;
  return Math.min(seconds, MAX_RATE_LIMIT_SECONDS);
}

async function isInsidePhayao(latitude, longitude) {
  if (!isValidCoordinate(latitude, longitude)) return false;
  const result = await db.query(`
    WITH point AS (
      SELECT ST_Transform(
        ST_SetSRID(ST_MakePoint($1::double precision, $2::double precision), 4326),
        32647
      ) AS geom
    )
    SELECT EXISTS (
      SELECT 1 FROM gis.amphoe a CROSS JOIN point p
      WHERE a.prov_code = 56 AND ST_Covers(a.geom, p.geom)
    ) AS is_inside;
  `, [longitude, latitude]);
  return Boolean(result.rows[0]?.is_inside);
}

async function requestWeatherApi(latitude, longitude, options = {}) {
  const key = (options.env || process.env).WEATHER_API_KEY;
  if (typeof key !== "string" || !WEATHER_API_KEY_PATTERN.test(key)) {
    console.warn("weather-provider-unavailable", { stage: "config" });
    return buildUnavailableResult();
  }
  const now = options.now || Date.now;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs || DEFAULT_TIMEOUT_MS);
  let response;
  try {
    response = await (options.fetchImpl || fetch)(buildUrl(latitude, longitude, key), {
      method: "GET", headers: { Accept: "application/json" },
      redirect: "error", signal: controller.signal,
    });
  } catch {
    console.warn("weather-provider-unavailable", { stage: controller.signal.aborted ? "timeout" : "network" });
    return buildUnavailableResult();
  } finally {
    clearTimeout(timeoutId);
  }
  const status = response?.status;
  if (status === 429) {
    let retryAfter = null;
    try { retryAfter = response.headers?.get?.("retry-after") ?? null; } catch { /* Use bounded default. */ }
    const seconds = retryAfterSeconds(retryAfter, now());
    rateLimitedUntil = Math.max(rateLimitedUntil, now() + seconds * 1000);
    console.warn("weather-provider-unavailable", {
      stage: "rate-limit", status, retryAfterSeconds: seconds,
    });
    return buildUnavailableResult();
  }
  if (!Number.isInteger(status) || status < 200 || status >= 300) {
    const stage = status === 400 ? "bad-request" : [401, 403].includes(status) ? "auth" :
      Number.isInteger(status) && status >= 500 ? "upstream" : "http";
    console.warn("weather-provider-unavailable", { stage, status: Number.isInteger(status) ? status : undefined });
    return buildUnavailableResult();
  }
  let body;
  try { body = await response.json(); } catch {
    console.warn("weather-provider-unavailable", { stage: "invalid-json" });
    return buildUnavailableResult();
  }
  const weather = normalizeWeatherResponse(body);
  if (weather.status !== "AVAILABLE") {
    console.warn("weather-provider-unavailable", { stage: "invalid-payload" });
  }
  return weather;
}

async function getWeatherForLocation({ latitude, longitude }, options = {}) {
  if (!isValidCoordinate(latitude, longitude)) return buildUnavailableResult();
  const inside = typeof options.isInsidePhayao === "function"
    ? await options.isInsidePhayao(latitude, longitude)
    : await isInsidePhayao(latitude, longitude);
  if (!inside) return buildOutsideServiceAreaResult();

  const cacheKey = getCacheKey(latitude, longitude);
  const now = options.now || Date.now;
  const cached = getCached(cacheKey, now());
  if (cached) return cached;
  if (now() < rateLimitedUntil) return buildUnavailableResult();
  const existing = inFlight.get(cacheKey);
  if (existing) return existing;
  const pending = requestWeatherApi(latitude, longitude, options).then((weather) => {
    if (weather.status === "AVAILABLE") setCached(cacheKey, weather, now());
    return weather;
  }).finally(() => inFlight.delete(cacheKey));
  inFlight.set(cacheKey, pending);
  return pending;
}

function clearCache() {
  cache.clear();
  inFlight.clear();
  rateLimitedUntil = 0;
}

module.exports = {
  WEATHERAPI_BASE_URL, SOURCE, CACHE_TTL_MS,
  getWeatherForLocation, isInsidePhayao, normalizeWeatherResponse,
  buildUnavailableResult, buildOutsideServiceAreaResult, clearCache,
  _private: { isValidCoordinate, getCacheKey, retryAfterSeconds, requestWeatherApi },
};
