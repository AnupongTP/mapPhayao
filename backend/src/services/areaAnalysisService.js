const db = require("../config/database");

const MIN_ANALYSIS_AREA_SQM = 10;

const CLASS_ORDER = {
  S1: 1,
  S2: 2,
  S3: 3,
  N: 4,
};

const CLASS_LABELS = {
  S1: "เหมาะสมมาก",
  S2: "เหมาะสมปานกลาง",
  S3: "เหมาะสมน้อย",
  N: "ไม่เหมาะสม",
};

const PREPARED_PARCEL_CTE = `
WITH parcel AS (
  SELECT ST_Multi(
    ST_CollectionExtract(
      ST_MakeValid(
        ST_Transform(
          ST_SetSRID(
            ST_GeomFromGeoJSON($1),
            4326
          ),
          32647
        )
      ),
      3
    )
  ) AS geom
),
parcel_checked AS (
  SELECT
    geom,
    ST_IsEmpty(geom) AS is_empty,
    ST_IsValid(geom) AS is_valid,
    ST_Area(geom) AS area_sqm
  FROM parcel
)
`;

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function toNumberOrNull(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function toRoundedNumber(value) {
  const number = toNumberOrNull(value);
  return number === null ? null : Number(number.toFixed(2));
}

function dedupeStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.trim()))];
}

async function getParcelMeta(geometryJson) {
  const result = await db.query(
    `
    ${PREPARED_PARCEL_CTE}
    SELECT
      ST_GeometryType(geom) AS geometry_type,
      is_empty,
      is_valid,
      area_sqm,
      ROUND(area_sqm::numeric, 2) AS area_square_meters,
      ROUND((area_sqm / 1600.0)::numeric, 2) AS area_rai
    FROM parcel_checked;
    `,
    [geometryJson],
  );

  const row = result.rows[0];
  if (!row) {
    throw createHttpError(400, "ไม่สามารถเตรียมขอบเขตพื้นที่แปลงได้");
  }

  if (row.is_empty || !row.is_valid) {
    throw createHttpError(400, "ขอบเขตพื้นที่แปลงไม่ถูกต้อง");
  }

  if (toNumberOrNull(row.area_sqm) < MIN_ANALYSIS_AREA_SQM) {
    throw createHttpError(400, "พื้นที่แปลงมีขนาดเล็กเกินไปสำหรับการวิเคราะห์");
  }

  return {
    areaSquareMeters: toRoundedNumber(row.area_square_meters),
    areaRai: toRoundedNumber(row.area_rai),
    geometryType: String(row.geometry_type || "").replace(/^ST_/u, ""),
  };
}

async function getAdministrativeRows(geometryJson) {
  const [amphoeResult, tambonResult, basinResult] = await Promise.all([
    db.query(
      `
      ${PREPARED_PARCEL_CTE}
      SELECT
        a.province_t AS province_name,
        a.amphoe_t AS amphoe_name,
        ROUND(ST_Area(ST_Intersection(a.geom, p.geom))::numeric, 2) AS area_sqm
      FROM gis.amphoe a
      CROSS JOIN parcel_checked p
      WHERE a.geom && p.geom
        AND ST_Intersects(a.geom, p.geom)
        AND NOT p.is_empty
      ORDER BY area_sqm DESC, a.amphoe_t ASC;
      `,
      [geometryJson],
    ),
    db.query(
      `
      ${PREPARED_PARCEL_CTE}
      SELECT
        t.changwat AS province_name,
        t.amphoe AS amphoe_name,
        t.tambon AS tambon_name,
        ROUND(ST_Area(ST_Intersection(t.geom, p.geom))::numeric, 2) AS area_sqm
      FROM gis.tambon t
      CROSS JOIN parcel_checked p
      WHERE t.geom && p.geom
        AND ST_Intersects(t.geom, p.geom)
        AND NOT p.is_empty
      ORDER BY area_sqm DESC, t.tambon ASC;
      `,
      [geometryJson],
    ),
    db.query(
      `
      ${PREPARED_PARCEL_CTE}
      SELECT
        b."BASIN_NA" AS basin_name,
        b."S_BASIN_NA" AS sub_basin_name,
        ROUND(ST_Area(ST_Intersection(b.geom, p.geom))::numeric, 2) AS area_sqm
      FROM gis.basin b
      CROSS JOIN parcel_checked p
      WHERE b.geom && p.geom
        AND ST_Intersects(b.geom, p.geom)
        AND NOT p.is_empty
      ORDER BY area_sqm DESC, b."BASIN_NA" ASC, b."S_BASIN_NA" ASC;
      `,
      [geometryJson],
    ),
  ]);

  return {
    amphoes: amphoeResult.rows,
    tambons: tambonResult.rows,
    basins: basinResult.rows,
  };
}

async function getSuitabilityRows(geometryJson, tableName) {
  return db.query(
    `
    ${PREPARED_PARCEL_CTE}
    , parcel_meta AS (
      SELECT geom, area_sqm
      FROM parcel_checked
      WHERE NOT is_empty
        AND is_valid
    ),
    class_areas AS (
      SELECT
        src.suitability_class,
        COALESCE(src.suitability_label_th, CASE src.suitability_class
          WHEN 'S1' THEN 'เหมาะสมมาก'
          WHEN 'S2' THEN 'เหมาะสมปานกลาง'
          WHEN 'S3' THEN 'เหมาะสมน้อย'
          WHEN 'N' THEN 'ไม่เหมาะสม'
          ELSE src.suitability_class
        END) AS suitability_label_th,
        SUM(ST_Area(ST_Intersection(src.geom, p.geom))) AS class_area_sqm
      FROM ${tableName} src
      CROSS JOIN parcel_meta p
      WHERE src.geom && p.geom
        AND ST_Intersects(src.geom, p.geom)
      GROUP BY src.suitability_class, suitability_label_th
    )
    SELECT
      suitability_class,
      suitability_label_th,
      ROUND(class_area_sqm::numeric, 2) AS area_square_meters,
      ROUND((class_area_sqm / 1600.0)::numeric, 2) AS area_rai,
      ROUND((class_area_sqm / p.area_sqm * 100)::numeric, 2) AS percent_of_parcel
    FROM class_areas
    CROSS JOIN parcel_meta p
    WHERE class_area_sqm > 0
    ORDER BY CASE suitability_class
      WHEN 'S1' THEN 1
      WHEN 'S2' THEN 2
      WHEN 'S3' THEN 3
      WHEN 'N' THEN 4
      ELSE 99
    END;
    `,
    [geometryJson],
  );
}

async function getSoilRows(geometryJson) {
  return db.query(
    `
    ${PREPARED_PARCEL_CTE}
    , parcel_meta AS (
      SELECT geom, area_sqm
      FROM parcel_checked
      WHERE NOT is_empty
        AND is_valid
    )
    SELECT
      s.series_no,
      s.soilname_t,
      s.drainage_desc_t,
      s.depth_desc_t,
      s.data_status,
      ROUND(SUM(ST_Area(ST_Intersection(s.geom, p.geom)))::numeric, 2) AS area_square_meters,
      ROUND((SUM(ST_Area(ST_Intersection(s.geom, p.geom))) / 1600.0)::numeric, 2) AS area_rai,
      ROUND((SUM(ST_Area(ST_Intersection(s.geom, p.geom))) / p.area_sqm * 100)::numeric, 2) AS percent_of_parcel
    FROM gis.soil_enriched_basic s
    CROSS JOIN parcel_meta p
    WHERE s.geom && p.geom
      AND ST_Intersects(s.geom, p.geom)
    GROUP BY
      s.series_no,
      s.soilname_t,
      s.drainage_desc_t,
      s.depth_desc_t,
      s.data_status,
      p.area_sqm
    HAVING SUM(ST_Area(ST_Intersection(s.geom, p.geom))) > 0
    ORDER BY area_square_meters DESC, s.series_no ASC
    LIMIT 5;
    `,
    [geometryJson],
  );
}

async function getNearestWaterRows(geometryJson) {
  const [streamResult, canalResult] = await Promise.all([
    db.query(
      `
      ${PREPARED_PARCEL_CTE}
      SELECT
        s.id,
        s.stream_id,
        s.str_class,
        s.str_order,
        s."STR_CL_T" AS stream_type,
        s."STR_NAME_T" AS stream_name,
        ROUND(ST_Distance(s.geom, p.geom)::numeric, 2) AS distance_m
      FROM gis.stream s
      CROSS JOIN parcel_checked p
      WHERE NOT p.is_empty
        AND p.is_valid
      ORDER BY s.geom <-> p.geom
      LIMIT 1;
      `,
      [geometryJson],
    ),
    db.query(
      `
      ${PREPARED_PARCEL_CTE}
      SELECT
        c.id,
        c.stream_id,
        c.str_class,
        c.str_order,
        c.str_cl_t AS canal_type,
        c.str_name_t AS canal_name,
        ROUND(ST_Distance(c.geom, p.geom)::numeric, 2) AS distance_m
      FROM gis.irrigation_canal c
      CROSS JOIN parcel_checked p
      WHERE NOT p.is_empty
        AND p.is_valid
      ORDER BY c.geom <-> p.geom
      LIMIT 1;
      `,
      [geometryJson],
    ),
  ]);

  return {
    stream: streamResult.rows[0] || null,
    canal: canalResult.rows[0] || null,
  };
}

function buildLocationResponse(rows) {
  const provinceCandidates = dedupeStrings([
    ...rows.amphoes.map((row) => row.province_name),
    ...rows.tambons.map((row) => row.province_name),
  ]);
  const amphoes = dedupeStrings(rows.amphoes.map((row) => row.amphoe_name));
  const tambons = dedupeStrings(rows.tambons.map((row) => row.tambon_name));
  const mainBasins = dedupeStrings(rows.basins.map((row) => row.basin_name));
  const subBasins = dedupeStrings(rows.basins.map((row) => row.sub_basin_name));

  return {
    province: provinceCandidates[0] || null,
    provinces: provinceCandidates,
    amphoes,
    tambons,
    mainBasins,
    subBasins,
    dominantAmphoe: rows.amphoes[0]?.amphoe_name ?? null,
    dominantTambon: rows.tambons[0]?.tambon_name ?? null,
    dominantMainBasin: rows.basins[0]?.basin_name ?? null,
    dominantSubBasin: rows.basins[0]?.sub_basin_name ?? null,
  };
}

function buildSuitabilityResponse(rows, options) {
  const classes = rows
    .map((row) => ({
      class: row.suitability_class,
      label: row.suitability_label_th || CLASS_LABELS[row.suitability_class] || row.suitability_class,
      areaSquareMeters: toRoundedNumber(row.area_square_meters),
      areaRai: toRoundedNumber(row.area_rai),
      percentOfParcel: toRoundedNumber(row.percent_of_parcel),
    }))
    .sort((left, right) => (CLASS_ORDER[left.class] || 99) - (CLASS_ORDER[right.class] || 99));

  const coverageAreaSquareMeters = classes.reduce(
    (sum, item) => sum + (item.areaSquareMeters || 0),
    0,
  );
  const coverageAreaRai = classes.reduce((sum, item) => sum + (item.areaRai || 0), 0);
  const coveragePercent = classes.reduce((sum, item) => sum + (item.percentOfParcel || 0), 0);
  const dominantClass = classes.reduce((current, item) => {
    if (!current) {
      return item;
    }
    return (item.areaSquareMeters || 0) > (current.areaSquareMeters || 0) ? item : current;
  }, null);

  return {
    evaluationMethod: options.evaluationMethod,
    sourceName: "กรมพัฒนาที่ดิน",
    sourceDataset: options.sourceDataset,
    coverageAreaSquareMeters: toRoundedNumber(coverageAreaSquareMeters),
    coverageAreaRai: toRoundedNumber(coverageAreaRai),
    coveragePercent: toRoundedNumber(coveragePercent),
    dominantClass: dominantClass
      ? {
          class: dominantClass.class,
          label: dominantClass.label,
        }
      : null,
    classes,
    status: classes.length ? "AVAILABLE" : "NO_COVERAGE",
  };
}

function buildSoilSummary(rows) {
  const items = rows.map((row) => ({
    seriesNo: toNumberOrNull(row.series_no),
    soilNameThai: row.soilname_t ?? null,
    drainage: row.drainage_desc_t ?? null,
    effectiveDepth: row.depth_desc_t ?? null,
    dataStatus: row.data_status ?? null,
    areaSquareMeters: toRoundedNumber(row.area_square_meters),
    areaRai: toRoundedNumber(row.area_rai),
    percentOfParcel: toRoundedNumber(row.percent_of_parcel),
  }));

  return {
    coveragePercent: toRoundedNumber(
      items.reduce((sum, item) => sum + (item.percentOfParcel || 0), 0),
    ),
    items,
  };
}

function buildWaterResponse(rows) {
  return {
    nearestStream: rows.stream
      ? {
          id: toNumberOrNull(rows.stream.id),
          streamId: rows.stream.stream_id ?? null,
          streamClass: toNumberOrNull(rows.stream.str_class),
          streamOrder: toNumberOrNull(rows.stream.str_order),
          streamType: rows.stream.stream_type ?? null,
          streamName: rows.stream.stream_name ?? null,
          distanceM: toRoundedNumber(rows.stream.distance_m),
        }
      : null,
    nearestIrrigationCanal: rows.canal
      ? {
          id: toNumberOrNull(rows.canal.id),
          streamId: rows.canal.stream_id ?? null,
          streamClass: toNumberOrNull(rows.canal.str_class),
          streamOrder: toNumberOrNull(rows.canal.str_order),
          canalType: rows.canal.canal_type ?? null,
          canalName: rows.canal.canal_name ?? null,
          distanceM: toRoundedNumber(rows.canal.distance_m),
        }
      : null,
  };
}

async function analyzePolygon({ name, geometry }) {
  const geometryJson = JSON.stringify(geometry);

  try {
    const parcel = await getParcelMeta(geometryJson);
    const [
      administrativeRows,
      riceResult,
      maizeResult,
      soilResult,
      waterRows,
    ] = await Promise.all([
      getAdministrativeRows(geometryJson),
      getSuitabilityRows(geometryJson, "gis.rice_potential"),
      getSuitabilityRows(geometryJson, "gis.maize_potential"),
      getSoilRows(geometryJson),
      getNearestWaterRows(geometryJson),
    ]);

    return {
      success: true,
      name,
      parcel: {
        areaSquareMeters: parcel.areaSquareMeters,
        areaRai: parcel.areaRai,
        geometryType: geometry.type,
      },
      location: buildLocationResponse(administrativeRows),
      riceLandSuitability: buildSuitabilityResponse(riceResult.rows, {
        evaluationMethod: "LDD_RICE_POTENTIAL_AREA_OVERLAY",
        sourceDataset: "ความเหมาะสมของที่ดินสำหรับปลูกข้าว",
      }),
      maizeLandSuitability: buildSuitabilityResponse(maizeResult.rows, {
        evaluationMethod: "LDD_MAIZE_POTENTIAL_AREA_OVERLAY",
        sourceDataset: "ความเหมาะสมของที่ดินสำหรับปลูกข้าวโพด",
      }),
      soilSummary: buildSoilSummary(soilResult.rows),
      water: buildWaterResponse(waterRows),
      overallStatus: {
        finalClass: null,
        status: "NOT_FULLY_EVALUATED",
        label: "ยังไม่ได้ประเมินครบทุกปัจจัย",
      },
    };
  } catch (error) {
    if (
      error.message.includes("GeoJSON") ||
      error.message.includes("parse error") ||
      error.message.includes("invalid GeoJson") ||
      error.message.includes("geometry requires more points") ||
      error.message.includes("invalid coordinate")
    ) {
      throw createHttpError(400, "geometry is invalid");
    }

    throw error;
  }
}

module.exports = {
  analyzePolygon,
};
