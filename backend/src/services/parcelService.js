// Service จัดการแปลงเกษตร: validate, แปลง geometry, บันทึก, อ่าน, ลบ
const db = require("../config/database");
const appUserService = require("./appUserService");
const createHttpError = require("../utils/httpError");

const MIN_PARCEL_AREA_SQM = 10;
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;
const PARCEL_NOT_FOUND_MESSAGE = "Parcel not found";
const AUTH_REQUIRED_MESSAGE = "LINE authentication required";

function normalizeText(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const text = String(value).trim().replace(/\s+/g, " ");
  return text || null;
}

function validateDate(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const text = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw createHttpError(400, "รูปแบบวันที่ปลูกไม่ถูกต้อง");
  }

  const date = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) {
    throw createHttpError(400, "รูปแบบวันที่ปลูกไม่ถูกต้อง");
  }

  return text;
}

function validateUuid(value) {
  const text = normalizeText(value);

  if (!text || !/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/.test(text)) {
    throw createHttpError(400, "รหัสแปลงไม่ถูกต้อง");
  }

  return text;
}

function validateAppUserId(value) {
  return validateUuid(value);
}

function validateGeometry(geometry) {
  // รับแค่ Polygon หรือ MultiPolygon เพื่อให้ geometry ที่บันทึกเป็นแปลงจริง
  if (!geometry || typeof geometry !== "object") {
    throw createHttpError(400, "กรุณาวาดขอบเขตแปลงก่อน");
  }

  if (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon") {
    throw createHttpError(400, "รองรับเฉพาะขอบเขตแปลงแบบ Polygon หรือ MultiPolygon");
  }

  if (!Array.isArray(geometry.coordinates) || geometry.coordinates.length === 0) {
    throw createHttpError(400, "กรุณาวาดขอบเขตแปลงก่อน");
  }

  return geometry;
}

function mapParcelRow(row) {
  // แปลงชื่อคอลัมน์จาก database ให้เป็นชื่อที่ frontend ใช้สะดวก
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    parcelCode: row.parcel_code,
    parcelName: row.parcel_name,
    cropType: row.crop_type,
    riceVariety: row.rice_variety,
    plantingDate: row.planting_date,
    areaSqm: row.area_sqm === null ? null : Number(row.area_sqm),
    areaRai: row.area_rai === null ? null : Number(row.area_rai),
    geometry: row.geometry,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const PARCEL_SELECT_FIELDS = `
  id,
  parcel_code,
  parcel_name,
  crop_type,
  rice_variety,
  to_char(planting_date, 'YYYY-MM-DD') AS planting_date,
  ROUND(ST_Area(geom)::numeric, 2) AS area_sqm,
  ROUND((ST_Area(geom) / 1600.0)::numeric, 2) AS area_rai,
  ST_AsGeoJSON(ST_Transform(geom, 4326))::json AS geometry,
  created_at,
  updated_at
`;

async function createParcel(payload, options = {}) {
  // บันทึกแปลงใน transaction เดียว เพื่อไม่ให้รหัสแปลงกับ geometry หลุดจากกัน
  const geometry = validateGeometry(payload.geometry);
  const parcelName = normalizeText(payload.parcelName);
  const cropType = normalizeText(payload.cropType);
  const riceVariety = normalizeText(payload.riceVariety);
  const plantingDate = validateDate(payload.plantingDate);
  const lineUserId = normalizeText(options.lineUserId);
  const userService = options.appUserService || appUserService;

  if (!cropType) {
    throw createHttpError(400, "กรุณาระบุชนิดพืช");
  }
  if (!lineUserId) {
    throw createHttpError(401, AUTH_REQUIRED_MESSAGE);
  }

  const geometryJson = JSON.stringify(geometry);
  const client = await db.pool.connect();

  try {
    await client.query("BEGIN");
    const appUser = await userService.findOrCreateLineUser(lineUserId, { client });
    const ownerUserId = validateAppUserId(appUser?.id);

    const result = await client.query(
      `
      WITH prepared AS (
        -- แปลง GeoJSON จาก EPSG:4326 ไป EPSG:32647 ก่อนคำนวณพื้นที่จริง
        SELECT ST_Multi(
          ST_CollectionExtract(
            ST_MakeValid(
              ST_Transform(
                ST_SetSRID(ST_GeomFromGeoJSON($1), 4326),
                32647
              )
            ),
            3
          )
        )::geometry(MultiPolygon, 32647) AS geom
      ),
      checked AS (
        SELECT
          geom,
          ST_IsEmpty(geom) AS is_empty,
          ST_IsValid(geom) AS is_valid,
          ST_Area(geom) AS area_sqm
        FROM prepared
      ),
      inserted AS (
        INSERT INTO app.parcels (
          parcel_code,
          parcel_name,
          crop_type,
          rice_variety,
          planting_date,
          geom,
          owner_user_id
        )
        SELECT
          'PY-' ||
            EXTRACT(YEAR FROM CURRENT_DATE)::text ||
            '-' ||
            LPAD(nextval('app.parcel_code_seq')::text, 4, '0'),
          $2,
          $3,
          $4,
          $5::date,
          geom,
          $7::uuid
        FROM checked
        WHERE NOT is_empty
          AND is_valid
          AND area_sqm >= $6
        RETURNING ${PARCEL_SELECT_FIELDS}
      )
      SELECT
        inserted.*,
        (SELECT is_empty FROM checked) AS was_empty,
        (SELECT is_valid FROM checked) AS was_valid,
        (SELECT area_sqm FROM checked) AS checked_area_sqm
      FROM inserted;
      `,
      [
        geometryJson,
        parcelName,
        cropType,
        riceVariety,
        plantingDate,
        MIN_PARCEL_AREA_SQM,
        ownerUserId,
      ],
    );

    if (result.rows.length === 0) {
      const check = await client.query(
        `
        WITH prepared AS (
          SELECT ST_Multi(
            ST_CollectionExtract(
              ST_MakeValid(
                ST_Transform(
                  ST_SetSRID(ST_GeomFromGeoJSON($1), 4326),
                  32647
                )
              ),
              3
            )
          )::geometry(MultiPolygon, 32647) AS geom
        )
        SELECT
          ST_IsEmpty(geom) AS is_empty,
          ST_IsValid(geom) AS is_valid,
          ST_Area(geom) AS area_sqm
        FROM prepared;
        `,
        [geometryJson],
      );

      const row = check.rows[0];
      if (!row || row.is_empty || !row.is_valid) {
        throw createHttpError(400, "ขอบเขตแปลงไม่ถูกต้อง กรุณาวาดใหม่");
      }

      if (Number(row.area_sqm) < MIN_PARCEL_AREA_SQM) {
        throw createHttpError(400, "พื้นที่แปลงมีขนาดเล็กเกินไป กรุณาวาดขอบเขตใหม่");
      }

      throw createHttpError(400, "ไม่สามารถบันทึกแปลงได้ กรุณาลองใหม่");
    }

    await client.query("COMMIT");
    return mapParcelRow(result.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");

    if (error.statusCode) {
      throw error;
    }

    if (
      error.message.includes("invalid GeoJson") ||
      error.message.includes("Geometry SRID") ||
      error.message.includes("Invalid coordinate") ||
      error.message.includes("transform:") ||
      error.message.includes("parse error")
    ) {
      throw createHttpError(400, "ขอบเขตแปลงไม่ถูกต้อง กรุณาวาดใหม่");
    }

    throw error;
  } finally {
    client.release();
  }
}

async function getOwnedParcelById(id, appUserId) {
  // UUID ไม่ถูกต้องต้องตัดทิ้งก่อน ไม่ปล่อยให้ PostgreSQL โยน error ดิบ
  const parcelId = validateUuid(id);
  const ownerUserId = validateAppUserId(appUserId);
  const result = await db.query(
    `
    SELECT ${PARCEL_SELECT_FIELDS}
    FROM app.parcels
    WHERE id = $1
      AND owner_user_id = $2;
    `,
    [parcelId, ownerUserId],
  );

  const parcel = mapParcelRow(result.rows[0]);
  if (!parcel) {
    throw createHttpError(404, PARCEL_NOT_FOUND_MESSAGE);
  }

  return parcel;
}

async function listOwnedParcels(appUserId, { limit } = {}) {
  const ownerUserId = validateAppUserId(appUserId);
  const parsedLimit = Number(limit);
  const safeLimit = Number.isInteger(parsedLimit)
    ? Math.min(Math.max(parsedLimit, 1), MAX_LIMIT)
    : DEFAULT_LIMIT;
  const result = await db.query(
    `
    SELECT ${PARCEL_SELECT_FIELDS}
    FROM app.parcels
    WHERE owner_user_id = $1
    ORDER BY created_at DESC, id DESC
    LIMIT $2;
    `,
    [ownerUserId, safeLimit],
  );

  return result.rows.map(mapParcelRow);
}

async function deleteOwnedParcel(id, appUserId) {
  const parcelId = validateUuid(id);
  const ownerUserId = validateAppUserId(appUserId);
  const result = await db.query(
    `
    DELETE FROM app.parcels
    WHERE id = $1
      AND owner_user_id = $2
    RETURNING id;
    `,
    [parcelId, ownerUserId],
  );

  if (result.rows.length === 0) {
    throw createHttpError(404, PARCEL_NOT_FOUND_MESSAGE);
  }
}

async function updateOwnedParcel(id, payload, appUserId) {
  const parcelId = validateUuid(id);
  const ownerUserId = validateAppUserId(appUserId);
  const hasParcelName = Object.prototype.hasOwnProperty.call(payload, "parcelName");
  const hasCropType = Object.prototype.hasOwnProperty.call(payload, "cropType");
  const hasRiceVariety = Object.prototype.hasOwnProperty.call(payload, "riceVariety");
  const hasPlantingDate = Object.prototype.hasOwnProperty.call(payload, "plantingDate");
  const hasGeometry = Object.prototype.hasOwnProperty.call(payload, "geometry");

  if (!hasParcelName && !hasCropType && !hasRiceVariety && !hasPlantingDate && !hasGeometry) {
    throw createHttpError(400, "ไม่มีข้อมูลสำหรับแก้ไข");
  }

  const parcelName = hasParcelName ? normalizeText(payload.parcelName) : null;
  const cropType = hasCropType ? normalizeText(payload.cropType) : null;
  const riceVariety = hasRiceVariety ? normalizeText(payload.riceVariety) : null;
  const plantingDate = hasPlantingDate ? validateDate(payload.plantingDate) : null;
  const geometry = hasGeometry ? validateGeometry(payload.geometry) : null;

  if (hasCropType && !cropType) {
    throw createHttpError(400, "กรุณาระบุชนิดพืช");
  }

  if (hasGeometry) {
    const geometryJson = JSON.stringify(geometry);
    try {
      const result = await db.query(
        `
        WITH matched AS (
          SELECT id
          FROM app.parcels
          WHERE id = $1
            AND owner_user_id = $11
        ),
        prepared AS (
          SELECT ST_Multi(
            ST_CollectionExtract(
              ST_MakeValid(
                ST_Transform(
                  ST_SetSRID(ST_GeomFromGeoJSON($10), 4326),
                  32647
                )
              ),
              3
            )
          )::geometry(MultiPolygon, 32647) AS geom
        ),
        checked AS (
          SELECT
            geom,
            ST_IsEmpty(geom) AS is_empty,
            ST_IsValid(geom) AS is_valid,
            ST_Area(geom) AS area_sqm
          FROM prepared
        ),
        updated AS (
          UPDATE app.parcels
          SET
            parcel_name = CASE WHEN $2 THEN $3 ELSE parcel_name END,
            crop_type = CASE WHEN $4 THEN $5 ELSE crop_type END,
            rice_variety = CASE WHEN $6 THEN $7 ELSE rice_variety END,
            planting_date = CASE WHEN $8 THEN $9::date ELSE planting_date END,
            geom = checked.geom,
            updated_at = now()
          FROM checked, matched
          WHERE app.parcels.id = matched.id
            AND NOT checked.is_empty
            AND checked.is_valid
            AND checked.area_sqm >= $12
          RETURNING app.parcels.id
        )
        SELECT
          app.parcels.id,
          app.parcels.parcel_code,
          app.parcels.parcel_name,
          app.parcels.crop_type,
          app.parcels.rice_variety,
          to_char(app.parcels.planting_date, 'YYYY-MM-DD') AS planting_date,
          ROUND(ST_Area(app.parcels.geom)::numeric, 2) AS area_sqm,
          ROUND((ST_Area(app.parcels.geom) / 1600.0)::numeric, 2) AS area_rai,
          ST_AsGeoJSON(ST_Transform(app.parcels.geom, 4326))::json AS geometry,
          app.parcels.created_at,
          app.parcels.updated_at,
          checked.is_empty AS was_empty,
          checked.is_valid AS was_valid,
          checked.area_sqm AS checked_area_sqm,
          (SELECT COUNT(*)::int FROM matched) AS matched_count
        FROM checked
        LEFT JOIN updated ON true
        LEFT JOIN app.parcels ON app.parcels.id = updated.id;
        `,
        [
          parcelId,
          hasParcelName,
          parcelName,
          hasCropType,
          cropType,
          hasRiceVariety,
          riceVariety,
          hasPlantingDate,
          plantingDate,
          geometryJson,
          ownerUserId,
          MIN_PARCEL_AREA_SQM,
        ],
      );

      const row = result.rows[0];
      const parcel = row && row.id ? mapParcelRow(row) : null;
      if (parcel) {
        return parcel;
      }

      if (!row || Number(row.matched_count) === 0) {
        throw createHttpError(404, PARCEL_NOT_FOUND_MESSAGE);
      }

      if (row.was_empty || !row.was_valid) {
        throw createHttpError(400, "ขอบเขตแปลงไม่ถูกต้อง กรุณาวาดใหม่");
      }

      if (Number(row.checked_area_sqm) < MIN_PARCEL_AREA_SQM) {
        throw createHttpError(400, "พื้นที่แปลงมีขนาดเล็กเกินไป กรุณาวาดขอบเขตใหม่");
      }

      throw createHttpError(400, "ไม่สามารถบันทึกขอบเขตแปลงได้ กรุณาลองใหม่");
    } catch (error) {
      if (error.statusCode) {
        throw error;
      }

      if (
        error.message.includes("invalid GeoJson") ||
        error.message.includes("Geometry SRID") ||
        error.message.includes("Invalid coordinate") ||
        error.message.includes("transform:") ||
        error.message.includes("parse error")
      ) {
        throw createHttpError(400, "ขอบเขตแปลงไม่ถูกต้อง กรุณาวาดใหม่");
      }

      throw error;
    }
  }

  const result = await db.query(
    `
    UPDATE app.parcels
    SET
      parcel_name = CASE WHEN $2 THEN $3 ELSE parcel_name END,
      crop_type = CASE WHEN $4 THEN $5 ELSE crop_type END,
      rice_variety = CASE WHEN $6 THEN $7 ELSE rice_variety END,
      planting_date = CASE WHEN $8 THEN $9::date ELSE planting_date END,
      updated_at = now()
    WHERE id = $1
      AND owner_user_id = $10
    RETURNING ${PARCEL_SELECT_FIELDS};
    `,
    [
      parcelId,
      hasParcelName,
      parcelName,
      hasCropType,
      cropType,
      hasRiceVariety,
      riceVariety,
      hasPlantingDate,
      plantingDate,
      ownerUserId,
    ],
  );

  const parcel = mapParcelRow(result.rows[0]);
  if (!parcel) {
    throw createHttpError(404, PARCEL_NOT_FOUND_MESSAGE);
  }

  return parcel;
}

async function getOwnedParcelAnalysisInput(id, appUserId) {
  const parcelId = validateUuid(id);
  const ownerUserId = validateAppUserId(appUserId);
  const result = await db.query(
    `
    SELECT
      id,
      COALESCE(NULLIF(parcel_name, ''), parcel_code) AS analysis_name,
      ST_AsGeoJSON(ST_Transform(geom, 4326))::json AS geometry
    FROM app.parcels
    WHERE id = $1
      AND owner_user_id = $2;
    `,
    [parcelId, ownerUserId],
  );

  const row = result.rows[0];
  if (!row) {
    throw createHttpError(404, PARCEL_NOT_FOUND_MESSAGE);
  }

  return {
    id: row.id,
    name: row.analysis_name,
    geometry: row.geometry,
  };
}

module.exports = {
  createParcel,
  getOwnedParcelById,
  listOwnedParcels,
  updateOwnedParcel,
  deleteOwnedParcel,
  getOwnedParcelAnalysisInput,
  _private: {
    mapParcelRow,
    normalizeText,
    validateDate,
    validateGeometry,
    validateUuid,
  },
};
