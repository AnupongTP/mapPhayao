const test = require("node:test");
const assert = require("node:assert/strict");

const db = require("../src/config/database");
const hazardLayerService = require("../src/services/hazardLayerService");

const originalQuery = db.query;

test.afterEach(() => {
  db.query = originalQuery;
  hazardLayerService.clearCache();
});

function mockFloodQueries({
  latestYear = 2024,
  years,
  count = 1,
  rows = [],
} = {}) {
  const calls = [];
  const selectedYears = Array.isArray(years)
    ? years
    : Array.from({ length: 5 }, (_, index) => latestYear - 4 + index);
  db.query = async (sql, params) => {
    calls.push({ sql, params });
    if (calls.length === 1) {
      return {
        rows: [{
          start_year: selectedYears[0],
          end_year: selectedYears[selectedYears.length - 1],
          years: selectedYears,
        }],
      };
    }
    if (calls.length === 2) {
      return { rows: [{ count }] };
    }
    return { rows };
  };
  return calls;
}

function floodRow(properties) {
  return {
    properties,
    geometry: JSON.stringify({
      type: "MultiPolygon",
      coordinates: [[[[99, 19], [100, 19], [100, 20], [99, 19]]]],
    }),
  };
}

test("parseBbox accepts valid longitude latitude bounds", () => {
  const result = hazardLayerService.parseBbox("99.9,19.0,100.0,19.1");

  assert.deepEqual(result.bbox, {
    minLng: 99.9,
    minLat: 19,
    maxLng: 100,
    maxLat: 19.1,
  });
});

test("parseBbox rejects invalid bounds", () => {
  assert.match(hazardLayerService.parseBbox("99,19,98,20").error, /min values/);
  assert.match(hazardLayerService.parseBbox("99,19,100").error, /must contain/);
  assert.match(hazardLayerService.parseBbox("181,19,182,20").error, /outside/);
});

test("flood layer validates bbox before querying database", async () => {
  let queried = false;
  db.query = async () => {
    queried = true;
    return { rows: [] };
  };

  await assert.rejects(
    () => hazardLayerService.getFloodRecurrenceLayer({ bbox: "bad", zoom: 12 }),
    /bbox must contain/,
  );
  assert.equal(queried, false);
});

test("flood latest five available years are detected dynamically", async () => {
  db.query = async (sql, params) => {
    assert.deepEqual(params, [5]);
    return { rows: [{ start_year: 2020, end_year: 2024, years: [2020, 2021, 2022, 2023, 2024] }] };
  };

  const result = await hazardLayerService.getFloodYearWindow(5);

  assert.deepEqual(result, {
    startYear: 2020,
    endYear: 2024,
    years: [2020, 2021, 2022, 2023, 2024],
  });
});

test("flood latest five-year window uses available source years, not current calendar", async () => {
  db.query = async () => ({
    rows: [{ start_year: 2019, end_year: 2025, years: [2019, 2021, 2022, 2024, 2025] }],
  });

  const result = await hazardLayerService.getFloodYearWindow(5);

  assert.deepEqual(result, {
    startYear: 2019,
    endYear: 2025,
    years: [2019, 2021, 2022, 2024, 2025],
  });
});

test("shared flood year-window helper keeps the 10-year default for non-layer consumers", async () => {
  db.query = async (sql, params) => {
    assert.deepEqual(params, [10]);
    return {
      rows: [{
        start_year: 2015,
        end_year: 2024,
        years: [2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024],
      }],
    };
  };

  const result = await hazardLayerService.getFloodYearWindow();

  assert.equal(result.startYear, 2015);
  assert.equal(result.endYear, 2024);
  assert.equal(result.years.length, 10);
});

test("flood layer returns latest-five-year safe display properties without raw metadata", async () => {
  const calls = mockFloodQueries({
    latestYear: 2024,
    count: 1,
    rows: [floodRow({
      frequency: 1,
      yearsDetected: [2024],
      startYear: 2020,
      endYear: 2024,
      areaRai: 10.5,
      province: "Phayao",
      district: "Mueang Phayao",
      subdistrict: "Mae Ka",
      source: "GISTDA",
    })],
  });

  const result = await hazardLayerService.getFloodRecurrenceLayer({
    bbox: "99.9,19.0,100.0,19.1",
    zoom: 12,
  });

  assert.equal(result.type, "FeatureCollection");
  assert.deepEqual(result.properties, {
    startYear: 2020,
    endYear: 2024,
    years: [2020, 2021, 2022, 2023, 2024],
    yearCount: 5,
  });
  assert.equal(result.features.length, 1);
  assert.equal(result.features[0].properties.startYear, 2020);
  assert.equal(result.features[0].properties.endYear, 2024);
  assert.deepEqual(result.features[0].properties.yearsDetected, [2024]);
  assert.equal(
    result.features[0].properties.frequency,
    result.features[0].properties.yearsDetected.length,
  );
  assert.deepEqual(Object.keys(result.features[0].properties).sort(), [
    "areaRai",
    "district",
    "endYear",
    "frequency",
    "province",
    "source",
    "startYear",
    "subdistrict",
    "yearsDetected",
  ]);
  assert.equal(result.features[0].properties._id, undefined);
  assert.equal(result.features[0].properties.shape_area, undefined);
  assert.deepEqual(calls[1].params[4], [2020, 2021, 2022, 2023, 2024]);
  assert.deepEqual(calls[2].params.slice(4, 7), [
    [2020, 2021, 2022, 2023, 2024],
    2020,
    2024,
  ]);
});

test("flood layer uses future dynamic latest-five-year query parameters", async () => {
  const calls = mockFloodQueries({ latestYear: 2025, count: 0, rows: [] });

  const result = await hazardLayerService.getFloodRecurrenceLayer({
    bbox: "99.9,19.0,100.0,19.1",
    zoom: 12,
  });

  assert.equal(result.features.length, 0);
  assert.deepEqual(calls[1].params[4], [2021, 2022, 2023, 2024, 2025]);
  assert.deepEqual(calls[2].params.slice(4, 7), [
    [2021, 2022, 2023, 2024, 2025],
    2021,
    2025,
  ]);
});

test("flood layer excludes records without latest-window detections", async () => {
  const calls = mockFloodQueries({ latestYear: 2024, count: 0, rows: [] });

  const result = await hazardLayerService.getFloodRecurrenceLayer({
    bbox: "99.9,19.0,100.0,19.1",
    zoom: 12,
  });

  assert.equal(result.features.length, 0);
  assert.match(calls[1].sql, /= ANY\(\$5::int\[\]\)/);
  assert.match(calls[2].sql, /w\.frequency > 0/);
});

test("flood layer includes only detected years inside the latest window", async () => {
  const calls = mockFloodQueries({
    latestYear: 2024,
    count: 1,
    rows: [floodRow({
      frequency: 1,
      yearsDetected: [2024],
      startYear: 2020,
      endYear: 2024,
      areaRai: null,
      province: null,
      district: null,
      subdistrict: null,
      source: "GISTDA",
    })],
  });

  const result = await hazardLayerService.getFloodRecurrenceLayer({
    bbox: "99.9,19.0,100.0,19.1",
    zoom: 12,
  });

  assert.deepEqual(result.features[0].properties.yearsDetected, [2024]);
  assert.equal(result.features[0].properties.frequency, 1);
  assert.match(calls[2].sql, /COUNT\(DISTINCT year_value\)::int AS frequency/);
  assert.match(calls[2].sql, /= ANY\(flood_window\.years\)/);
  assert.match(calls[2].sql, /CASE[\s\S]+frequency[\s\S]+ELSE 0/);
});

test("flood layer keeps returned years numeric unique and sorted", async () => {
  mockFloodQueries({
    latestYear: 2024,
    count: 1,
    rows: [floodRow({
      frequency: 2,
      yearsDetected: [2020, 2024],
      startYear: 2020,
      endYear: 2024,
      areaRai: null,
      province: null,
      district: null,
      subdistrict: null,
      source: "GISTDA",
    })],
  });

  const result = await hazardLayerService.getFloodRecurrenceLayer({
    bbox: "99.9,19.0,100.0,19.1",
    zoom: 12,
  });

  const years = result.features[0].properties.yearsDetected;
  assert.deepEqual(years, [2020, 2024]);
  assert.equal(new Set(years).size, years.length);
  assert.ok(years.every((year) => Number.isInteger(year)));
});

test("flood layer rejects extents above feature cap", async () => {
  mockFloodQueries({ latestYear: 2024, count: 5001 });

  await assert.rejects(
    () => hazardLayerService.getFloodRecurrenceLayer({
      bbox: "99.9,19.0,100.0,19.1",
      zoom: 12,
    }),
    /too many/,
  );
});

test("drought layer returns tambon-level safe properties", async () => {
  db.query = async () => ({
    rows: [{
      properties: {
        totalOccurrences: 2,
        yearsDetected: [2019, 2023],
        startYear: 2018,
        endYear: 2023,
        tambon: "Mae Ka",
        district: "Mueang Phayao",
        province: "Phayao",
        source: "GISTDA",
        summaryLevel: "tambon",
      },
      geometry: JSON.stringify({
        type: "MultiPolygon",
        coordinates: [[[[99, 19], [100, 19], [100, 20], [99, 19]]]],
      }),
    }],
  });

  const result = await hazardLayerService.getDroughtRecurrenceLayer();

  assert.equal(result.type, "FeatureCollection");
  assert.equal(result.features.length, 1);
  assert.equal(result.features[0].properties.summaryLevel, "tambon");
  assert.equal(result.features[0].properties.source, "GISTDA");
  assert.equal(result.features[0].properties._id, undefined);
});

test("flood simplification tolerance decreases at higher zoom", () => {
  assert.equal(hazardLayerService.getFloodTolerance(15), 0);
  assert.ok(hazardLayerService.getFloodTolerance(8) > hazardLayerService.getFloodTolerance(12));
});
