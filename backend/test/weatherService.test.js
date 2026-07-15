const test = require("node:test");
const assert = require("node:assert/strict");

const weatherService = require("../src/services/weatherService");
const locationReportService = require("../src/services/locationReportService");
const areaAnalysisService = require("../src/services/areaAnalysisService");
const db = require("../src/config/database");

const originalQuery = db.query;

test.afterEach(() => {
  db.query = originalQuery;
  weatherService.clearCache();
});

function createResponse(body, options = {}) {
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    json: async () => body,
  };
}

function validWeatherBody(overrides = {}) {
  return {
    utc_offset_seconds: 25200,
    timezone: "Asia/Bangkok",
    current: {
      time: "2026-07-15T00:00",
      temperature_2m: 28.5,
      ...(overrides.current || {}),
    },
    hourly: {
      time: [
        "2026-07-15T00:00",
        "2026-07-15T01:00",
        "2026-07-15T02:00",
      ],
      precipitation_probability: [15, 82, 95],
      ...(overrides.hourly || {}),
    },
    ...overrides,
  };
}

test("weather service requests only required Open-Meteo fields without an API key", async () => {
  let requestedUrl = null;
  let requestedHeaders = null;

  const result = await weatherService.getWeatherForLocation(
    { latitude: 19.02, longitude: 99.97 },
    {
      isInsidePhayao: async () => true,
      fetchImpl: async (url, options) => {
        requestedUrl = url;
        requestedHeaders = options.headers;
        return createResponse(validWeatherBody());
      },
    },
  );

  assert.equal(result.status, "AVAILABLE");
  assert.equal(requestedUrl.origin + requestedUrl.pathname, weatherService.OPEN_METEO_BASE_URL);
  assert.equal(requestedUrl.searchParams.get("current"), "temperature_2m");
  assert.equal(requestedUrl.searchParams.get("hourly"), "precipitation_probability");
  assert.equal(requestedUrl.searchParams.get("daily"), null);
  assert.equal(requestedUrl.searchParams.get("timezone"), "Asia/Bangkok");
  assert.equal(requestedUrl.searchParams.get("forecast_hours"), "3");
  assert.equal(requestedUrl.searchParams.get("forecast_days"), null);
  assert.equal(requestedUrl.searchParams.get("temperature_unit"), "celsius");
  assert.equal(requestedHeaders.Accept, "application/json");
  assert.equal(requestedHeaders["API-Key"], undefined);
});

test("weather normalization preserves zero values and current.time", () => {
  const result = weatherService.normalizeWeatherResponse(validWeatherBody({
    current: {
      time: "2026-07-15T00:00",
      temperature_2m: 0,
    },
    hourly: {
      time: ["2026-07-15T00:00", "2026-07-15T01:00"],
      precipitation_probability: [15, 0],
    },
  }));

  assert.equal(result.status, "AVAILABLE");
  assert.equal(result.temperatureC, 0);
  assert.equal(result.nextHourPrecipitationProbabilityPercent, 0);
  assert.equal(result.nextHourForecastAt, "2026-07-15T01:00:00+07:00");
  assert.equal(result.updatedAt, "2026-07-15T00:00:00+07:00");
  assert.equal(result.source, "Open-Meteo");
});

test("weather normalization selects the immediate future hourly forecast only", () => {
  const result = weatherService.normalizeWeatherResponse(validWeatherBody());

  assert.equal(result.status, "AVAILABLE");
  assert.equal(result.nextHourPrecipitationProbabilityPercent, 82);
  assert.equal(result.nextHourForecastAt, "2026-07-15T01:00:00+07:00");
  assert.notEqual(result.nextHourPrecipitationProbabilityPercent, 15);
  assert.notEqual(result.nextHourPrecipitationProbabilityPercent, 95);
});

test("weather normalization preserves 100 percent next-hour probability", () => {
  const result = weatherService.normalizeWeatherResponse(validWeatherBody({
    hourly: {
      time: ["2026-07-15T00:00", "2026-07-15T01:00"],
      precipitation_probability: [20, 100],
    },
  }));

  assert.equal(result.status, "AVAILABLE");
  assert.equal(result.nextHourPrecipitationProbabilityPercent, 100);
});

test("weather normalization rejects invalid next-hour probabilities", () => {
  for (const value of [null, -1, 101, Number.NaN]) {
    const result = weatherService.normalizeWeatherResponse(validWeatherBody({
      hourly: {
        time: ["2026-07-15T00:00", "2026-07-15T01:00"],
        precipitation_probability: [20, value],
      },
    }));
    assert.equal(result.status, "UNAVAILABLE");
  }
});

test("weather normalization handles missing and malformed hourly fields safely", () => {
  const missing = weatherService.normalizeWeatherResponse({
    utc_offset_seconds: 25200,
    current: { time: "2026-07-15T00:00" },
    hourly: {},
  });
  const missingHourly = weatherService.normalizeWeatherResponse({
    utc_offset_seconds: 25200,
    current: { time: "2026-07-15T00:00" },
  });
  const mismatched = weatherService.normalizeWeatherResponse(validWeatherBody({
    hourly: {
      time: ["2026-07-15T00:00", "2026-07-15T01:00"],
      precipitation_probability: [15],
    },
  }));
  const noFuture = weatherService.normalizeWeatherResponse(validWeatherBody({
    hourly: {
      time: ["2026-07-14T22:00", "2026-07-15T00:00"],
      precipitation_probability: [10, 15],
    },
  }));
  const badCurrent = weatherService.normalizeWeatherResponse({
    utc_offset_seconds: 25200,
    current: { time: "bad", temperature_2m: 10 },
    hourly: {
      time: ["2026-07-15T01:00"],
      precipitation_probability: [82],
    },
  });
  const malformed = weatherService.normalizeWeatherResponse(null);

  assert.equal(missing.status, "UNAVAILABLE");
  assert.equal(missingHourly.status, "UNAVAILABLE");
  assert.equal(mismatched.status, "UNAVAILABLE");
  assert.equal(noFuture.status, "UNAVAILABLE");
  assert.equal(badCurrent.status, "UNAVAILABLE");
  assert.equal(malformed.status, "UNAVAILABLE");
});

test("weather service handles non-200, invalid JSON, timeout, and cache", async () => {
  const non200 = await weatherService.getWeatherForLocation(
    { latitude: 19.02, longitude: 99.97 },
    {
      isInsidePhayao: async () => true,
      fetchImpl: async () => createResponse({}, { ok: false, status: 503 }),
    },
  );
  assert.equal(non200.status, "UNAVAILABLE");
  weatherService.clearCache();

  const invalidJson = await weatherService.getWeatherForLocation(
    { latitude: 19.02, longitude: 99.97 },
    {
      isInsidePhayao: async () => true,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => { throw new Error("bad json"); },
      }),
    },
  );
  assert.equal(invalidJson.status, "UNAVAILABLE");
  weatherService.clearCache();

  const timeout = await weatherService.getWeatherForLocation(
    { latitude: 19.02, longitude: 99.97 },
    {
      timeoutMs: 1,
      isInsidePhayao: async () => true,
      fetchImpl: async (url, options) => new Promise((resolve, reject) => {
        options.signal.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      }),
    },
  );
  assert.equal(timeout.status, "UNAVAILABLE");
  weatherService.clearCache();

  let calls = 0;
  await weatherService.getWeatherForLocation(
    { latitude: 19.02, longitude: 99.97 },
    {
      isInsidePhayao: async () => true,
      fetchImpl: async () => {
        calls += 1;
        return createResponse(validWeatherBody());
      },
    },
  );
  await weatherService.getWeatherForLocation(
    { latitude: 19.020001, longitude: 99.970001 },
    {
      isInsidePhayao: async () => true,
      fetchImpl: async () => {
        calls += 1;
        return createResponse(validWeatherBody());
      },
    },
  );
  assert.equal(calls, 1);
});

test("outside Phayao and invalid coordinates do not call Open-Meteo", async () => {
  let calls = 0;
  const outside = await weatherService.getWeatherForLocation(
    { latitude: 18, longitude: 100 },
    {
      isInsidePhayao: async () => false,
      fetchImpl: async () => {
        calls += 1;
        return createResponse(validWeatherBody());
      },
    },
  );
  const invalid = await weatherService.getWeatherForLocation(
    { latitude: 100, longitude: 99 },
    {
      fetchImpl: async () => {
        calls += 1;
        return createResponse(validWeatherBody());
      },
    },
  );

  assert.equal(outside.status, "OUTSIDE_SERVICE_AREA");
  assert.equal(invalid.status, "UNAVAILABLE");
  assert.equal(calls, 0);
});

test("point location report includes weather additively and tolerates weather failure", async () => {
  const baseSuitability = {
    success: true,
    found: true,
    location: { tambon: "Mae Ka" },
    clickedPoint: { latitude: 19, longitude: 99 },
  };
  const dependencies = {
    riceSuitabilityService: { getPointSummary: async () => baseSuitability },
    hazardHistoryService: {
      getFloodRecurrence: async () => ({ status: "none_detected", _warnings: [] }),
      getDroughtRecurrence: async () => ({ status: "none_detected", _warnings: [] }),
      buildUnavailableResult: () => ({ status: "unavailable", _warnings: [] }),
    },
    weatherService: {
      getWeatherForLocation: async () => weatherService.normalizeWeatherResponse(validWeatherBody()),
    },
  };

  const report = await locationReportService.getLocationReport({ latitude: 19, longitude: 99 }, dependencies);
  assert.equal(report.weather.status, "AVAILABLE");
  assert.equal(report.found, true);

  const failed = await locationReportService.getLocationReport(
    { latitude: 19, longitude: 99 },
    {
      ...dependencies,
      weatherService: {
        getWeatherForLocation: async () => { throw new Error("weather down"); },
      },
    },
  );
  assert.equal(failed.weather.status, "UNAVAILABLE");
  assert.equal(failed.found, true);
});

test("parcel analysis includes weather from ST_PointOnSurface without exposing geometry", async () => {
  db.query = async (sql) => {
    if (/ST_GeometryType\(geom\)/.test(sql)) {
      return { rows: [{ geometry_type: "ST_MultiPolygon", is_empty: false, is_valid: true, area_sqm: 1600, area_square_meters: 1600, area_rai: 1 }] };
    }
    if (/ST_PointOnSurface/.test(sql)) {
      return { rows: [{ latitude: 19.02, longitude: 99.97 }] };
    }
    if (/MAX\(\(item ->> 'year'\)::int\) AS latest_year/.test(sql)) {
      return { rows: [{ latest_year: 2024 }] };
    }
    if (/FROM gis\.flood_recurrence_pyo/.test(sql)) {
      return { rows: [{ affected_area_square_meters: 0, years_detected: [] }] };
    }
    if (/FROM gis\.drought_recurrence_tambon_pyo/.test(sql)) {
      return { rows: [] };
    }
    return { rows: [] };
  };

  const result = await areaAnalysisService.analyzePolygon(
    {
      name: "parcel",
      geometry: {
        type: "Polygon",
        coordinates: [[[99.9, 19], [99.91, 19], [99.91, 19.01], [99.9, 19.01], [99.9, 19]]],
      },
    },
    {
      weatherService: {
        getWeatherForLocation: async ({ latitude, longitude }) => {
          assert.equal(latitude, 19.02);
          assert.equal(longitude, 99.97);
          return weatherService.normalizeWeatherResponse(validWeatherBody());
        },
      },
    },
  );

  assert.equal(result.weather.status, "AVAILABLE");
  assert.ok(!JSON.stringify(result).includes("representative"));
});
