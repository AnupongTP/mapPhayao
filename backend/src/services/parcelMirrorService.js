const db = require("../config/database");
const { logGoogleFailure } = require("../utils/googleError");

async function mirrorUser(userId, google, database = db) {
  if (!google?.enabled) return;
  const result = await database.query(`
    SELECT id, display_name, created_at, updated_at FROM app.users WHERE id = $1;
  `, [userId]);
  if (result.rows[0]) await google.upsertUser(result.rows[0]);
}

async function getParcelMirrorRecord(parcelId, database = db) {
  const result = await database.query(`
    SELECT p.id, p.owner_user_id, u.display_name, p.parcel_code, p.parcel_name,
      p.crop_type, p.rice_variety,
      to_char(p.planting_date, 'YYYY-MM-DD') AS planting_date,
      ST_AsGeoJSON(ST_Transform(p.geom, 4326))::json AS geometry,
      ST_X(representative.point) AS representative_lng,
      ST_Y(representative.point) AS representative_lat,
      ROUND(ST_Area(p.geom)::numeric, 2) AS area_sqm,
      ROUND((ST_Area(p.geom) / 1600.0)::numeric, 2) AS area_rai,
      p.note, p.created_at, p.updated_at
    FROM app.parcels p
    JOIN app.users u ON u.id = p.owner_user_id
    CROSS JOIN LATERAL (
      SELECT ST_Transform(ST_PointOnSurface(p.geom), 4326) AS point
    ) representative
    WHERE p.id = $1;
  `, [parcelId]);
  return result.rows[0] || null;
}

async function mirrorParcel(parcelId, google, database = db) {
  if (!google?.enabled) return;
  const parcel = await getParcelMirrorRecord(parcelId, database);
  if (!parcel) return;
  await google.upsertParcel(parcel);
}

async function bestEffortMirror(entity, operation, context, work) {
  try { await work(); } catch (error) {
    logGoogleFailure("google-mirror-sync-failed", error, { entity, operation, parcelId: context.parcelId });
  }
}

module.exports = { mirrorUser, mirrorParcel, getParcelMirrorRecord, bestEffortMirror };
