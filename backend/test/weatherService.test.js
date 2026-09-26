const test = require("node:test");
const assert = require("node:assert/strict");
const weatherService = require("../src/services/weatherService");
const locationReportService = require("../src/services/locationReportService");
const areaAnalysisService = require("../src/services/areaAnalysisService");
const db = require("../src/config/database");

const originalQuery = db.query;
const epoch = (iso) => Date.parse(iso) / 1000;
const localTime = epoch("2026-07-14T17:30:00Z");

function weatherBody(overrides = {}) {
  return {
    location: { tz_id: "Asia/Bangkok", localtime_epoch: localTime },
    current: { temp_c: 28.5, last_updated_epoch: localTime - 900 },
    forecast: { forecastday: [
      { hour: [
        { time_epoch: epoch("2026-07-14T17:00:00Z"), chance_of_rain: 11 },
        { time_epoch: epoch("2026-07-14T18:00:00Z"), chance_of_rain: 82 },
      ] },
      { hour: [{ time_epoch: epoch("2026-07-14T19:00:00Z"), chance_of_rain: 35 }] },
    ] },
    ...overrides,
  };
}

test.afterEach(() => {
  db.query = originalQuery;
  weatherService.clearCache();
});

test("WeatherAPI current temperature and first strictly future hour use Bangkok time", () => {
  const result = weatherService.normalizeWeatherResponse(weatherBody());
  assert.deepEqual(result, {
    status: "AVAILABLE", temperatureC: 28.5,
    nextHourPrecipitationProbabilityPercent: 82,
    nextHourForecastAt: "2026-07-15T01:00:00+07:00",
    updatedAt: "2026-07-15T00:15:00+07:00",
    source: "WeatherAPI",
  });
});

test("next hour selection crosses local midnight and never uses the current hour", () => {
  const nearMidnight = epoch("2026-07-14T16:50:00Z");
  const result = weatherService.normalizeWeatherResponse(weatherBody({
    location: { tz_id: "Asia/Bangkok", localtime_epoch: nearMidnight },
    forecast: { forecastday: [
      { hour: [{ time_epoch: epoch("2026-07-14T16:00:00Z"), chance_of_rain: 10 }] },
      { hour: [{ time_epoch: epoch("2026-07-14T17:00:00Z"), chance_of_rain: 100 }] },
    ] },
  }));
  assert.equal(result.nextHourForecastAt, "2026-07-15T00:00:00+07:00");
  assert.equal(result.nextHourPrecipitationProbabilityPercent, 100);
});

test("zero temperature and zero rain chance are valid", () => {
  const body = weatherBody();
  body.current.temp_c = 0;
  body.forecast.forecastday[0].hour[1].chance_of_rain = 0;
  const result = weatherService.normalizeWeatherResponse(body);
  assert.equal(result.status, "AVAILABLE");
  assert.equal(result.temperatureC, 0);
  assert.equal(result.nextHourPrecipitationProbabilityPercent, 0);
});

test("malformed WeatherAPI fields fail closed without a partial AVAILABLE result", () => {
  for (const mutate of [
    (body) => { body.location.tz_id = "UTC"; },
    (body) => { delete body.location.localtime_epoch; },
    (body) => { delete body.current.temp_c; },
    (body) => { delete body.current.last_updated_epoch; },
    (body) => { body.forecast.forecastday = []; },
    (body) => { body.forecast.forecastday[0].hour[1].chance_of_rain = 101; },
    (body) => { body.forecast.forecastday[0].hour[1].chance_of_rain = "82"; },
    (body) => { body.forecast.forecastday[0].hour[1].time_epoch = null; },
    (body) => { body.current.last_updated_epoch = Number.MAX_SAFE_INTEGER; },
  ]) {
    const body = weatherBody();
    mutate(body);
    assert.equal(weatherService.normalizeWeatherResponse(body).status, "UNAVAILABLE");
  }
  assert.equal(weatherService.normalizeWeatherResponse(null).status, "UNAVAILABLE");
});

test("outside Phayao and invalid coordinates never call WeatherAPI", async () => {
  let calls = 0;
  const options = { env: { WEATHER_API_KEY: "FAKE_WEATHER_KEY_12345" },
    fetchImpl: async () => { calls++; throw new Error("must not run"); } };
  const outside = await weatherService.getWeatherForLocation({ latitude: 18, longitude: 100 },
    { ...options, isInsidePhayao: async () => false });
  const invalid = await weatherService.getWeatherForLocation({ latitude: 100, longitude: 99 }, options);
  assert.deepEqual(outside, {
    status: "OUTSIDE_SERVICE_AREA", temperatureC: null,
    nextHourPrecipitationProbabilityPercent: null, nextHourForecastAt: null,
    updatedAt: null, source: "WeatherAPI",
  });
  assert.equal(invalid.status, "UNAVAILABLE");
  assert.equal(calls, 0);
});

test("point location report includes weather and tolerates failure", async () => {
  const dependencies = {
    riceSuitabilityService: { getPointSummary: async () => ({
      success: true, found: true, location: { tambon: "Mae Ka" },
      clickedPoint: { latitude: 19, longitude: 99 },
    }) },
    hazardHistoryService: {
      getFloodRecurrence: async () => ({ status: "none_detected", _warnings: [] }),
      getDroughtRecurrence: async () => ({ status: "none_detected", _warnings: [] }),
      buildUnavailableResult: () => ({ status: "unavailable", _warnings: [] }),
    },
    weatherService: { getWeatherForLocation: async () =>
      weatherService.normalizeWeatherResponse(weatherBody()) },
  };
  const report = await locationReportService.getLocationReport(
    { latitude: 19, longitude: 99 }, dependencies);
  assert.equal(report.weather.status, "AVAILABLE");
  assert.equal(report.weather.source, "WeatherAPI");
  assert.equal(report.found, true);
  const failed = await locationReportService.getLocationReport(
    { latitude: 19, longitude: 99 }, { ...dependencies,
      weatherService: { getWeatherForLocation: async () => { throw new Error("weather down"); } },
    });
  assert.equal(failed.weather.status, "UNAVAILABLE");
  assert.equal(failed.found, true);
});

test("parcel analysis uses ST_PointOnSurface weather without exposing geometry", async () => {
  db.query = async (sql) => {
    if (/ST_GeometryType\(geom\)/.test(sql)) return { rows: [{
      geometry_type: "ST_MultiPolygon", is_empty: false, is_valid: true,
      area_sqm: 1600, area_square_meters: 1600, area_rai: 1,
    }] };
    if (/ST_PointOnSurface/.test(sql)) return { rows: [{ latitude: 19.02, longitude: 99.97 }] };
    if (/MAX\(\(item ->> 'year'\)::int\) AS latest_year/.test(sql)) {
      return { rows: [{ latest_year: 2024 }] };
    }
    if (/FROM gis\.flood_recurrence_pyo/.test(sql)) {
      return { rows: [{ affected_area_square_meters: 0, years_detected: [] }] };
    }
    return { rows: [] };
  };
  const result = await areaAnalysisService.analyzePolygon({
    name: "parcel", geometry: { type: "Polygon",
      coordinates: [[[99.9, 19], [99.91, 19], [99.91, 19.01], [99.9, 19.01], [99.9, 19]]] },
  }, { weatherService: { getWeatherForLocation: async ({ latitude, longitude }) => {
    assert.deepEqual([latitude, longitude], [19.02, 99.97]);
    return weatherService.normalizeWeatherResponse(weatherBody());
  } } });
  assert.equal(result.weather.status, "AVAILABLE");
  assert.equal(result.weather.source, "WeatherAPI");
  assert.deepEqual(result.representativePoint, { latitude: 19.02, longitude: 99.97 });
});

test("parcel analysis keeps a failed weather request nonfatal", async () => {
  db.query = async (sql) => {
    if (/ST_GeometryType\(geom\)/.test(sql)) return { rows: [{
      is_empty: false, is_valid: true, area_sqm: 1600, area_square_meters: 1600, area_rai: 1,
    }] };
    if (/ST_PointOnSurface/.test(sql)) return { rows: [{ latitude: 19.02, longitude: 99.97 }] };
    return { rows: [] };
  };
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    const result = await areaAnalysisService.analyzePolygon({ name: "parcel", geometry: {
      type: "Polygon", coordinates: [[[99.9, 19], [99.91, 19], [99.91, 19.01], [99.9, 19]]],
    } }, { weatherService: { getWeatherForLocation: async () => { throw new Error("private"); } } });
    assert.equal(result.weather.status, "UNAVAILABLE");
    assert.deepEqual(result.representativePoint, { latitude: 19.02, longitude: 99.97 });
  } finally { console.warn = originalWarn; }
});

test("representative-point failure remains nonfatal and sanitized", async () => {
  db.query = async (sql) => {
    if (/ST_GeometryType\(geom\)/.test(sql)) return { rows: [{
      is_empty: false, is_valid: true, area_sqm: 1600, area_square_meters: 1600, area_rai: 1,
    }] };
    if (/ST_PointOnSurface/.test(sql)) throw new Error("private credentials");
    return { rows: [] };
  };
  const originalWarn = console.warn;
  const events = [];
  console.warn = (...args) => events.push(args);
  try {
    const result = await areaAnalysisService.analyzePolygon({ name: "parcel", geometry: {
      type: "Polygon", coordinates: [[[99.9, 19], [99.91, 19], [99.91, 19.01], [99.9, 19]]],
    } });
    assert.equal(result.representativePoint, null);
    assert.equal(result.weather.status, "UNAVAILABLE");
    assert.deepEqual(events, [["parcel-weather-unavailable", { stage: "representative-point" }]]);
  } finally { console.warn = originalWarn; }
});
