const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const gistdaClient = require("../src/services/gistdaClient");
const hazardHistoryService = require("../src/services/hazardHistoryService");
const locationReportService = require("../src/services/locationReportService");
const locationReportController = require("../src/controllers/locationReportController");
const lineController = require("../src/controllers/lineController");

const hazardHistorySource = fs.readFileSync(
  path.join(__dirname, "../src/services/hazardHistoryService.js"),
  "utf8",
);

function floodFeature(properties = {}, geometry = { type: "Polygon", coordinates: [] }) {
  return {
    type: "Feature",
    properties,
    geometry,
  };
}

function createMockDb(rows = [], options = {}) {
  const calls = [];
  return {
    calls,
    query: async (text, params) => {
      calls.push({ text, params });
      if (options.error) {
        throw options.error;
      }
      return { rows };
    },
  };
}

function floodDbRow(overrides = {}) {
  return {
    freq: 3,
    area_rai: 10.5,
    province_id: 56,
    province_name: "จ.พะเยา",
    district_id: 5601,
    district_name: "อ.เมืองพะเยา",
    subdistrict_id: 560101,
    subdistrict_name: "ต.แม่กา",
    start_year: 2015,
    end_year: 2024,
    years_detected: [2020, 2022, 2024],
    yearly_frequency: [
      { year: 2020, frequency: 1 },
      { year: 2022, frequency: 1 },
      { year: 2024, frequency: 1 },
    ],
    ...overrides,
  };
}

function droughtDbRow(overrides = {}) {
  return {
    tambon_name: "แม่กา",
    district_name: "เมืองพะเยา",
    province_name: "พะเยา",
    total_occurrences: 2,
    years_detected: [2019, 2023],
    yearly_frequency: [
      { year: 2019, frequency: 1 },
      { year: 2023, frequency: 1 },
    ],
    start_year: 2018,
    end_year: 2024,
    response_status: "success",
    source: "GISTDA",
    ...overrides,
  };
}

test.beforeEach(() => {
  hazardHistoryService.clearCache();
});

test("flood successful empty database result returns none_detected", async () => {
  const mockDb = createMockDb([]);
  const result = await hazardHistoryService.getFloodRecurrence(
    { latitude: 19, longitude: 99 },
    { db: mockDb },
  );

  assert.equal(result.status, "none_detected");
  assert.equal(result.intersects, false);
  assert.deepEqual(mockDb.calls[0].params, [99, 19, hazardHistoryService.FLOOD_WINDOW_YEARS]);
  assert.match(mockDb.calls[0].text, /ST_MakePoint\(\$1::double precision, \$2::double precision\)/);
  assert.match(mockDb.calls[0].text, /ST_SetSRID\(ST_MakePoint\(\$1::double precision, \$2::double precision\), 4326\) AS geom_4326/);
  assert.match(mockDb.calls[0].text, /ST_Covers\(\s*f\.geom,\s*p\.geom_4326\s*\)/);
  assert.doesNotMatch(mockDb.calls[0].text, /geom_32647|ST_Transform\([\s\S]*32647/);
  assert.doesNotMatch(mockDb.calls[0].text, /ST_Area\(/);
});

test("flood database match returns detected recurrence with safe fields", async () => {
  const result = await hazardHistoryService.getFloodRecurrence(
    { latitude: 19, longitude: 99 },
    { db: createMockDb([floodDbRow()]) },
  );

  assert.equal(result.status, "detected");
  assert.deepEqual(result.yearsDetected, [2020, 2022, 2024]);
  assert.deepEqual(result.yearlyFrequency.map((item) => item.year), [2020, 2022, 2024]);
  assert.equal(result.frequency, 3);
  assert.equal(result.dataPeriod.startYear, 2015);
  assert.equal(result.dataPeriod.endYear, 2024);
  assert.equal(result.administrativeArea.subdistrict.name, "ต.แม่กา");
  assert.equal(result.source, "GISTDA");
  assert.ok(result.checkedAt);
});

test("flood database result is cached by rounded point", async () => {
  const mockDb = createMockDb([floodDbRow()]);

  await hazardHistoryService.getFloodRecurrence({ latitude: 19, longitude: 99 }, { db: mockDb });
  await hazardHistoryService.getFloodRecurrence({ latitude: 19, longitude: 99 }, { db: mockDb });

  assert.equal(mockDb.calls.length, 1);
});

test("flood database errors return unavailable with safe diagnostics", async () => {
  const relationMissing = createMockDb([], { error: { code: "42P01", message: "relation missing raw sql" } });
  const columnMissing = createMockDb([], { error: { code: "42703", message: "column missing raw sql" } });
  const timeout = createMockDb([], { error: { code: "57014", message: "statement timeout with raw sql" } });
  const generic = createMockDb([], { error: new Error("database password should not leak") });

  const missingRelation = await hazardHistoryService.getFloodRecurrence(
    { latitude: 19, longitude: 99 },
    { db: relationMissing },
  );
  hazardHistoryService.clearCache();
  const missingColumn = await hazardHistoryService.getFloodRecurrence(
    { latitude: 19, longitude: 99 },
    { db: columnMissing },
  );
  hazardHistoryService.clearCache();
  const timedOut = await hazardHistoryService.getFloodRecurrence(
    { latitude: 19, longitude: 99 },
    { db: timeout },
  );
  hazardHistoryService.clearCache();
  const queryFailed = await hazardHistoryService.getFloodRecurrence(
    { latitude: 19, longitude: 99 },
    { db: generic },
  );

  assert.equal(missingRelation.status, "unavailable");
  assert.deepEqual(missingRelation._warnings, ["flood-db-relation-missing"]);
  assert.deepEqual(missingColumn._warnings, ["flood-db-column-missing"]);
  assert.deepEqual(timedOut._warnings, ["flood-db-timeout"]);
  assert.deepEqual(queryFailed._warnings, ["flood-db-query-failed"]);
  assert.equal(JSON.stringify(queryFailed).includes("database password"), false);
});

test("flood invalid coordinates return unavailable without querying", async () => {
  const mockDb = createMockDb([floodDbRow()]);
  const result = await hazardHistoryService.getFloodRecurrence(
    { latitude: 91, longitude: 99 },
    { db: mockDb },
  );

  assert.equal(result.status, "unavailable");
  assert.deepEqual(result._warnings, ["INVALID_LOCATION"]);
  assert.equal(mockDb.calls.length, 0);
});

test("flood frequency mismatch retains official frequency and warns", () => {
  const result = hazardHistoryService.normalizeFloodFeature(floodFeature({
    freq: 7,
    y_2022: 1,
    y_2023: 1,
  }));

  assert.equal(result.frequency, 7);
  assert.deepEqual(result.yearsDetected, [2022, 2023]);
  assert.ok(result._warnings.includes("FREQUENCY_MISMATCH"));
});

test("drought successful empty tambon response returns none_detected", async () => {
  const result = await hazardHistoryService.getDroughtRecurrence(
    { latitude: 19, longitude: 99 },
    { db: createMockDb([droughtDbRow({
      response_status: "empty",
      total_occurrences: null,
      years_detected: [],
      yearly_frequency: [],
      start_year: null,
      end_year: null,
    })]) },
  );

  assert.equal(result.status, "none_detected");
});

test("drought point outside synced tambon coverage returns no_coverage", async () => {
  const result = await hazardHistoryService.getDroughtRecurrence(
    { latitude: 19, longitude: 99 },
    { db: createMockDb([]) },
  );

  assert.equal(result.status, "no_coverage");
  assert.deepEqual(result._warnings, ["drought-admin-area-not-found"]);
});

test("drought database match maps years and total", async () => {
  const mockDb = createMockDb([droughtDbRow()]);
  const result = await hazardHistoryService.getDroughtRecurrence(
    { latitude: 19, longitude: 99 },
    { db: mockDb },
  );

  assert.equal(result.status, "detected");
  assert.equal(result.totalOccurrences, 2);
  assert.deepEqual(result.yearsDetected, [2019, 2023]);
  assert.equal(result.dataPeriod.startYear, 2018);
  assert.equal(result.administrativeArea.subdistrict.name, "แม่กา");
  assert.equal(result.source, "GISTDA");
  assert.ok(result.checkedAt);
  assert.deepEqual(mockDb.calls[0].params, [99, 19]);
  assert.match(mockDb.calls[0].text, /ST_MakePoint\(\$1::double precision, \$2::double precision\)/);
  assert.match(mockDb.calls[0].text, /ST_SetSRID\(ST_MakePoint\(\$1::double precision, \$2::double precision\), 4326\) AS geom_4326/);
  assert.match(mockDb.calls[0].text, /ST_Covers\(\s*d\.geom,\s*p\.geom_4326\s*\)/);
  assert.doesNotMatch(mockDb.calls[0].text, /geom_32647|ST_Transform\([\s\S]*32647/);
  assert.doesNotMatch(mockDb.calls[0].text, /ST_Area\(/);
});

test("drought database result is cached by rounded point", async () => {
  const mockDb = createMockDb([droughtDbRow()]);

  await hazardHistoryService.getDroughtRecurrence({ latitude: 19, longitude: 99 }, { db: mockDb });
  await hazardHistoryService.getDroughtRecurrence({ latitude: 19, longitude: 99 }, { db: mockDb });

  assert.equal(mockDb.calls.length, 1);
});

test("drought total may differ from detected year count", () => {
  const result = hazardHistoryService.normalizeDroughtRecord({
    total: 4,
    detail: [{ year: "2020", freq: 3 }, { year: "2021", freq: 1 }],
  });

  assert.equal(result.totalOccurrences, 4);
  assert.deepEqual(result.yearsDetected, [2020, 2021]);
});

test("drought malformed year/freq is skipped and warned", () => {
  const result = hazardHistoryService.normalizeDroughtRecord({
    total: 1,
    detail: [{ year: "bad", freq: 1 }, { year: "2021", freq: "bad" }],
  });

  assert.deepEqual(result.yearlyFrequency, []);
  assert.ok(result._warnings.includes("MALFORMED_DROUGHT_YEARLY_VALUE"));
});

test("drought stored upstream failure remains unavailable", async () => {
  const result = await hazardHistoryService.getDroughtRecurrence(
    { latitude: 19, longitude: 99 },
    { db: createMockDb([droughtDbRow({ response_status: "UPSTREAM_503" })]) },
  );

  assert.equal(result.status, "unavailable");
  assert.deepEqual(result._warnings, ["drought-source-stored-unavailable"]);
});

test("drought database errors return unavailable with safe diagnostics", async () => {
  const relationMissing = createMockDb([], { error: { code: "42P01", message: "relation missing raw sql" } });
  const columnMissing = createMockDb([], { error: { code: "42703", message: "column missing raw sql" } });
  const timeout = createMockDb([], { error: { code: "57014", message: "statement timeout with raw sql" } });
  const generic = createMockDb([], { error: new Error("database password should not leak") });

  const missingRelation = await hazardHistoryService.getDroughtRecurrence(
    { latitude: 19, longitude: 99 },
    { db: relationMissing },
  );
  hazardHistoryService.clearCache();
  const missingColumn = await hazardHistoryService.getDroughtRecurrence(
    { latitude: 19, longitude: 99 },
    { db: columnMissing },
  );
  hazardHistoryService.clearCache();
  const timedOut = await hazardHistoryService.getDroughtRecurrence(
    { latitude: 19, longitude: 99 },
    { db: timeout },
  );
  hazardHistoryService.clearCache();
  const queryFailed = await hazardHistoryService.getDroughtRecurrence(
    { latitude: 19, longitude: 99 },
    { db: generic },
  );

  assert.equal(missingRelation.status, "unavailable");
  assert.deepEqual(missingRelation._warnings, ["drought-db-relation-missing"]);
  assert.deepEqual(missingColumn._warnings, ["drought-db-column-missing"]);
  assert.deepEqual(timedOut._warnings, ["drought-db-timeout"]);
  assert.deepEqual(queryFailed._warnings, ["drought-db-query-failed"]);
  assert.equal(JSON.stringify(queryFailed).includes("database password"), false);
});

test("point hazard runtime uses local PostGIS tables instead of the live GISTDA client", () => {
  assert.doesNotMatch(hazardHistorySource, /require\("\.\/gistdaClient"\)/);
  assert.doesNotMatch(hazardHistorySource, /requestJson\(/);
  assert.doesNotMatch(hazardHistorySource, /GISTDA_API_KEY/);
  assert.match(hazardHistorySource, /gis\.flood_recurrence_pyo/);
  assert.match(hazardHistorySource, /gis\.drought_recurrence_tambon_pyo/);
});

test("gistda client handles missing key and upstream errors without exposing secrets", async () => {
  const original = process.env.GISTDA_API_KEY;
  delete process.env.GISTDA_API_KEY;
  await assert.rejects(
    () => gistdaClient.requestJson("/test", { fetchImpl: async () => { throw new Error("should not fetch"); } }),
    { code: "MISSING_API_KEY" },
  );
  process.env.GISTDA_API_KEY = "test-key";

  for (const status of [401, 403, 407, 429, 500, 503]) {
    await assert.rejects(
      () => gistdaClient.requestJson("/test", {
        fetchImpl: async () => ({
          ok: false,
          status,
          headers: { get: () => "application/json" },
          text: async () => "{}",
        }),
      }),
      { code: `UPSTREAM_${status}` },
    );
  }

  await assert.rejects(
    () => gistdaClient.requestJson("/test", {
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        headers: { get: () => "application/json" },
        text: async () => "{",
      }),
    }),
    { code: "INVALID_JSON" },
  );

  await assert.rejects(
    () => gistdaClient.requestJson("/test", {
      fetchImpl: async () => {
        throw new Error("network down");
      },
    }),
    { code: "UPSTREAM_NETWORK_ERROR" },
  );

  await assert.rejects(
    () => gistdaClient.requestJson("/test", {
      timeoutMs: 1,
      fetchImpl: async (url, options) => new Promise((resolve, reject) => {
        options.signal.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      }),
    }),
    { code: "UPSTREAM_TIMEOUT" },
  );

  if (original === undefined) {
    delete process.env.GISTDA_API_KEY;
  } else {
    process.env.GISTDA_API_KEY = original;
  }
});

test("combined report keeps suitability when hazards succeed or fail independently", async () => {
  const baseSuitability = {
    success: true,
    found: true,
    location: { tambon: "แม่กา" },
    clickedPoint: { latitude: 19, longitude: 99 },
  };
  const success = await locationReportService.getLocationReport(
    { latitude: 19, longitude: 99 },
    {
      riceSuitabilityService: { getPointSummary: async () => baseSuitability },
      hazardHistoryService: {
        getFloodRecurrence: async () => hazardHistoryService.buildNoFloodResult(),
        getDroughtRecurrence: async () => hazardHistoryService.buildNoDroughtResult(),
        buildUnavailableResult: hazardHistoryService.buildUnavailableResult,
      },
      logger: { warn: () => {} },
    },
  );
  const floodFails = await locationReportService.getLocationReport(
    { latitude: 19, longitude: 99 },
    {
      riceSuitabilityService: { getPointSummary: async () => baseSuitability },
      hazardHistoryService: {
        getFloodRecurrence: async () => { throw new Error("flood fail"); },
        getDroughtRecurrence: async () => hazardHistoryService.buildNoDroughtResult(),
        buildUnavailableResult: hazardHistoryService.buildUnavailableResult,
      },
      logger: { warn: () => {} },
    },
  );
  const droughtFails = await locationReportService.getLocationReport(
    { latitude: 19, longitude: 99 },
    {
      riceSuitabilityService: { getPointSummary: async () => baseSuitability },
      hazardHistoryService: {
        getFloodRecurrence: async () => hazardHistoryService.buildNoFloodResult(),
        getDroughtRecurrence: async () => { throw new Error("drought fail"); },
        buildUnavailableResult: hazardHistoryService.buildUnavailableResult,
      },
      logger: { warn: () => {} },
    },
  );
  const bothEmpty = await locationReportService.getLocationReport(
    { latitude: 19, longitude: 99 },
    {
      riceSuitabilityService: { getPointSummary: async () => baseSuitability },
      hazardHistoryService: {
        getFloodRecurrence: async () => hazardHistoryService.buildNoFloodResult(),
        getDroughtRecurrence: async () => hazardHistoryService.buildNoDroughtResult(),
        buildUnavailableResult: hazardHistoryService.buildUnavailableResult,
      },
      logger: { warn: () => {} },
    },
  );

  assert.equal(success.hazardHistory.floodRecurrence.status, "none_detected");
  assert.equal(floodFails.hazardHistory.floodRecurrence.status, "unavailable");
  assert.equal(floodFails.hazardHistory.droughtRecurrence.status, "none_detected");
  assert.equal(droughtFails.hazardHistory.floodRecurrence.status, "none_detected");
  assert.equal(droughtFails.hazardHistory.droughtRecurrence.status, "unavailable");
  assert.equal(bothEmpty.hazardHistory.floodRecurrence.status, "none_detected");
  assert.equal(bothEmpty.hazardHistory.droughtRecurrence.status, "none_detected");
});

test("location report strips internal warnings but keeps sanitized partial error categories", async () => {
  const warnings = [];
  const report = await locationReportService.getLocationReport(
    { latitude: 19, longitude: 99 },
    {
      riceSuitabilityService: { getPointSummary: async () => ({ success: true, found: true }) },
      hazardHistoryService: {
        getFloodRecurrence: async () => hazardHistoryService.buildUnavailableResult("flood", "flood-db-relation-missing"),
        getDroughtRecurrence: async () => hazardHistoryService.buildUnavailableResult("drought", "drought-db-timeout"),
        buildUnavailableResult: hazardHistoryService.buildUnavailableResult,
      },
      logger: {
        warn: (message) => warnings.push(JSON.parse(message)),
      },
    },
  );
  const serialized = JSON.stringify(report);

  assert.equal(report.hazardHistory.floodRecurrence.status, "unavailable");
  assert.equal(report.hazardHistory.droughtRecurrence.status, "unavailable");
  assert.equal(serialized.includes("_warnings"), false);
  assert.deepEqual(
    report.partialErrors.map((item) => item.code),
    ["flood-db-relation-missing", "drought-db-timeout"],
  );
  assert.equal(serialized.includes("relation missing raw sql"), false);
  assert.equal(serialized.includes("statement timeout"), false);
  assert.deepEqual(warnings, [
    {
      event: "hazard-history-diagnostic",
      source: "GISTDA",
      dataset: "flood_recurrence",
      code: "flood-db-relation-missing",
    },
    {
      event: "hazard-history-diagnostic",
      source: "GISTDA",
      dataset: "drought_recurrence",
      code: "drought-db-timeout",
    },
  ]);
  assert.equal(JSON.stringify(warnings).includes("19"), false);
  assert.equal(JSON.stringify(warnings).includes("99"), false);
});

test("combined report can retain hazards when suitability fails", async () => {
  const report = await locationReportService.getLocationReport(
    { latitude: 19, longitude: 99 },
    {
      riceSuitabilityService: { getPointSummary: async () => { throw new Error("suitability fail"); } },
      hazardHistoryService: {
        getFloodRecurrence: async () => hazardHistoryService.buildNoFloodResult(),
        getDroughtRecurrence: async () => hazardHistoryService.buildNoDroughtResult(),
        buildUnavailableResult: hazardHistoryService.buildUnavailableResult,
      },
      logger: { warn: () => {} },
    },
  );

  assert.equal(report.success, true);
  assert.equal(report.found, false);
  assert.ok(report.hazardHistory);
  assert.equal(report.partialErrors[0].code, "SUITABILITY_UNAVAILABLE");
});

test("normal endpoint validation rejects invalid coordinates", () => {
  assert.equal(locationReportController.validateLocationQuery({ lat: "", lng: "99" }).error, "lat is required and must be a valid number");
  assert.equal(locationReportController.validateLocationQuery({ lat: "91", lng: "99" }).error, "lat must be between -90 and 90");
});

test("LIFF token verification remains required", () => {
  const validation = lineController.validateLocationAnalysisBody({
    lat: 19,
    lng: 99,
  });

  assert.equal(validation.error, "idToken is required and must be a non-empty string");
});

test("normalized response contains no geometry, secret, raw error, or exact coordinate log", async () => {
  const report = await locationReportService.getLocationReport(
    { latitude: 19, longitude: 99 },
    {
      riceSuitabilityService: { getPointSummary: async () => ({ success: true, found: true }) },
      hazardHistoryService: {
        getFloodRecurrence: async () => hazardHistoryService.normalizeFloodFeature(floodFeature({
          freq: 1,
          y_2020: 1,
          _id: "hidden",
        })),
        getDroughtRecurrence: async () => hazardHistoryService.normalizeDroughtRecord({
          total: 1,
          detail: [{ year: "2020", freq: 1 }],
        }),
        buildUnavailableResult: hazardHistoryService.buildUnavailableResult,
      },
      logger: { warn: () => {} },
    },
  );
  const serialized = JSON.stringify(report);

  assert.ok(!serialized.includes("coordinates"));
  assert.ok(!serialized.includes("geometry"));
  assert.ok(!serialized.includes("GISTDA_API_KEY"));
  assert.ok(!serialized.includes("_id"));
  assert.ok(!serialized.includes("Authorization"));
  assert.ok(!serialized.includes("LINE"));
});
