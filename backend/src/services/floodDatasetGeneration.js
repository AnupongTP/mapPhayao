"use strict";

const FLOOD_DATASET_KEY = "flood_recurrence_pyo";

async function getFloodDatasetGeneration(db) {
  const result = await db.query(`
    SELECT generation::text AS generation
    FROM gis.dataset_generations
    WHERE dataset_key = $1;
  `, [FLOOD_DATASET_KEY]);
  const generation = result.rows[0]?.generation;
  if (!generation) {
    const error = new Error("Flood dataset generation is unavailable");
    error.code = "FLOOD_DATASET_GENERATION_UNAVAILABLE";
    throw error;
  }
  return generation;
}

async function publishStagedFloodDataset(client, metrics = {}) {
  const sourceCount = Number(metrics.sourceCount);
  const publishedRowCount = Number(metrics.publishedRowCount);
  if (!Number.isInteger(sourceCount) || sourceCount <= 0
      || !Number.isInteger(publishedRowCount) || publishedRowCount <= 0) {
    throw new Error("Flood publication metrics are invalid");
  }
  await client.query("BEGIN");
  try {
    await client.query("LOCK TABLE gis.flood_recurrence_pyo IN ACCESS EXCLUSIVE MODE");
    await client.query("DELETE FROM gis.flood_recurrence_pyo");
    await client.query(`
      INSERT INTO gis.flood_recurrence_pyo (
        source_identifier, feature_hash, freq, area_rai,
        province_id, province_name, district_id, district_name,
        subdistrict_id, subdistrict_name, start_year, end_year,
        years_detected, yearly_frequency, source_properties, geom, synced_at
      )
      SELECT
        source_identifier, feature_hash, freq, area_rai,
        province_id, province_name, district_id, district_name,
        subdistrict_id, subdistrict_name, start_year, end_year,
        years_detected, yearly_frequency, source_properties, geom, synced_at
      FROM flood_recurrence_pyo_stage
      ORDER BY source_identifier;
    `);
    const generationResult = await client.query(`
      UPDATE gis.dataset_generations
      SET generation = generation + 1,
          source_count = $2,
          published_row_count = $3,
          published_at = clock_timestamp()
      WHERE dataset_key = $1
      RETURNING generation::text AS generation;
    `, [FLOOD_DATASET_KEY, sourceCount, publishedRowCount]);
    if (generationResult.rowCount !== 1) {
      throw new Error("Flood dataset generation row is missing");
    }
    await client.query("COMMIT");
    return generationResult.rows[0].generation;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

module.exports = {
  FLOOD_DATASET_KEY,
  getFloodDatasetGeneration,
  publishStagedFloodDataset,
};
