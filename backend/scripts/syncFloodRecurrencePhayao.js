const crypto = require("crypto");
const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const db = require("../src/config/database");
const gistdaClient = require("../src/services/gistdaClient");

const PHAYAO_PROVINCE_ID = 56;
const LIMIT = 5000;
const SAFETY_CAP = 250000;

function isDryRun() {
  return process.argv.includes("--dry-run");
}

function isForce() {
  return process.argv.includes("--force");
}

function getYearlyFrequency(properties) {
  return Object.keys(properties || {})
    .filter((key) => /^y_\d{4}$/.test(key))
    .map((key) => ({
      year: Number(key.slice(2)),
      frequency: Number(properties[key]) || 0,
    }))
    .filter((item) => Number.isInteger(item.year))
    .sort((left, right) => left.year - right.year);
}

function normalizeFeature(feature) {
  const properties = feature.properties || {};
  const yearlyFrequency = getYearlyFrequency(properties);
  const yearsDetected = yearlyFrequency
    .filter((item) => item.frequency > 0)
    .map((item) => item.year);
  const sourceIdentifier = properties._id
    || (properties.objectid !== undefined ? `objectid:${properties.objectid}` : null)
    || crypto.createHash("sha256").update(JSON.stringify(feature)).digest("hex");

  return {
    sourceIdentifier,
    featureHash: crypto.createHash("sha256").update(JSON.stringify(feature)).digest("hex"),
    freq: Number.isFinite(Number(properties.freq)) ? Number(properties.freq) : null,
    areaRai: Number.isFinite(Number(properties.area_rai)) ? Number(properties.area_rai) : null,
    provinceId: Number.isFinite(Number(properties.pv_idn)) ? Number(properties.pv_idn) : null,
    provinceName: properties.pv_tn || null,
    districtId: Number.isFinite(Number(properties.ap_idn)) ? Number(properties.ap_idn) : null,
    districtName: properties.ap_tn || null,
    subdistrictId: Number.isFinite(Number(properties.tb_idn)) ? Number(properties.tb_idn) : null,
    subdistrictName: properties.tb_tn || null,
    startYear: yearlyFrequency.length ? yearlyFrequency[0].year : null,
    endYear: yearlyFrequency.length ? yearlyFrequency[yearlyFrequency.length - 1].year : null,
    yearsDetected,
    yearlyFrequency,
    sourceProperties: {
      ap_code: properties.ap_code,
      ap_en: properties.ap_en,
      pv_code: properties.pv_code,
      pv_en: properties.pv_en,
      tb_code: properties.tb_code,
      tb_en: properties.tb_en,
      re_nesdb: properties.re_nesdb,
      re_royin: properties.re_royin,
    },
    geometry: feature.geometry,
  };
}

async function ensureTable() {
  await db.query("CREATE SCHEMA IF NOT EXISTS gis");
  await db.query(`
    CREATE TABLE IF NOT EXISTS gis.flood_recurrence_pyo (
      id bigserial PRIMARY KEY,
      source_identifier text NOT NULL UNIQUE,
      feature_hash text NOT NULL,
      freq integer,
      area_rai double precision,
      province_id integer,
      province_name text,
      district_id integer,
      district_name text,
      subdistrict_id integer,
      subdistrict_name text,
      start_year integer,
      end_year integer,
      years_detected integer[] NOT NULL DEFAULT '{}',
      yearly_frequency jsonb NOT NULL DEFAULT '[]'::jsonb,
      source_properties jsonb NOT NULL DEFAULT '{}'::jsonb,
      geom geometry(MultiPolygon, 4326) NOT NULL,
      synced_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS flood_recurrence_pyo_geom_gix
    ON gis.flood_recurrence_pyo USING gist (geom);
  `);
}

async function getPhayaoBoundaryGeoJson() {
  const result = await db.query(`
    SELECT ST_AsGeoJSON(ST_Transform(ST_UnaryUnion(ST_Collect(geom)), 4326)) AS geometry
    FROM gis.amphoe
    WHERE prov_code = $1;
  `, [PHAYAO_PROVINCE_ID]);
  return result.rows[0]?.geometry;
}

async function getExistingFloodCount() {
  const result = await db.query(
    "SELECT COUNT(*)::int AS count FROM gis.flood_recurrence_pyo",
  );
  return result.rows[0]?.count || 0;
}

async function upsertBatch(features) {
  let insertedOrUpdated = 0;
  let skipped = 0;

  await db.query("BEGIN");
  try {
    for (const feature of features) {
      if (!feature.geometry || !["Polygon", "MultiPolygon"].includes(feature.geometry.type)) {
        skipped += 1;
        continue;
      }

      const normalized = normalizeFeature(feature);
      const result = await db.query(`
        WITH province AS (
          SELECT ST_Transform(ST_UnaryUnion(ST_Collect(geom)), 4326) AS geom
          FROM gis.amphoe
          WHERE prov_code = $15
        ),
        input AS (
          SELECT ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON($14), 4326)), 3)) AS geom
        ),
        clipped AS (
          SELECT ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_Intersection(input.geom, province.geom)), 3)) AS geom
          FROM input, province
          WHERE ST_Intersects(input.geom, province.geom)
        )
        INSERT INTO gis.flood_recurrence_pyo (
          source_identifier, feature_hash, freq, area_rai,
          province_id, province_name, district_id, district_name,
          subdistrict_id, subdistrict_name, start_year, end_year,
          years_detected, yearly_frequency, source_properties, geom, synced_at
        )
        SELECT
          $1, $2, $3, $4,
          $5, $6, $7, $8,
          $9, $10, $11, $12,
          $13::integer[], $16::jsonb, $17::jsonb, clipped.geom, now()
        FROM clipped
        WHERE NOT ST_IsEmpty(clipped.geom)
        ON CONFLICT (source_identifier) DO UPDATE SET
          feature_hash = EXCLUDED.feature_hash,
          freq = EXCLUDED.freq,
          area_rai = EXCLUDED.area_rai,
          province_id = EXCLUDED.province_id,
          province_name = EXCLUDED.province_name,
          district_id = EXCLUDED.district_id,
          district_name = EXCLUDED.district_name,
          subdistrict_id = EXCLUDED.subdistrict_id,
          subdistrict_name = EXCLUDED.subdistrict_name,
          start_year = EXCLUDED.start_year,
          end_year = EXCLUDED.end_year,
          years_detected = EXCLUDED.years_detected,
          yearly_frequency = EXCLUDED.yearly_frequency,
          source_properties = EXCLUDED.source_properties,
          geom = EXCLUDED.geom,
          synced_at = now()
        RETURNING id;
      `, [
        normalized.sourceIdentifier,
        normalized.featureHash,
        normalized.freq,
        normalized.areaRai,
        normalized.provinceId,
        normalized.provinceName,
        normalized.districtId,
        normalized.districtName,
        normalized.subdistrictId,
        normalized.subdistrictName,
        normalized.startYear,
        normalized.endYear,
        normalized.yearsDetected,
        JSON.stringify(normalized.geometry),
        PHAYAO_PROVINCE_ID,
        JSON.stringify(normalized.yearlyFrequency),
        JSON.stringify(normalized.sourceProperties),
      ]);

      if (result.rowCount > 0) {
        insertedOrUpdated += 1;
      } else {
        skipped += 1;
      }
    }
    await db.query("COMMIT");
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  }

  return { insertedOrUpdated, skipped };
}

async function main() {
  await ensureTable();
  const boundary = await getPhayaoBoundaryGeoJson();
  if (!boundary) {
    throw new Error("Phayao province boundary was not found");
  }

  const sample = await gistdaClient.requestJson("/features/flood-freq", {
    query: { pv_idn: PHAYAO_PROVINCE_ID, limit: 1, offset: 0 },
    accept: "application/geo+json",
  });
  const numberMatched = Number(sample.body.numberMatched || 0);
  const first = sample.body.features?.[0];

  console.log(JSON.stringify({
    mode: isDryRun() ? "dry-run" : "sync",
    provinceId: PHAYAO_PROVINCE_ID,
    numberMatched,
    firstGeometryType: first?.geometry?.type || null,
    propertyFields: Object.keys(first?.properties || {}),
  }));

  if (numberMatched > SAFETY_CAP) {
    console.log(JSON.stringify({ stopped: true, reason: "SAFETY_CAP_EXCEEDED", numberMatched }));
    return;
  }
  if (isDryRun()) {
    return;
  }

  const existingCount = isForce() ? 0 : await getExistingFloodCount();
  let offset = Math.min(existingCount, numberMatched);
  let insertedOrUpdated = 0;
  let skipped = 0;
  let errors = 0;

  if (offset > 0) {
    console.log(JSON.stringify({ resume: true, startingOffset: offset, numberMatched }));
  }

  while (offset < numberMatched) {
    const { body } = await gistdaClient.requestJson("/features/flood-freq", {
      query: { pv_idn: PHAYAO_PROVINCE_ID, limit: LIMIT, offset },
      accept: "application/geo+json",
    });
    const features = Array.isArray(body.features) ? body.features : [];
    const result = await upsertBatch(features);
    insertedOrUpdated += result.insertedOrUpdated;
    skipped += result.skipped;
    offset += features.length;
    if (!features.length) {
      break;
    }
    console.log(JSON.stringify({ offset, insertedOrUpdated, skipped, errors }));
  }

  console.log(JSON.stringify({ done: true, insertedOrUpdated, skipped, errors }));
}

main()
  .catch((error) => {
    console.error(JSON.stringify({ error: error.message }));
    process.exitCode = 1;
  })
  .finally(() => db.pool.end());
