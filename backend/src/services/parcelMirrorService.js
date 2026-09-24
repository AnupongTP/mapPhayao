const db = require("../config/database");

async function mirrorUser(userId, google) {
  if (!google?.enabled) return;
  const result = await db.query(`
    SELECT id, display_name, created_at, updated_at FROM app.users WHERE id = $1;
  `, [userId]);
  if (result.rows[0]) await google.upsertUser(result.rows[0]);
}

async function mirrorParcel(parcelId, google) {
  if (!google?.enabled) return;
  const result = await db.query(`
    SELECT p.id, p.owner_user_id, u.display_name, p.parcel_code, p.parcel_name,
      p.crop_type, p.rice_variety,
      to_char(p.planting_date, 'YYYY-MM-DD') AS planting_date,
      ST_AsGeoJSON(ST_Transform(p.geom, 4326))::json AS geometry,
      ROUND(ST_Area(p.geom)::numeric, 2) AS area_sqm,
      ROUND((ST_Area(p.geom) / 1600.0)::numeric, 2) AS area_rai,
      p.created_at, p.updated_at
    FROM app.parcels p
    JOIN app.users u ON u.id = p.owner_user_id
    WHERE p.id = $1;
  `, [parcelId]);
  const parcel = result.rows[0];
  if (!parcel) return;
  const images = await db.query(`
    SELECT id, file_name, link_image, sort_order, created_at
    FROM app.parcel_images WHERE parcel_id = $1
    ORDER BY sort_order, created_at, id;
  `, [parcelId]);
  await google.upsertParcel(parcel, images.rows);
}

async function bestEffortMirror(entity, operation, context, work) {
  try { await work(); } catch (error) {
    console.error("google-mirror-sync-failed", {
      entity, operation, ...context,
      ...(error.code === "SHEET_HEADER_MISMATCH" ? { reason: "sheet-header-mismatch" } : {}),
    });
  }
}

module.exports = { mirrorUser, mirrorParcel, bestEffortMirror };
