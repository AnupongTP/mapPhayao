const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const db = require("../src/config/database");
const gistdaClient = require("../src/services/gistdaClient");

const PHAYAO_PROVINCE_ID = 56;
const CONCURRENCY = 2;
const REQUEST_DELAY_MS = 150;

function isDryRun() {
  return process.argv.includes("--dry-run");
}

function isForce() {
  return process.argv.includes("--force");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeRecord(record) {
  const detail = Array.isArray(record?.detail) ? record.detail : [];
  const yearlyFrequency = detail
    .map((item) => {
      const year = Number(item?.year);
      const frequency = Number(item?.freq);
      if (!Number.isInteger(year) || !Number.isFinite(frequency)) {
        return null;
      }
      return { year, frequency };
    })
    .filter(Boolean)
    .sort((left, right) => left.year - right.year);
  const yearsDetected = yearlyFrequency
    .filter((item) => item.frequency > 0)
    .map((item) => item.year);

  return {
    totalOccurrences: Number.isFinite(Number(record?.total)) ? Number(record.total) : null,
    yearsDetected,
    yearlyFrequency,
    startYear: yearlyFrequency.length ? yearlyFrequency[0].year : null,
    endYear: yearlyFrequency.length ? yearlyFrequency[yearlyFrequency.length - 1].year : null,
    responseStatus: "success",
  };
}

async function ensureTable() {
  await db.query("CREATE SCHEMA IF NOT EXISTS gis");
  await db.query(`
    CREATE TABLE IF NOT EXISTS gis.drought_recurrence_tambon_pyo (
      id bigserial PRIMARY KEY,
      tambon_id integer NOT NULL UNIQUE,
      tambon_code text,
      tambon_name text,
      district_name text,
      province_name text,
      total_occurrences integer,
      years_detected integer[] NOT NULL DEFAULT '{}',
      yearly_frequency jsonb NOT NULL DEFAULT '[]'::jsonb,
      start_year integer,
      end_year integer,
      geom geometry(MultiPolygon, 4326) NOT NULL,
      source text NOT NULL DEFAULT 'GISTDA',
      response_status text NOT NULL,
      synced_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS drought_recurrence_tambon_pyo_geom_gix
    ON gis.drought_recurrence_tambon_pyo USING gist (geom);
  `);
}

async function loadTambons() {
  const result = await db.query(`
    SELECT
      id,
      sdist_code,
      tambon,
      amphoe,
      changwat,
      ST_AsGeoJSON(ST_Transform(geom, 4326)) AS geometry,
      ST_AsGeoJSON(
        ST_SimplifyPreserveTopology(ST_Transform(geom, 4326), 0.001),
        6
      ) AS api_geometry
    FROM gis.tambon
    WHERE sdist_code LIKE $1
    ORDER BY sdist_code;
  `, [`${PHAYAO_PROVINCE_ID}%`]);
  return result.rows;
}

async function alreadySynced(tambonId) {
  const result = await db.query(
    "SELECT 1 FROM gis.drought_recurrence_tambon_pyo WHERE tambon_id = $1 LIMIT 1",
    [tambonId],
  );
  return result.rowCount > 0;
}

async function upsertTambon(tambon, normalized, responseStatus) {
  await db.query(`
    INSERT INTO gis.drought_recurrence_tambon_pyo (
      tambon_id, tambon_code, tambon_name, district_name, province_name,
      total_occurrences, years_detected, yearly_frequency,
      start_year, end_year, geom, source, response_status, synced_at
    )
    VALUES (
      $1, $2, $3, $4, $5,
      $6, $7::integer[], $8::jsonb,
      $9, $10,
      ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON($11), 4326)), 3)),
      'GISTDA', $12, now()
    )
    ON CONFLICT (tambon_id) DO UPDATE SET
      tambon_code = EXCLUDED.tambon_code,
      tambon_name = EXCLUDED.tambon_name,
      district_name = EXCLUDED.district_name,
      province_name = EXCLUDED.province_name,
      total_occurrences = EXCLUDED.total_occurrences,
      years_detected = EXCLUDED.years_detected,
      yearly_frequency = EXCLUDED.yearly_frequency,
      start_year = EXCLUDED.start_year,
      end_year = EXCLUDED.end_year,
      geom = EXCLUDED.geom,
      response_status = EXCLUDED.response_status,
      synced_at = now();
  `, [
    tambon.id,
    tambon.sdist_code,
    tambon.tambon,
    tambon.amphoe,
    tambon.changwat,
    normalized.totalOccurrences,
    normalized.yearsDetected,
    JSON.stringify(normalized.yearlyFrequency),
    normalized.startYear,
    normalized.endYear,
    tambon.geometry,
    responseStatus,
  ]);
}

async function syncTambon(tambon) {
  if (!isForce() && await alreadySynced(tambon.id)) {
    return { skipped: 1, updated: 0, errors: 0 };
  }

  const areaFeature = {
    type: "Feature",
    properties: {},
    geometry: JSON.parse(tambon.api_geometry || tambon.geometry),
  };

  let body = null;
  try {
    const response = await gistdaClient.requestJson(
      "/gi-service/v1.1/disasters/drought-recurrence",
      {
        query: { area: JSON.stringify(areaFeature) },
        accept: "application/json",
      },
    );
    body = response.body;
  } catch (error) {
    const empty = {
      totalOccurrences: null,
      yearsDetected: [],
      yearlyFrequency: [],
      startYear: null,
      endYear: null,
    };
    await upsertTambon(tambon, empty, error.code || "unavailable");
    return { skipped: 0, updated: 1, errors: 1 };
  }

  const records = Array.isArray(body) ? body : [];
  const selected = records
    .map(normalizeRecord)
    .sort((left, right) => (right.totalOccurrences ?? -1) - (left.totalOccurrences ?? -1))[0] || {
      totalOccurrences: 0,
      yearsDetected: [],
      yearlyFrequency: [],
      startYear: null,
      endYear: null,
    };
  await upsertTambon(tambon, selected, records.length ? "success" : "empty");
  return { skipped: 0, updated: 1, errors: 0 };
}

async function runPool(items, worker) {
  let index = 0;
  const totals = { updated: 0, skipped: 0, errors: 0 };

  async function next() {
    while (index < items.length) {
      const item = items[index];
      index += 1;
      const result = await worker(item);
      totals.updated += result.updated;
      totals.skipped += result.skipped;
      totals.errors += result.errors;
      await sleep(REQUEST_DELAY_MS);
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, next));
  return totals;
}

async function main() {
  await ensureTable();
  const tambons = await loadTambons();
  console.log(JSON.stringify({
    mode: isDryRun() ? "dry-run" : "sync",
    provinceId: PHAYAO_PROVINCE_ID,
    tambonCount: tambons.length,
    concurrency: CONCURRENCY,
    force: isForce(),
  }));

  if (isDryRun()) {
    return;
  }

  const totals = await runPool(tambons, syncTambon);
  console.log(JSON.stringify({ done: true, ...totals }));
}

main()
  .catch((error) => {
    console.error(JSON.stringify({ error: error.message }));
    process.exitCode = 1;
  })
  .finally(() => db.pool.end());
