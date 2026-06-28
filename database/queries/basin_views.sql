-- สร้าง view สำหรับ basin main และ sub-basin โดยไม่แตะตารางต้นทาง gis.basin
DROP VIEW IF EXISTS gis.sub_basin_display;
DROP VIEW IF EXISTS gis.basin_main;

-- รวม polygon ที่เป็น basin เดียวกันให้เหลือ geometry เดียวสำหรับแสดงผลบน WMS
CREATE OR REPLACE VIEW gis.basin_main AS
SELECT
  ROW_NUMBER() OVER (
    ORDER BY "BASIN_NA", "BASIN_ID"
  )::integer AS id,
  "BASIN_ID" AS basin_id,
  "BASIN_NA" AS basin_name,
  ST_Multi(
    ST_UnaryUnion(
      ST_Collect(geom)
    )
  )::geometry(MultiPolygon, 32647) AS geom
FROM gis.basin
WHERE "BASIN_NA" IS NOT NULL
  AND btrim("BASIN_NA") <> ''
GROUP BY
  "BASIN_ID",
  "BASIN_NA";

-- แสดง sub-basin แยกตามชื่อย่อย แต่ยังผูกกลับไปยัง basin หลักได้
CREATE OR REPLACE VIEW gis.sub_basin_display AS
SELECT
  ROW_NUMBER() OVER (
    ORDER BY "BASIN_NA", "S_BASIN_NA", "BASIN_ID", "S_BASIN_ID"
  )::integer AS id,
  "BASIN_ID" AS basin_id,
  "BASIN_NA" AS basin_name,
  "S_BASIN_ID" AS sub_basin_id,
  "S_BASIN_NA" AS sub_basin_name,
  ST_Multi(
    ST_UnaryUnion(
      ST_Collect(geom)
    )
  )::geometry(MultiPolygon, 32647) AS geom
FROM gis.basin
WHERE "BASIN_NA" IS NOT NULL
  AND btrim("BASIN_NA") <> ''
  AND "S_BASIN_NA" IS NOT NULL
  AND btrim("S_BASIN_NA") <> ''
GROUP BY
  "BASIN_ID",
  "BASIN_NA",
  "S_BASIN_ID",
  "S_BASIN_NA";

-- ตรวจ geometry หลังรวมแล้ว เพื่อดูว่ามี invalid polygon เหลือหรือไม่
SELECT
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE NOT ST_IsValid(geom)) AS invalid
FROM gis.basin_main;

SELECT
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE NOT ST_IsValid(geom)) AS invalid
FROM gis.sub_basin_display;
