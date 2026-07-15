const test = require("node:test");
const assert = require("node:assert/strict");

const gistdaClient = require("../src/services/gistdaClient");
const hazardHistoryService = require("../src/services/hazardHistoryService");
const locationReportService = require("../src/services/locationReportService");
const locationReportController = require("../src/controllers/locationReportController");
const lineController = require("../src/controllers/lineController");

function floodFeature(properties = {}, geometry = { type: "Polygon", coordinates: [] }) {
  return {
    type: "Feature",
    properties,
    geometry,
  };
}

function floodCollection(features, extra = {}) {
  return {
    type: "FeatureCollection",
    numberMatched: features.length,
    numberReturned: features.length,
    features,
    ...extra,
  };
}

test.beforeEach(() => {
  hazardHistoryService.clearCache();
});

test("flood empty FeatureCollection returns none_detected", async () => {
  const result = await hazardHistoryService.getFloodRecurrence(
    { latitude: 19, longitude: 99 },
    {
      requestJson: async () => ({ body: floodCollection([]) }),
    },
  );

  assert.equal(result.status, "none_detected");
  assert.equal(result.intersects, false);
});

test("flood polygon covers point and normalizes dynamic years", async () => {
  const feature = floodFeature({
    freq: 2,
    area_rai: 10.5,
    pv_idn: 56,
    pv_tn: "จ.พะเยา",
    ap_idn: 5601,
    ap_tn: "อ.เมืองพะเยา",
    tb_idn: 560101,
    tb_tn: "ต.แม่กา",
    y_2020: 1,
    y_2019: 0,
    y_2024: 1,
  });
  const result = await hazardHistoryService.getFloodRecurrence(
    { latitude: 19, longitude: 99 },
    {
      requestJson: async () => ({ body: floodCollection([feature]) }),
      coversPoint: async () => true,
    },
  );

  assert.equal(result.status, "detected");
  assert.deepEqual(result.yearsDetected, [2020, 2024]);
  assert.deepEqual(result.yearlyFrequency.map((item) => item.year), [2019, 2020, 2024]);
  assert.equal(result.frequency, 2);
  assert.equal(result.dataPeriod.startYear, 2019);
  assert.equal(result.dataPeriod.endYear, 2024);
  assert.equal(result.administrativeArea.subdistrict.name, "ต.แม่กา");
});

test("flood bbox candidate outside exact point is not detected", async () => {
  const result = await hazardHistoryService.getFloodRecurrence(
    { latitude: 19, longitude: 99 },
    {
      requestJson: async () => ({ body: floodCollection([floodFeature({ freq: 5, y_2024: 1 })]) }),
      coversPoint: async () => false,
    },
  );

  assert.equal(result.status, "none_detected");
  assert.equal(result.intersects, false);
});

test("flood MultiPolygon boundary match uses coversPoint result", async () => {
  const feature = floodFeature(
    { freq: 1, y_2024: 1 },
    { type: "MultiPolygon", coordinates: [] },
  );
  const result = await hazardHistoryService.getFloodRecurrence(
    { latitude: 19, longitude: 99 },
    {
      requestJson: async () => ({ body: floodCollection([feature]) }),
      coversPoint: async () => true,
    },
  );

  assert.equal(result.status, "detected");
});

test("flood point in polygon hole follows exact coversPoint result", async () => {
  const result = await hazardHistoryService.getFloodRecurrence(
    { latitude: 19, longitude: 99 },
    {
      requestJson: async () => ({ body: floodCollection([floodFeature({ freq: 1, y_2024: 1 })]) }),
      coversPoint: async () => false,
    },
  );

  assert.equal(result.status, "none_detected");
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

test("flood multiple covering features select highest freq", async () => {
  const result = await hazardHistoryService.getFloodRecurrence(
    { latitude: 19, longitude: 99 },
    {
      requestJson: async () => ({ body: floodCollection([
        floodFeature({ freq: 1, y_2020: 1 }),
        floodFeature({ freq: 3, y_2020: 1, y_2021: 1, y_2022: 1 }),
      ]) }),
      coversPoint: async () => true,
    },
  );

  assert.equal(result.frequency, 3);
  assert.ok(result._warnings.includes("MULTIPLE_MATCHING_FEATURES"));
});

test("flood pagination follows numberMatched", async () => {
  const offsets = [];
  const result = await hazardHistoryService.getFloodRecurrence(
    { latitude: 19, longitude: 99 },
    {
      requestJson: async (path, options) => {
        offsets.push(Number(options.query.offset));
        if (options.query.offset === 0) {
          return { body: floodCollection([floodFeature({ freq: 1, y_2020: 1 })], { numberMatched: 2, numberReturned: 1 }) };
        }
        return { body: floodCollection([floodFeature({ freq: 2, y_2021: 1, y_2022: 1 })], { numberMatched: 2, numberReturned: 1 }) };
      },
      coversPoint: async () => true,
    },
  );

  assert.deepEqual(offsets, [0, 1]);
  assert.equal(result.frequency, 2);
});

test("flood pagination safety cap returns unavailable", async () => {
  const features = Array.from({ length: 1000 }, () => floodFeature({ freq: 1, y_2020: 1 }));
  const result = await hazardHistoryService.getFloodRecurrence(
    { latitude: 19, longitude: 99 },
    {
      requestJson: async (path, options) => ({
        body: floodCollection(features, {
          numberMatched: hazardHistoryService.FLOOD_FEATURE_CAP + 1,
          numberReturned: 1000,
        }),
      }),
      coversPoint: async () => true,
    },
  );

  assert.equal(result.status, "unavailable");
});

test("flood invalid GeoJSON and unsupported geometry return unavailable", async () => {
  const invalid = await hazardHistoryService.getFloodRecurrence(
    { latitude: 19, longitude: 99 },
    { requestJson: async () => ({ body: { type: "FeatureCollection", features: null } }) },
  );
  hazardHistoryService.clearCache();
  const unsupported = await hazardHistoryService.getFloodRecurrence(
    { latitude: 19, longitude: 99 },
    { requestJson: async () => ({ body: floodCollection([floodFeature({ freq: 1 }, { type: "Point", coordinates: [99, 19] })]) }) },
  );

  assert.equal(invalid.status, "unavailable");
  assert.equal(unsupported.status, "unavailable");
});

test("drought empty array returns none_detected", async () => {
  const result = await hazardHistoryService.getDroughtRecurrence(
    { latitude: 19, longitude: 99 },
    { requestJson: async () => ({ body: [] }) },
  );

  assert.equal(result.status, "none_detected");
});

test("drought valid record maps years and total", async () => {
  const result = await hazardHistoryService.getDroughtRecurrence(
    { latitude: 19, longitude: 99 },
    {
      requestJson: async () => ({ body: [{
        province_name: "พะเยา",
        district_name: "เมืองพะเยา",
        subdistrict_name: "แม่กา",
        total: 2,
        detail: [
          { year: "2023", freq: 1 },
          { year: "2019", freq: 1 },
          { year: "2018", freq: 0 },
        ],
      }] }),
    },
  );

  assert.equal(result.status, "detected");
  assert.equal(result.totalOccurrences, 2);
  assert.deepEqual(result.yearsDetected, [2019, 2023]);
  assert.equal(result.dataPeriod.startYear, 2018);
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

test("drought multiple records select highest total", async () => {
  const result = await hazardHistoryService.getDroughtRecurrence(
    { latitude: 19, longitude: 99 },
    {
      requestJson: async () => ({ body: [
        { total: 1, detail: [{ year: "2020", freq: 1 }] },
        { total: 3, detail: [{ year: "2021", freq: 3 }] },
      ] }),
    },
  );

  assert.equal(result.totalOccurrences, 3);
  assert.ok(result._warnings.includes("MULTIPLE_DROUGHT_RECORDS"));
});

test("drought invalid JSON shape returns unavailable", async () => {
  const result = await hazardHistoryService.getDroughtRecurrence(
    { latitude: 19, longitude: 99 },
    { requestJson: async () => ({ body: { total: 1 } }) },
  );

  assert.equal(result.status, "unavailable");
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

test("combined report keeps suitability when hazards succeed or fail", async () => {
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
    },
  );
  const bothFail = await locationReportService.getLocationReport(
    { latitude: 19, longitude: 99 },
    {
      riceSuitabilityService: { getPointSummary: async () => baseSuitability },
      hazardHistoryService: {
        getFloodRecurrence: async () => { throw new Error("flood fail"); },
        getDroughtRecurrence: async () => { throw new Error("drought fail"); },
        buildUnavailableResult: hazardHistoryService.buildUnavailableResult,
      },
    },
  );

  assert.equal(success.hazardHistory.floodRecurrence.status, "none_detected");
  assert.equal(floodFails.hazardHistory.floodRecurrence.status, "unavailable");
  assert.equal(droughtFails.hazardHistory.droughtRecurrence.status, "unavailable");
  assert.equal(bothFail.found, true);
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

test("normalized response contains no geometry or secret", async () => {
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
    },
  );
  const serialized = JSON.stringify(report);

  assert.ok(!serialized.includes("coordinates"));
  assert.ok(!serialized.includes("geometry"));
  assert.ok(!serialized.includes("GISTDA_API_KEY"));
  assert.ok(!serialized.includes("_id"));
});
