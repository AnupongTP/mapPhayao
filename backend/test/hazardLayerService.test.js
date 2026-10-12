"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const db = require("../src/config/database");
const service = require("../src/services/hazardLayerService");

const BBOX = "99.9,19.0,100.0,19.1";
const YEARS = [2020, 2021, 2022, 2023, 2024];
let testGeneration = 100;

function collection(features = []) {
  return {
    type: "FeatureCollection",
    properties: { startYear: 2020, endYear: 2024, years: YEARS, yearCount: 5 },
    features,
  };
}

function feature() {
  return {
    type: "Feature",
    properties: {
      frequency: 1, yearsDetected: [2024], startYear: 2020, endYear: 2024,
      areaRai: 1.25, province: "Phayao", district: "Mueang", subdistrict: "Mae Ka",
      source: "GISTDA",
    },
    geometry: { type: "Polygon", coordinates: [] },
  };
}

function installFloodMock({ generation = String(testGeneration), row, failBuild } = {}) {
  let currentGeneration = generation;
  let builds = 0;
  let generationReads = 0;
  db.query = async (sql, params) => {
    if (/gis\.dataset_generations/.test(sql)) {
      generationReads += 1;
      assert.deepEqual(params, ["flood_recurrence_pyo"]);
      return { rows: [{ generation: currentGeneration }] };
    }
    if (/collection_candidate/.test(sql)) {
      builds += 1;
      if (failBuild && builds === 1) throw new Error("temporary dissolve failure");
      return { rows: [row || {
        years: YEARS,
        source_overflow: false,
        output_overflow: false,
        byte_overflow: false,
        collection: collection([feature()]),
      }] };
    }
    throw new Error(`Unexpected query: ${sql.slice(0, 80)}`);
  };
  return {
    builds: () => builds,
    generationReads: () => generationReads,
    setGeneration(value) { currentGeneration = value; },
  };
}

test.beforeEach(() => {
  testGeneration += 10;
  service.clearCache();
});

test("bbox validation and zoom tolerance remain compatible", () => {
  assert.deepEqual(service.parseBbox(BBOX).bbox, {
    minLng: 99.9, minLat: 19, maxLng: 100, maxLat: 19.1,
  });
  assert.match(service.parseBbox("bad").error, /must contain/);
  assert.match(service.parseBbox("99,19,98,20").error, /min values/);
  assert.equal(service.getFloodTolerance(15), 0);
  assert.equal(service.getFloodTolerance(12), 5);
  assert.equal(service.getFloodTolerance(9), 10);
  assert.equal(service.getFloodTolerance(8), 20);
});

test("shared year-window helper remains available to point and parcel analysis", async () => {
  db.query = async (sql, params) => {
    assert.match(sql, /latest_years/);
    assert.deepEqual(params, [10]);
    return { rows: [{ start_year: 2015, end_year: 2024, years: [2015,2016,2017,2018,2019,2020,2021,2022,2023,2024] }] };
  };
  assert.equal((await service.getFloodYearWindow()).years.length, 10);
});

test("flood overlay returns the bounded single-query FeatureCollection contract", async () => {
  const mock = installFloodMock();
  const result = await service.getFloodRecurrenceLayer({ bbox: BBOX, zoom: 12 });
  assert.deepEqual(result.properties.years, YEARS);
  assert.equal(result.properties.datasetGeneration, String(testGeneration));
  assert.equal(result.features.length, 1);
  assert.deepEqual(Object.keys(result.features[0].properties).sort(), [
    "areaRai", "district", "endYear", "frequency", "province", "source",
    "startYear", "subdistrict", "yearsDetected",
  ]);
  assert.equal(mock.builds(), 1);
  assert.equal(mock.generationReads(), 2);
});

test("empty BBOX aggregation filters the LEFT JOIN null feature", () => {
  const source = require("../src/services/floodRecurrenceBboxService").FLOOD_BBOX_SQL;
  assert.match(source, /FILTER \(WHERE s\.feature IS NOT NULL\)/);
  assert.match(source, /'features',COALESCE\(jsonb_agg/);
});

test("same generation reuses cache and a higher generation invalidates it", async () => {
  const mock = installFloodMock();
  await service.getFloodRecurrenceLayer({ bbox: BBOX, zoom: 12 });
  await service.getFloodRecurrenceLayer({ bbox: BBOX, zoom: 12 });
  assert.equal(mock.builds(), 1);
  mock.setGeneration(String(testGeneration + 1));
  await service.getFloodRecurrenceLayer({ bbox: BBOX, zoom: 12 });
  assert.equal(mock.builds(), 2);
});

test("generation regression fails closed without serving an older cache", async () => {
  const mock = installFloodMock();
  await service.getFloodRecurrenceLayer({ bbox: BBOX, zoom: 12 });
  mock.setGeneration(String(testGeneration - 1));
  await assert.rejects(
    service.getFloodRecurrenceLayer({ bbox: BBOX, zoom: 12 }),
    (error) => error.code === "FLOOD_DATASET_GENERATION_REGRESSION",
  );
  assert.equal(mock.builds(), 1);
});

test("concurrent requests share one dissolve build", async () => {
  let release;
  const waiting = new Promise((resolve) => { release = resolve; });
  let builds = 0;
  db.query = async (sql) => {
    if (/gis\.dataset_generations/.test(sql)) return { rows: [{ generation: String(testGeneration) }] };
    builds += 1;
    await waiting;
    return { rows: [{ years: YEARS, source_overflow: false, output_overflow: false,
      byte_overflow: false, collection: collection([feature()]) }] };
  };
  const first = service.getFloodRecurrenceLayer({ bbox: BBOX, zoom: 12 });
  const second = service.getFloodRecurrenceLayer({ bbox: BBOX, zoom: 12 });
  await Promise.resolve();
  release();
  const values = await Promise.all([first, second]);
  assert.equal(builds, 1);
  assert.equal(values[0], values[1]);
});

test("failed builds are not cached", async () => {
  const mock = installFloodMock({ failBuild: true });
  await assert.rejects(service.getFloodRecurrenceLayer({ bbox: BBOX, zoom: 12 }), /temporary/);
  assert.equal((await service.getFloodRecurrenceLayer({ bbox: BBOX, zoom: 12 })).features.length, 1);
  assert.equal(mock.builds(), 2);
});

for (const item of [
  ["source", "source_overflow", "FLOOD_SOURCE_BUDGET_EXCEEDED"],
  ["output", "output_overflow", "FLOOD_OUTPUT_BUDGET_EXCEEDED"],
  ["response", "byte_overflow", "FLOOD_RESPONSE_BUDGET_EXCEEDED"],
]) {
  test(`explicit ${item[0]} budget error is never returned as partial HTTP 200 data`, async () => {
    const row = { years: YEARS, source_count: 5001, output_count_bounded: 5001,
      response_bytes_bounded: 9000000, source_overflow: false, output_overflow: false,
      byte_overflow: false, collection: null };
    row[item[1]] = true;
    installFloodMock({ row });
    await assert.rejects(
      service.getFloodRecurrenceLayer({ bbox: BBOX, zoom: 12 }),
      (error) => error.statusCode === 413 && error.code === item[2],
    );
  });
}

test("drought endpoint and response contract remain unchanged", async () => {
  db.query = async (sql) => {
    assert.match(sql, /gis\.drought_recurrence_tambon_pyo/);
    return { rows: [{ properties: { source: "GISTDA", summaryLevel: "tambon" },
      geometry: JSON.stringify({ type: "Polygon", coordinates: [] }) }] };
  };
  const result = await service.getDroughtRecurrenceLayer();
  assert.equal(result.features[0].properties.summaryLevel, "tambon");
});
