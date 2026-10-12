"use strict";

const crypto = require("node:crypto");
const { publishStagedFloodDataset } = require("../src/services/floodDatasetGeneration");

const PHAYAO_PROVINCE_ID = 56;
const PAGE_LIMIT = 5000;
const SAFETY_CAP = 250000;
const MINIMUM_RETAINED_RATIO = 0.8;
const REFRESH_LOCK_KEYS = [1346918721, 1179406159];

function qualityError(message) {
  const error = new Error(message);
  error.code = "FLOOD_REFRESH_QUALITY_FAILED";
  return error;
}

function refreshLockError() {
  const error = new Error("Another flood dataset refresh is already running");
  error.code = "FLOOD_REFRESH_ALREADY_RUNNING";
  return error;
}

async function acquireRefreshLock(client) {
  const result = await client.query(
    "SELECT pg_try_advisory_lock($1,$2) AS locked",
    REFRESH_LOCK_KEYS,
  );
  if (result.rows[0]?.locked !== true) throw refreshLockError();
}

async function releaseRefreshLock(client) {
  const result = await client.query(
    "SELECT pg_advisory_unlock($1,$2) AS unlocked",
    REFRESH_LOCK_KEYS,
  );
  if (result.rows[0]?.unlocked !== true) {
    throw new Error("Flood dataset refresh lock was not held");
  }
}

function retainedRatio(nextCount, previousCount) {
  return previousCount > 0 ? nextCount / previousCount : 1;
}

function validateRefreshQuality({
  numberMatched,
  downloaded,
  staged,
  stageStats,
  baseline,
  allowDataReduction = false,
  minimumRetainedRatio = MINIMUM_RETAINED_RATIO,
}) {
  if (!Number.isInteger(numberMatched) || numberMatched <= 0 || downloaded !== numberMatched) {
    throw qualityError("Flood source completeness could not be established");
  }
  if (!Number.isInteger(staged) || staged <= 0 || stageStats.rowCount !== staged) {
    throw qualityError("Flood staged row count is incomplete");
  }
  if (stageStats.invalidGeometryCount !== 0 || stageStats.invalidYearCount !== 0) {
    throw qualityError("Flood staged data failed geometry or year validation");
  }
  if (!(minimumRetainedRatio > 0 && minimumRetainedRatio <= 1)) {
    throw qualityError("Flood retained-ratio policy is invalid");
  }

  const previousSourceCount = baseline.sourceCount;
  const previousPublishedRowCount = baseline.publishedRowCount || baseline.currentRowCount;
  const sourceRatio = retainedRatio(numberMatched, previousSourceCount);
  const publishedRatio = retainedRatio(staged, previousPublishedRowCount);
  if (!allowDataReduction
      && ((previousSourceCount > 0 && sourceRatio < minimumRetainedRatio)
        || (previousPublishedRowCount > 0 && publishedRatio < minimumRetainedRatio))) {
    throw qualityError("Flood refresh is unexpectedly smaller than the published dataset");
  }

  return { sourceRatio, publishedRatio };
}

async function readPublishedBaseline(client) {
  const result = await client.query(`
    SELECT
      g.source_count::int AS source_count,
      g.published_row_count::int AS published_row_count,
      (SELECT COUNT(*)::int FROM gis.flood_recurrence_pyo) AS current_row_count
    FROM gis.dataset_generations AS g
    WHERE g.dataset_key = 'flood_recurrence_pyo';
  `);
  if (result.rowCount !== 1) {
    throw qualityError("Flood dataset generation metadata is unavailable");
  }
  const row = result.rows[0];
  return {
    sourceCount: Number(row.source_count) || 0,
    publishedRowCount: Number(row.published_row_count) || 0,
    currentRowCount: Number(row.current_row_count) || 0,
  };
}

function yearlyFrequency(properties) {
  return Object.keys(properties || {})
    .filter((key) => /^y_\d{4}$/.test(key))
    .map((key) => ({ year: Number(key.slice(2)), frequency: Number(properties[key]) || 0 }))
    .sort((left, right) => left.year - right.year);
}

function normalizeFeature(feature) {
  const properties = feature.properties || {};
  const frequencies = yearlyFrequency(properties);
  const serialized = JSON.stringify(feature);
  return {
    sourceIdentifier: properties._id
      || (properties.objectid !== undefined ? `objectid:${properties.objectid}` : null)
      || crypto.createHash("sha256").update(serialized).digest("hex"),
    featureHash: crypto.createHash("sha256").update(serialized).digest("hex"),
    freq: Number.isFinite(Number(properties.freq)) ? Number(properties.freq) : null,
    areaRai: Number.isFinite(Number(properties.area_rai)) ? Number(properties.area_rai) : null,
    provinceId: Number.isFinite(Number(properties.pv_idn)) ? Number(properties.pv_idn) : null,
    provinceName: properties.pv_tn || null,
    districtId: Number.isFinite(Number(properties.ap_idn)) ? Number(properties.ap_idn) : null,
    districtName: properties.ap_tn || null,
    subdistrictId: Number.isFinite(Number(properties.tb_idn)) ? Number(properties.tb_idn) : null,
    subdistrictName: properties.tb_tn || null,
    startYear: frequencies[0]?.year || null,
    endYear: frequencies.at(-1)?.year || null,
    yearsDetected: frequencies.filter((item) => item.frequency > 0).map((item) => item.year),
    yearlyFrequency: frequencies,
    sourceProperties: {
      ap_code: properties.ap_code, ap_en: properties.ap_en,
      pv_code: properties.pv_code, pv_en: properties.pv_en,
      tb_code: properties.tb_code, tb_en: properties.tb_en,
      re_nesdb: properties.re_nesdb, re_royin: properties.re_royin,
    },
    geometry: feature.geometry,
  };
}

async function prepareStage(client) {
  await client.query("DROP TABLE IF EXISTS pg_temp.flood_recurrence_pyo_stage");
  await client.query(`
    CREATE TEMP TABLE flood_recurrence_pyo_stage ON COMMIT PRESERVE ROWS AS
    SELECT
      source_identifier, feature_hash, freq, area_rai,
      province_id, province_name, district_id, district_name,
      subdistrict_id, subdistrict_name, start_year, end_year,
      years_detected, yearly_frequency, source_properties, geom, synced_at
    FROM gis.flood_recurrence_pyo
    WITH NO DATA;
  `);
  await client.query(`
    CREATE UNIQUE INDEX flood_recurrence_pyo_stage_source_uidx
    ON flood_recurrence_pyo_stage (source_identifier);
  `);
}

async function stageFeature(client, feature, boundaryGeoJson) {
  if (!feature.geometry || !["Polygon", "MultiPolygon"].includes(feature.geometry.type)) return false;
  const item = normalizeFeature(feature);
  const result = await client.query(`
    WITH boundary AS (
      SELECT ST_SetSRID(ST_GeomFromGeoJSON($17),4326) AS geom
    ), input AS (
      SELECT ST_Multi(ST_CollectionExtract(
        ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON($14),4326)),3
      )) AS geom
    ), clipped AS (
      SELECT ST_Multi(ST_CollectionExtract(
        ST_MakeValid(ST_Intersection(input.geom,boundary.geom)),3
      )) AS geom
      FROM input,boundary WHERE ST_Intersects(input.geom,boundary.geom)
    )
    INSERT INTO flood_recurrence_pyo_stage (
      source_identifier,feature_hash,freq,area_rai,
      province_id,province_name,district_id,district_name,
      subdistrict_id,subdistrict_name,start_year,end_year,
      years_detected,yearly_frequency,source_properties,geom,synced_at
    )
    SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::integer[],
      $15::jsonb,$16::jsonb,clipped.geom,statement_timestamp()
    FROM clipped WHERE NOT ST_IsEmpty(clipped.geom)
    ON CONFLICT (source_identifier) DO UPDATE SET
      feature_hash=EXCLUDED.feature_hash,freq=EXCLUDED.freq,area_rai=EXCLUDED.area_rai,
      province_id=EXCLUDED.province_id,province_name=EXCLUDED.province_name,
      district_id=EXCLUDED.district_id,district_name=EXCLUDED.district_name,
      subdistrict_id=EXCLUDED.subdistrict_id,subdistrict_name=EXCLUDED.subdistrict_name,
      start_year=EXCLUDED.start_year,end_year=EXCLUDED.end_year,
      years_detected=EXCLUDED.years_detected,yearly_frequency=EXCLUDED.yearly_frequency,
      source_properties=EXCLUDED.source_properties,geom=EXCLUDED.geom,synced_at=EXCLUDED.synced_at
    RETURNING source_identifier;
  `, [
    item.sourceIdentifier, item.featureHash, item.freq, item.areaRai,
    item.provinceId, item.provinceName, item.districtId, item.districtName,
    item.subdistrictId, item.subdistrictName, item.startYear, item.endYear,
    item.yearsDetected, JSON.stringify(item.geometry), JSON.stringify(item.yearlyFrequency),
    JSON.stringify(item.sourceProperties), boundaryGeoJson,
  ]);
  return result.rowCount > 0;
}

async function refreshFloodDataset({
  client,
  gistdaClient,
  safetyCap = SAFETY_CAP,
  allowDataReduction = false,
  minimumRetainedRatio = MINIMUM_RETAINED_RATIO,
  publishDataset = publishStagedFloodDataset,
}) {
  await acquireRefreshLock(client);
  let operationFailed = false;
  try {
    const baseline = await readPublishedBaseline(client);
    const boundaryResult = await client.query(`
      SELECT ST_AsGeoJSON(ST_Transform(ST_UnaryUnion(ST_Collect(geom)),4326)) AS geometry
      FROM gis.amphoe WHERE prov_code=$1;
    `, [PHAYAO_PROVINCE_ID]);
    const boundaryGeoJson = boundaryResult.rows[0]?.geometry;
    if (!boundaryGeoJson) throw new Error("Phayao province boundary was not found");

    const sample = await gistdaClient.requestJson("/features/flood-freq", {
      query: { pv_idn: PHAYAO_PROVINCE_ID, limit: 1, offset: 0 },
      accept: "application/geo+json",
    });
    const numberMatched = Number(sample.body.numberMatched);
    if (!Number.isInteger(numberMatched) || numberMatched < 0) {
      throw new Error("Flood source did not return a valid numberMatched");
    }
    if (numberMatched > safetyCap) throw new Error("Flood source safety cap exceeded");

    await prepareStage(client);
    let downloaded = 0;
    let staged = 0;
    while (downloaded < numberMatched) {
      const response = await gistdaClient.requestJson("/features/flood-freq", {
        query: { pv_idn: PHAYAO_PROVINCE_ID, limit: PAGE_LIMIT, offset: downloaded },
        accept: "application/geo+json",
      });
      const features = Array.isArray(response.body.features) ? response.body.features : [];
      if (!features.length) throw new Error("Flood source ended before numberMatched was reached");
      for (const feature of features) {
        if (await stageFeature(client, feature, boundaryGeoJson)) staged += 1;
      }
      downloaded += features.length;
      if (downloaded > numberMatched) throw new Error("Flood source returned more rows than numberMatched");
    }
    if (downloaded !== numberMatched) throw new Error("Flood source row count changed during refresh");

    const stageResult = await client.query(`
      SELECT
        COUNT(*)::int AS row_count,
        COUNT(*) FILTER (
          WHERE geom IS NULL OR ST_IsEmpty(geom) OR NOT ST_IsValid(geom)
        )::int AS invalid_geometry_count,
        COUNT(*) FILTER (
          WHERE start_year IS NULL OR end_year IS NULL OR start_year > end_year
            OR jsonb_typeof(yearly_frequency) <> 'array'
        )::int AS invalid_year_count
      FROM flood_recurrence_pyo_stage;
    `);
    const stageStats = {
      rowCount: Number(stageResult.rows[0]?.row_count),
      invalidGeometryCount: Number(stageResult.rows[0]?.invalid_geometry_count),
      invalidYearCount: Number(stageResult.rows[0]?.invalid_year_count),
    };
    const quality = validateRefreshQuality({
      numberMatched,
      downloaded,
      staged,
      stageStats,
      baseline,
      allowDataReduction,
      minimumRetainedRatio,
    });
    const generation = await publishDataset(client, {
      sourceCount: numberMatched,
      publishedRowCount: staged,
    });
    return { generation, downloaded, staged, quality };
  } catch (error) {
    operationFailed = true;
    throw error;
  } finally {
    try {
      await releaseRefreshLock(client);
    } catch (error) {
      if (!operationFailed) throw error;
    }
  }
}

module.exports = {
  MINIMUM_RETAINED_RATIO,
  REFRESH_LOCK_KEYS,
  normalizeFeature,
  prepareStage,
  readPublishedBaseline,
  refreshFloodDataset,
  stageFeature,
  validateRefreshQuality,
};
