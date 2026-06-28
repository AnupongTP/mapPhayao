-- สร้าง schema และตารางแปลงเกษตรสำหรับเก็บ Polygon/MultiPolygon ที่ผู้ใช้วาด
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS app;

-- ใช้ sequence สร้าง parcel_code แบบไม่ซ้ำในรูป PY-{YEAR}-{SEQUENCE}
CREATE SEQUENCE IF NOT EXISTS app.parcel_code_seq;

CREATE TABLE IF NOT EXISTS app.parcels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parcel_code varchar(30) NOT NULL UNIQUE,
  parcel_name varchar(150),
  crop_type varchar(100) NOT NULL DEFAULT 'ข้าว',
  rice_variety varchar(150),
  planting_date date,
  geom geometry(MultiPolygon, 32647) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS parcels_geom_gix
ON app.parcels
USING GIST (geom);

-- อัปเดตเวลาล่าสุดทุกครั้งที่มีการแก้ไขแปลง
CREATE OR REPLACE FUNCTION app.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS parcels_set_updated_at ON app.parcels;

-- trigger นี้ดูแล updated_at โดยอัตโนมัติ
CREATE TRIGGER parcels_set_updated_at
BEFORE UPDATE ON app.parcels
FOR EACH ROW
EXECUTE FUNCTION app.set_updated_at();
