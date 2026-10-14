"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { Pool } = require("pg");
const { createHazardLayerService } = require("../src/services/floodRecurrenceBboxService");
const { createFloodRecurrencePointReader } = require("../src/services/hazardLayerService");
const { refreshFloodDataset } = require("../scripts/floodRecurrenceAtomicRefresh");

const connectionString = process.env.FLOOD_POSTGIS_TEST_DATABASE_URL || "";

function assertDisposableDatabase(urlText) {
  const url = new URL(urlText);
  const loopback = ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
  const disposableName = /(test|e2e|phase3b)/i.test(url.pathname);
  if (!loopback || !disposableName) {
    throw new Error("FLOOD_POSTGIS_TEST_DATABASE_URL must target a disposable loopback database");
  }
}

test("real PostGIS empty BBOX returns metadata and an empty feature array", {
  skip: !connectionString,
}, async () => {
  assertDisposableDatabase(connectionString);
  const pool = new Pool({ connectionString, max: 1 });
  try {
    await pool.query("CREATE EXTENSION IF NOT EXISTS postgis");
    await pool.query("DROP SCHEMA IF EXISTS gis CASCADE; CREATE SCHEMA gis");
    await pool.query(`
      CREATE TABLE gis.dataset_generations (
        dataset_key text PRIMARY KEY,
        generation bigint NOT NULL
      );
      INSERT INTO gis.dataset_generations VALUES ('flood_recurrence_pyo', 7);
      CREATE TABLE gis.flood_recurrence_pyo (
        id bigint PRIMARY KEY,
        province_id integer,
        province_name text,
        district_id integer,
        district_name text,
        subdistrict_id integer,
        subdistrict_name text,
        yearly_frequency jsonb NOT NULL,
        geom geometry(MultiPolygon,4326) NOT NULL,
        synced_at timestamptz NOT NULL DEFAULT now()
      );
      INSERT INTO gis.flood_recurrence_pyo (
        id, province_id, province_name, district_id, district_name,
        subdistrict_id, subdistrict_name, yearly_frequency, geom
      ) VALUES (
        1, 56, 'พะเยา', 5601, 'เมืองพะเยา', 560101, 'เวียง',
        '[{"year":2020,"frequency":1},{"year":2021,"frequency":1},
          {"year":2022,"frequency":1},{"year":2023,"frequency":1},
          {"year":2024,"frequency":1}]'::jsonb,
        ST_Multi(ST_MakeEnvelope(99.8,19.0,99.9,19.1,4326))
      );
    `);
    const service = createHazardLayerService({
      db: pool,
      getDatasetGeneration: async () => "7",
    });
    const result = await service.getFloodRecurrenceLayer({
      bbox: "100.5,20.0,100.6,20.1",
      zoom: 15,
    });
    assert.deepEqual(result, {
      type: "FeatureCollection",
      properties: {
        startYear: 2020,
        endYear: 2024,
        years: [2020, 2021, 2022, 2023, 2024],
        yearCount: 5,
        datasetGeneration: "7",
      },
      features: [],
    });

    const pointReader = createFloodRecurrencePointReader(pool);
    const inside = await pointReader({ lat: 19.05, lng: 99.85 });
    const outside = await pointReader({ lat: 20.05, lng: 100.55 });
    assert.equal(inside.found, true);
    assert.equal(inside.frequency, 5);
    assert.deepEqual(inside.yearsDetected, [2020, 2021, 2022, 2023, 2024]);
    assert.equal(outside.found, false);
  } finally {
    await pool.query("DROP SCHEMA IF EXISTS gis CASCADE").catch(() => {});
    await pool.end();
  }
});

test("real PostGIS refresh publishes rows and generation atomically, then preserves them on quality failure", {
  skip: !connectionString,
}, async () => {
  assertDisposableDatabase(connectionString);
  const pool = new Pool({ connectionString, max: 1 });
  const feature = (id, minLng) => ({
    type: "Feature",
    properties: {
      _id: id,
      freq: 1,
      area_rai: 10,
      pv_idn: 56,
      pv_tn: "พะเยา",
      ap_idn: 5601,
      ap_tn: "เมืองพะเยา",
      tb_idn: 560101,
      tb_tn: "เวียง",
      y_2024: 1,
    },
    geometry: {
      type: "Polygon",
      coordinates: [[
        [minLng, 19], [minLng + 0.01, 19],
        [minLng + 0.01, 19.01], [minLng, 19.01], [minLng, 19],
      ]],
    },
  });

  try {
    await pool.query("CREATE EXTENSION IF NOT EXISTS postgis");
    await pool.query("DROP SCHEMA IF EXISTS gis CASCADE; CREATE SCHEMA gis");
    await pool.query(`
      CREATE TABLE gis.amphoe (
        id bigint PRIMARY KEY,
        prov_code integer NOT NULL,
        geom geometry(MultiPolygon,4326) NOT NULL
      );
      INSERT INTO gis.amphoe VALUES (
        1, 56, ST_Multi(ST_MakeEnvelope(99.7,18.9,100.1,19.2,4326))
      );
      CREATE TABLE gis.dataset_generations (
        dataset_key text PRIMARY KEY,
        generation bigint NOT NULL,
        source_count bigint,
        published_row_count bigint,
        published_at timestamptz NOT NULL DEFAULT clock_timestamp()
      );
      INSERT INTO gis.dataset_generations
        (dataset_key,generation,source_count,published_row_count)
      VALUES ('flood_recurrence_pyo',7,1,1);
      CREATE TABLE gis.flood_recurrence_pyo (
        id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        source_identifier text NOT NULL UNIQUE,
        feature_hash text NOT NULL,
        freq integer,
        area_rai numeric,
        province_id integer,
        province_name text,
        district_id integer,
        district_name text,
        subdistrict_id integer,
        subdistrict_name text,
        start_year integer,
        end_year integer,
        years_detected integer[] NOT NULL DEFAULT '{}',
        yearly_frequency jsonb NOT NULL DEFAULT '[]',
        source_properties jsonb NOT NULL DEFAULT '{}',
        geom geometry(MultiPolygon,4326) NOT NULL,
        synced_at timestamptz NOT NULL DEFAULT now()
      );
      INSERT INTO gis.flood_recurrence_pyo (
        source_identifier,feature_hash,province_id,province_name,
        start_year,end_year,years_detected,yearly_frequency,source_properties,geom
      ) VALUES (
        'old','old',56,'พะเยา',2024,2024,ARRAY[2024],
        '[{"year":2024,"frequency":1}]','{}',
        ST_Multi(ST_MakeEnvelope(99.75,18.95,99.76,18.96,4326))
      );
    `);

    const first = feature("new-1", 99.8);
    const second = feature("new-2", 99.82);
    let sourceCall = 0;
    const successfulSource = {
      async requestJson() {
        sourceCall += 1;
        return sourceCall === 1
          ? { body: { numberMatched: 2 } }
          : { body: { features: [first, second] } };
      },
    };
    const client = await pool.connect();
    try {
      const published = await refreshFloodDataset({ client, gistdaClient: successfulSource });
      assert.equal(published.generation, "8");
      assert.equal(published.downloaded, 2);
      assert.equal(published.staged, 2);
    } finally {
      client.release();
    }

    const publishedState = await pool.query(`
      SELECT
        (SELECT generation::text FROM gis.dataset_generations
          WHERE dataset_key='flood_recurrence_pyo') AS generation,
        (SELECT source_count::int FROM gis.dataset_generations
          WHERE dataset_key='flood_recurrence_pyo') AS source_count,
        (SELECT published_row_count::int FROM gis.dataset_generations
          WHERE dataset_key='flood_recurrence_pyo') AS published_row_count,
        (SELECT array_agg(source_identifier ORDER BY source_identifier)
          FROM gis.flood_recurrence_pyo) AS identifiers;
    `);
    assert.deepEqual(publishedState.rows[0], {
      generation: "8",
      source_count: 2,
      published_row_count: 2,
      identifiers: ["new-1", "new-2"],
    });

    sourceCall = 0;
    const incompleteSource = {
      async requestJson() {
        sourceCall += 1;
        return sourceCall === 1
          ? { body: { numberMatched: 1 } }
          : { body: { features: [first] } };
      },
    };
    const failingClient = await pool.connect();
    try {
      await assert.rejects(
        refreshFloodDataset({ client: failingClient, gistdaClient: incompleteSource }),
        (error) => error.code === "FLOOD_REFRESH_QUALITY_FAILED",
      );
    } finally {
      failingClient.release();
    }

    const preservedState = await pool.query(`
      SELECT
        (SELECT generation::text FROM gis.dataset_generations
          WHERE dataset_key='flood_recurrence_pyo') AS generation,
        (SELECT array_agg(source_identifier ORDER BY source_identifier)
          FROM gis.flood_recurrence_pyo) AS identifiers;
    `);
    assert.deepEqual(preservedState.rows[0], {
      generation: "8",
      identifiers: ["new-1", "new-2"],
    });
  } finally {
    await pool.query("DROP SCHEMA IF EXISTS gis CASCADE").catch(() => {});
    await pool.end();
  }
});
