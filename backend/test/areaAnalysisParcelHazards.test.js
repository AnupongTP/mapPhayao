const test = require("node:test");
const assert = require("node:assert/strict");

const db = require("../src/config/database");
const areaAnalysisService = require("../src/services/areaAnalysisService");
const hazardLayerService = require("../src/services/hazardLayerService");

const originalQuery = db.query;

test.afterEach(() => {
  db.query = originalQuery;
  hazardLayerService.clearCache();
});

const parcelGeometry = {
  type: "Polygon",
  coordinates: [[
    [99.9, 19.0],
    [99.91, 19.0],
    [99.91, 19.01],
    [99.9, 19.01],
    [99.9, 19.0],
  ]],
};

function createMockQuery({ latestYear = 2024, floodYears = [2015, 2024], floodArea = 800 } = {}) {
  const calls = [];

  db.query = async (sql, params = []) => {
    calls.push({ sql, params });

    if (/ST_GeometryType\(geom\)/.test(sql)) {
      return {
        rows: [{
          geometry_type: "ST_MultiPolygon",
          is_empty: false,
          is_valid: true,
          area_sqm: 1600,
          area_square_meters: 1600,
          area_rai: 1,
        }],
      };
    }

    if (/latest_years/.test(sql) && /array_agg\(year ORDER BY year\)/.test(sql)) {
      const years = Array.from({ length: 10 }, (_, index) => latestYear - 9 + index);
      return {
        rows: [{
          start_year: years[0],
          end_year: years[years.length - 1],
          years,
        }],
      };
    }

    if (/FROM gis\.flood_recurrence_pyo/.test(sql) && /affected_area_square_meters/.test(sql)) {
      return {
        rows: [{
          affected_area_square_meters: floodArea,
          years_detected: floodYears,
        }],
      };
    }

    if (/FROM gis\.drought_recurrence_tambon_pyo/.test(sql)) {
      return {
        rows: [{
          tambon_name: "แม่กา",
          district_name: "เมืองพะเยา",
          province_name: "พะเยา",
          total_occurrences: 2,
          years_detected: [2019, 2023],
          start_year: 2018,
          end_year: 2023,
          response_status: "success",
          source: "GISTDA",
          intersection_area_square_meters: 1200,
        }],
      };
    }

    if (/FROM gis\.amphoe/.test(sql)) {
      return { rows: [{ province_name: "พะเยา", amphoe_name: "เมืองพะเยา", area_sqm: 1600 }] };
    }

    if (/FROM gis\.tambon/.test(sql)) {
      return {
        rows: [{
          province_name: "พะเยา",
          amphoe_name: "เมืองพะเยา",
          tambon_name: "แม่กา",
          area_sqm: 1600,
        }],
      };
    }

    if (/FROM gis\.basin/.test(sql)) {
      return { rows: [] };
    }

    if (/FROM gis\.rice_potential/.test(sql) || /FROM gis\.maize_potential/.test(sql)) {
      return { rows: [] };
    }

    if (/FROM gis\.soil_enriched_basic/.test(sql)) {
      return { rows: [] };
    }

    if (/FROM gis\.stream/.test(sql) || /FROM gis\.irrigation_canal/.test(sql)) {
      return { rows: [] };
    }

    return { rows: [] };
  };

  return calls;
}

test("parcel flood recurrence uses the dynamic latest 10-year window", async () => {
  const calls = createMockQuery({ latestYear: 2024 });

  const result = await areaAnalysisService.analyzePolygon({
    name: "test parcel",
    geometry: parcelGeometry,
  });

  assert.equal(result.historicalHazards.floodRecurrence.startYear, 2015);
  assert.equal(result.historicalHazards.floodRecurrence.endYear, 2024);
  assert.deepEqual(result.historicalHazards.floodRecurrence.yearsDetected, [2015, 2024]);
  assert.equal(result.historicalHazards.floodRecurrence.frequency, 2);
  assert.equal(result.historicalHazards.floodRecurrence.affectedAreaSquareMeters, 800);
  assert.equal(result.historicalHazards.floodRecurrence.affectedAreaRai, 0.5);
  assert.equal(result.historicalHazards.floodRecurrence.affectedPercent, 50);

  const floodCall = calls.find((call) => (
    /FROM gis\.flood_recurrence_pyo/.test(call.sql) &&
    /affected_area_square_meters/.test(call.sql)
  ));
  assert.ok(floodCall);
  assert.deepEqual(floodCall.params.slice(1, 3), [2015, 2024]);
  assert.match(floodCall.sql, /ST_UnaryUnion/);
  assert.match(floodCall.sql, /ST_Intersection/);
});

test("parcel flood recurrence latest 10-year window moves with future data", async () => {
  createMockQuery({ latestYear: 2025, floodYears: [2016, 2025] });

  const result = await areaAnalysisService.analyzePolygon({
    name: "test parcel",
    geometry: parcelGeometry,
  });

  assert.equal(result.historicalHazards.floodRecurrence.startYear, 2016);
  assert.equal(result.historicalHazards.floodRecurrence.endYear, 2025);
  assert.deepEqual(result.historicalHazards.floodRecurrence.yearsDetected, [2016, 2025]);
});

test("parcel flood recurrence safely handles no qualifying overlap", async () => {
  createMockQuery({ floodYears: [], floodArea: 0 });

  const result = await areaAnalysisService.analyzePolygon({
    name: "test parcel",
    geometry: parcelGeometry,
  });

  assert.equal(result.historicalHazards.floodRecurrence.found, false);
  assert.equal(result.historicalHazards.floodRecurrence.frequency, 0);
  assert.deepEqual(result.historicalHazards.floodRecurrence.yearsDetected, []);
  assert.equal(result.historicalHazards.floodRecurrence.affectedAreaSquareMeters, 0);
  assert.equal(result.historicalHazards.floodRecurrence.affectedPercent, 0);
});

test("parcel drought recurrence is returned only as tambon-level summary", async () => {
  createMockQuery();

  const result = await areaAnalysisService.analyzePolygon({
    name: "test parcel",
    geometry: parcelGeometry,
  });

  const drought = result.historicalHazards.droughtRecurrence;
  assert.equal(drought.summaryLevel, "tambon");
  assert.match(drought.note, /ระดับตำบล/);
  assert.equal(drought.tambons.length, 1);
  assert.equal(drought.tambons[0].tambon, "แม่กา");
  assert.deepEqual(drought.tambons[0].yearsDetected, [2019, 2023]);
  assert.equal(drought.tambons[0].affectedAreaRai, undefined);
  assert.equal(drought.tambons[0].affectedPercent, undefined);
});

test("parcel area clamps flood overlap area and percent to parcel area", async () => {
  createMockQuery({ floodArea: 2400 });

  const result = await areaAnalysisService.analyzePolygon({
    name: "test parcel",
    geometry: parcelGeometry,
  });

  assert.equal(result.historicalHazards.floodRecurrence.affectedAreaSquareMeters, 1600);
  assert.equal(result.historicalHazards.floodRecurrence.affectedPercent, 100);
});

test("normalizeYears returns numeric unique sorted years", () => {
  assert.deepEqual(
    areaAnalysisService._private.normalizeYears([2024, "2015", 2015, "bad", null, 2024]),
    [2015, 2024],
  );
});
