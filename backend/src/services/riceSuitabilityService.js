// Service point analysis: รวมข้อมูลตำบล อำเภอ ลุ่มน้ำ ชุดดิน และ Potential layer
const db = require("../config/database");
const { evaluateSoilSuitability } = require("./soilSuitabilityEvaluator");

const POINT_QUERY = `
-- สร้างจุดที่ผู้ใช้ยืนยันจาก longitude/latitude แล้วแปลงไป EPSG:32647
WITH clicked_point AS (
  SELECT ST_Transform(
    ST_SetSRID(
      ST_MakePoint($1::double precision, $2::double precision),
      4326
    ),
    32647
  ) AS geom
)
SELECT
  row_to_json(amphoe_row) AS amphoe,
  row_to_json(tambon_row) AS tambon,
  row_to_json(basin_row) AS basin,
  row_to_json(soil_row) AS soil,
  row_to_json(rice_potential_row) AS rice_potential,
  row_to_json(stream_row) AS nearest_stream,
  row_to_json(canal_row) AS nearest_irrigation_canal
FROM clicked_point p
LEFT JOIN LATERAL (
  -- ใช้ ST_Covers เพื่อให้จุดที่อยู่บนขอบ polygon ยังถือว่าอยู่ในพื้นที่ด้วย
  SELECT
    a.id,
    a.amp_code,
    a.amphoe_t,
    a.amphoe_e,
    a.province_t,
    a.province_e
  FROM gis.amphoe a
  WHERE ST_Covers(a.geom, p.geom)
  LIMIT 1
) amphoe_row ON true
LEFT JOIN LATERAL (
  -- Official LDD Potential layer: คืน S1/S2/S3/N จาก geometry ที่ครอบจุด
  SELECT
    t.id,
    t.sdist_code,
    t.tambon,
    t.amphoe,
    t.changwat
  FROM gis.tambon t
  WHERE ST_Covers(t.geom, p.geom)
  LIMIT 1
) tambon_row ON true
LEFT JOIN LATERAL (
  SELECT
    b.id,
    b."BASIN_ID" AS basin_id,
    b."BASIN_NA" AS basin_name,
    b."S_BASIN_ID" AS sub_basin_id,
    b."S_BASIN_NA" AS sub_basin_name
  FROM gis.basin b
  WHERE ST_Covers(b.geom, p.geom)
  LIMIT 1
) basin_row ON true
LEFT JOIN LATERAL (
  SELECT
    s.gid,
    s.series_no,
    s.soilname_t,
    s.soilname_e,
    s.drainage,
    s.drainage_desc_t,
    s.drainage_desc_e,
    s.eff_depth,
    s.depth_desc_t,
    s.depth_desc_e,
    s.data_status,
    s.missing_fields,
    s.horizon_count,
    s.profile_min_depth_cm,
    s.profile_max_depth_cm,
    s.surface_horizon,
    s.surface_texture_code,
    s.surface_texture_th,
    s.surface_texture_en,
    s.surface_ph_water,
    s.surface_ph_kcl,
    s.surface_sand_pct,
    s.surface_silt_pct,
    s.surface_clay_pct,
    s.profile_data_status
  FROM gis.soil_enriched_basic s
  WHERE ST_Covers(s.geom, p.geom)
  LIMIT 1
) soil_row ON true
LEFT JOIN LATERAL (
  SELECT
    rp.id,
    rp.suitability_class,
    rp.suitability_label_th,
    rp.source_name,
    rp.source_area_sqm,
    rp.source_area_rai,
    rp.tambon_name,
    rp.amphoe_name,
    rp.province_name
  FROM gis.rice_potential rp
  WHERE ST_Covers(rp.geom, p.geom)
  ORDER BY
    ST_Contains(rp.geom, p.geom) DESC,
    ST_Area(rp.geom) ASC,
    rp.id ASC
  LIMIT 1
) rice_potential_row ON true
LEFT JOIN LATERAL (
  SELECT
    s.id,
    s.stream_id,
    s.str_class,
    s.str_order,
    s."STR_CL_T" AS stream_type,
    s."STR_NAME_T" AS stream_name,
    ROUND(ST_Distance(s.geom, p.geom)::numeric, 2) AS distance_m
  FROM gis.stream s
  ORDER BY s.geom <-> p.geom
  LIMIT 1
) stream_row ON true
LEFT JOIN LATERAL (
  SELECT
    c.id,
    c.stream_id,
    c.str_class,
    c.str_cl_t AS canal_type,
    c.str_name_t AS canal_name,
    ROUND(ST_Distance(c.geom, p.geom)::numeric, 2) AS distance_m
  FROM gis.irrigation_canal c
  ORDER BY c.geom <-> p.geom
  LIMIT 1
) canal_row ON true;
`;

function toNumberOrNull(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function toArrayOrEmpty(value) {
  return Array.isArray(value) ? value : [];
}

async function getPointSummary({ latitude, longitude }) {
  if (!isInsideUtm47NorthDomain({ latitude, longitude })) {
    const soilSuitability = await evaluateSoilSuitability(null);
    const riceLandSuitability = buildRiceLandSuitability(null);

    return buildPointResponse({
      latitude,
      longitude,
      row: buildEmptyQueryRow(),
      soilSuitability,
      riceLandSuitability,
    });
  }

  const result = await db.query(POINT_QUERY, [longitude, latitude]);
  const row = result.rows[0] || buildEmptyQueryRow();
  const soilSuitability = await evaluateSoilSuitability(row.soil || null);
  const riceLandSuitability = buildRiceLandSuitability(row.rice_potential || null);

  return buildPointResponse({
    latitude,
    longitude,
    row,
    soilSuitability,
    riceLandSuitability,
  });
}

function buildPointResponse({
  latitude,
  longitude,
  row,
  soilSuitability,
  riceLandSuitability,
}) {
  // soil กับ riceLandSuitability คนละเรื่อง: soil คือคุณสมบัติดิน, Potential คือชั้นความเหมาะสมที่ดิน
  const amphoe = row.amphoe;
  const tambon = row.tambon;
  const basin = row.basin;
  const soil = row.soil;
  const ricePotential = row.rice_potential;
  const nearestStream = row.nearest_stream;
  const nearestIrrigationCanal = row.nearest_irrigation_canal;
  const found = Boolean(amphoe || tambon || basin || soil || ricePotential);
  const suitabilityStatus = riceLandSuitability.class
    ? "PARTIALLY_EVALUATED"
    : "NOT_EVALUATED";

  return {
    success: true,
    found,
    clickedPoint: {
      latitude,
      longitude,
    },
    location: {
      province: amphoe?.province_t ?? tambon?.changwat ?? null,
      amphoe: amphoe?.amphoe_t ?? tambon?.amphoe ?? null,
      tambon: tambon?.tambon ?? null,
      basin: basin?.basin_name ?? null,
      subBasin: basin?.sub_basin_name ?? null,
    },
    soil: buildSoilResponse({ soil, soilSuitability }),
    riceLandSuitability,
    water: {
      nearestStream: nearestStream
        ? {
            id: toNumberOrNull(nearestStream.id),
            streamId: nearestStream.stream_id ?? null,
            streamClass: toNumberOrNull(nearestStream.str_class),
            streamOrder: toNumberOrNull(nearestStream.str_order),
            streamType: nearestStream.stream_type ?? null,
            streamName: nearestStream.stream_name ?? null,
            distanceM: toNumberOrNull(nearestStream.distance_m),
          }
        : null,
      nearestIrrigationCanal: nearestIrrigationCanal
        ? {
            id: toNumberOrNull(nearestIrrigationCanal.id),
            streamId: nearestIrrigationCanal.stream_id ?? null,
            streamClass: toNumberOrNull(nearestIrrigationCanal.str_class),
            canalType: nearestIrrigationCanal.canal_type ?? null,
            canalName: nearestIrrigationCanal.canal_name ?? null,
            distanceM: toNumberOrNull(nearestIrrigationCanal.distance_m),
        }
        : null,
    },
    soilSuitability,
    waterRegime: "UNKNOWN",
    suitability: {
      landClass: riceLandSuitability.class ?? null,
      soilClass: null,
      waterClass: null,
      irrigationClass: null,
      terrainClass: null,
      finalClass: null,
      status: suitabilityStatus,
    },
  };
}

function buildSoilResponse({ soil, soilSuitability }) {
  // ข้อมูลชุดดินยังแยกจาก class ความเหมาะสมของที่ดิน เพื่อไม่ให้ผู้ใช้อ่านสับสน
  if (!soil) {
    return null;
  }

  return {
    gid: toNumberOrNull(soil.gid),
    seriesNo: toNumberOrNull(soil.series_no),
    soilSymbol: soilSuitability.soilSymbol ?? null,
    soilNameThai: soil.soilname_t ?? null,
    soilNameEnglish: soil.soilname_e ?? null,
    drainageCode: toNumberOrNull(soil.drainage),
    drainageDescriptionThai: soil.drainage_desc_t ?? null,
    drainageDescriptionEnglish: soil.drainage_desc_e ?? null,
    effectiveDepthCode: toNumberOrNull(soil.eff_depth),
    depthDescriptionThai: soil.depth_desc_t ?? null,
    depthDescriptionEnglish: soil.depth_desc_e ?? null,
    dataStatus: soil.data_status ?? null,
    missingFields: toArrayOrEmpty(soil.missing_fields),
    horizonCount: toNumberOrNull(soil.horizon_count),
    profileMinDepthCm: toNumberOrNull(soil.profile_min_depth_cm),
    profileMaxDepthCm: toNumberOrNull(soil.profile_max_depth_cm),
    surfaceHorizon: soil.surface_horizon ?? null,
    surfaceTextureCode: toNumberOrNull(soil.surface_texture_code),
    surfaceTextureThai: soil.surface_texture_th ?? null,
    surfaceTextureEnglish: soil.surface_texture_en ?? null,
    surfacePhWater: toNumberOrNull(soil.surface_ph_water),
    surfacePhKcl: toNumberOrNull(soil.surface_ph_kcl),
    surfaceSandPercent: toNumberOrNull(soil.surface_sand_pct),
    surfaceSiltPercent: toNumberOrNull(soil.surface_silt_pct),
    surfaceClayPercent: toNumberOrNull(soil.surface_clay_pct),
    profileDataStatus: soil.profile_data_status ?? null,
  };
}

function buildRiceLandSuitability(ricePotential) {
  // ถ้า polygon ชั้น Potential ไม่มี coverage ให้ส่งสถานะ NO_COVERAGE แทน error
  if (!ricePotential) {
    return {
      class: null,
      label: "ไม่มีข้อมูล",
      evaluationMethod: "LDD_RICE_POTENTIAL_OVERLAY",
      sourceName: "กรมพัฒนาที่ดิน",
      sourceDataset: "ความเหมาะสมของที่ดินสำหรับปลูกข้าว",
      sourceYear: null,
      status: "NO_COVERAGE",
    };
  }

  return {
    class: ricePotential.suitability_class ?? null,
    label: ricePotential.suitability_label_th ?? null,
    evaluationMethod: "LDD_RICE_POTENTIAL_OVERLAY",
    sourceName: ricePotential.source_name ?? "กรมพัฒนาที่ดิน",
    sourceDataset: "ความเหมาะสมของที่ดินสำหรับปลูกข้าว",
    sourceYear: null,
    status: ricePotential.suitability_class ? "AVAILABLE" : "NO_COVERAGE",
  };
}

function isInsideUtm47NorthDomain({ latitude, longitude }) {
  return latitude >= 0 && latitude <= 84 && longitude >= 96 && longitude <= 102;
}

function buildEmptyQueryRow() {
  return {
    amphoe: null,
    tambon: null,
    basin: null,
    soil: null,
    nearest_stream: null,
    nearest_irrigation_canal: null,
  };
}

module.exports = {
  POINT_QUERY,
  getPointSummary,
};
