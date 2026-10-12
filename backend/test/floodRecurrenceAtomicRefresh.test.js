"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  MINIMUM_RETAINED_RATIO,
  refreshFloodDataset,
  validateRefreshQuality,
} = require("../scripts/floodRecurrenceAtomicRefresh");
const { publishStagedFloodDataset } = require("../src/services/floodDatasetGeneration");

function quality(overrides = {}) {
  return {
    numberMatched: 100,
    downloaded: 100,
    staged: 90,
    stageStats: {
      rowCount: 90,
      invalidGeometryCount: 0,
      invalidYearCount: 0,
    },
    baseline: {
      sourceCount: 100,
      publishedRowCount: 90,
      currentRowCount: 90,
    },
    ...overrides,
  };
}

test("quality gate accepts complete refreshes and records retained ratios", () => {
  const result = validateRefreshQuality(quality());
  assert.deepEqual(result, { sourceRatio: 1, publishedRatio: 1 });
  assert.equal(MINIMUM_RETAINED_RATIO, 0.8);
});

test("quality gate rejects an unexpected upstream source collapse", () => {
  assert.throws(
    () => validateRefreshQuality(quality({
      numberMatched: 50,
      downloaded: 50,
      staged: 45,
      stageStats: { rowCount: 45, invalidGeometryCount: 0, invalidYearCount: 0 },
    })),
    (error) => error.code === "FLOOD_REFRESH_QUALITY_FAILED",
  );
});

test("quality gate rejects incomplete staging and invalid geometry", () => {
  assert.throws(
    () => validateRefreshQuality(quality({
      staged: 89,
      stageStats: { rowCount: 88, invalidGeometryCount: 1, invalidYearCount: 0 },
    })),
    (error) => error.code === "FLOOD_REFRESH_QUALITY_FAILED",
  );
});

test("explicit operator approval permits a legitimate large data reduction", () => {
  const result = validateRefreshQuality(quality({
    numberMatched: 50,
    downloaded: 50,
    staged: 45,
    stageStats: { rowCount: 45, invalidGeometryCount: 0, invalidYearCount: 0 },
    allowDataReduction: true,
  }));
  assert.equal(result.sourceRatio, 0.5);
  assert.equal(result.publishedRatio, 0.5);
});

test("publication validates metrics before starting a transaction", async () => {
  const client = { query: async () => assert.fail("database must not be called") };
  await assert.rejects(
    publishStagedFloodDataset(client, { sourceCount: 0, publishedRowCount: 10 }),
    /metrics are invalid/,
  );
});

test("publication persists quality metrics in the atomic generation update", async () => {
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push({ sql: String(sql).trim(), params });
      if (/UPDATE gis\.dataset_generations/.test(sql)) {
        return { rowCount: 1, rows: [{ generation: "8" }] };
      }
      return { rowCount: 1, rows: [] };
    },
  };
  const generation = await publishStagedFloodDataset(client, {
    sourceCount: 120,
    publishedRowCount: 110,
  });
  assert.equal(generation, "8");
  assert.equal(calls[0].sql, "BEGIN");
  assert.equal(calls.at(-1).sql, "COMMIT");
  const update = calls.find((call) => /UPDATE gis\.dataset_generations/.test(call.sql));
  assert.deepEqual(update.params, ["flood_recurrence_pyo", 120, 110]);
  assert.match(update.sql, /source_count = \$2/);
  assert.match(update.sql, /published_row_count = \$3/);
});

test("failed refresh quality never reaches atomic publication", async () => {
  let published = false;
  const feature = {
    type: "Feature",
    properties: { _id: "one", y_2024: 1 },
    geometry: {
      type: "Polygon",
      coordinates: [[[99, 19], [99.01, 19], [99.01, 19.01], [99, 19.01], [99, 19]]],
    },
  };
  const client = {
    async query(sql) {
      const text = String(sql);
      if (/pg_try_advisory_lock/.test(text)) {
        return { rowCount: 1, rows: [{ locked: true }] };
      }
      if (/pg_advisory_unlock/.test(text)) {
        return { rowCount: 1, rows: [{ unlocked: true }] };
      }
      if (/g\.source_count/.test(text)) {
        return { rowCount: 1, rows: [{ source_count: 100, published_row_count: 90, current_row_count: 90 }] };
      }
      if (/FROM gis\.amphoe/.test(text)) {
        return { rowCount: 1, rows: [{ geometry: JSON.stringify(feature.geometry) }] };
      }
      if (/INSERT INTO flood_recurrence_pyo_stage/.test(text)) {
        return { rowCount: 1, rows: [{ source_identifier: "one" }] };
      }
      if (/invalid_geometry_count/.test(text)) {
        return { rowCount: 1, rows: [{ row_count: 1, invalid_geometry_count: 0, invalid_year_count: 0 }] };
      }
      return { rowCount: 0, rows: [] };
    },
  };
  let sourceCall = 0;
  const gistdaClient = {
    async requestJson() {
      sourceCall += 1;
      return sourceCall === 1
        ? { body: { numberMatched: 1 } }
        : { body: { features: [feature] } };
    },
  };

  await assert.rejects(
    refreshFloodDataset({
      client,
      gistdaClient,
      publishDataset: async () => {
        published = true;
        return "2";
      },
    }),
    (error) => error.code === "FLOOD_REFRESH_QUALITY_FAILED",
  );
  assert.equal(published, false);
});

test("a concurrent refresh fails fast before reading the provider", async () => {
  let providerCalled = false;
  const client = {
    async query(sql) {
      assert.match(String(sql), /pg_try_advisory_lock/);
      return { rowCount: 1, rows: [{ locked: false }] };
    },
  };
  await assert.rejects(
    refreshFloodDataset({
      client,
      gistdaClient: {
        async requestJson() {
          providerCalled = true;
          throw new Error("provider must not be called");
        },
      },
    }),
    (error) => error.code === "FLOOD_REFRESH_ALREADY_RUNNING",
  );
  assert.equal(providerCalled, false);
});
