-- Disposable local GIS fixtures derived from the columns used by backend services.
CREATE SCHEMA gis;
CREATE SCHEMA ref;

CREATE TABLE gis.amphoe (
  id integer PRIMARY KEY,
  amp_code text,
  amphoe_t text,
  amphoe_e text,
  province_t text,
  province_e text,
  geom geometry(MultiPolygon, 32647) NOT NULL
);
CREATE TABLE gis.tambon (
  id integer PRIMARY KEY,
  sdist_code text,
  tambon text,
  amphoe text,
  changwat text,
  geom geometry(MultiPolygon, 32647) NOT NULL
);
CREATE TABLE gis.basin (
  id integer PRIMARY KEY,
  "BASIN_ID" text,
  "BASIN_NA" text,
  "S_BASIN_ID" text,
  "S_BASIN_NA" text,
  geom geometry(MultiPolygon, 32647) NOT NULL
);
CREATE TABLE gis.soil_enriched_basic (
  gid integer PRIMARY KEY,
  series_no integer,
  soilname_t text,
  soilname_e text,
  drainage text,
  drainage_desc_t text,
  drainage_desc_e text,
  eff_depth numeric,
  depth_desc_t text,
  depth_desc_e text,
  data_status text,
  missing_fields jsonb,
  horizon_count integer,
  profile_min_depth_cm numeric,
  profile_max_depth_cm numeric,
  surface_horizon text,
  surface_texture_code text,
  surface_texture_th text,
  surface_texture_en text,
  surface_ph_water numeric,
  surface_ph_kcl numeric,
  surface_sand_pct numeric,
  surface_silt_pct numeric,
  surface_clay_pct numeric,
  profile_data_status text,
  geom geometry(MultiPolygon, 32647) NOT NULL
);
CREATE TABLE gis.rice_potential (
  id integer PRIMARY KEY,
  suitability_class text,
  suitability_label_th text,
  source_name text,
  source_area_sqm numeric,
  source_area_rai numeric,
  tambon_name text,
  amphoe_name text,
  province_name text,
  geom geometry(MultiPolygon, 32647) NOT NULL
);
CREATE TABLE gis.maize_potential (
  id integer PRIMARY KEY,
  suitability_class text,
  suitability_label_th text,
  source_name text,
  source_dataset text,
  source_year integer,
  source_area_sqm numeric,
  source_area_rai numeric,
  tambon_name text,
  amphoe_name text,
  province_name text,
  geom geometry(MultiPolygon, 32647) NOT NULL
);
CREATE TABLE gis.stream (
  id integer PRIMARY KEY,
  stream_id text,
  str_class integer,
  str_order integer,
  "STR_CL_T" text,
  "STR_NAME_T" text,
  geom geometry(LineString, 32647) NOT NULL
);
CREATE TABLE gis.irrigation_canal (
  id integer PRIMARY KEY,
  stream_id text,
  str_class integer,
  str_order integer,
  str_cl_t text,
  str_name_t text,
  geom geometry(LineString, 32647) NOT NULL
);
CREATE TABLE gis.flood_recurrence_pyo (
  id integer PRIMARY KEY,
  freq integer,
  area_rai numeric,
  province_id text,
  province_name text,
  district_id text,
  district_name text,
  subdistrict_id text,
  subdistrict_name text,
  yearly_frequency jsonb NOT NULL,
  synced_at timestamptz,
  geom geometry(MultiPolygon, 4326) NOT NULL
);
CREATE TABLE gis.drought_recurrence_tambon_pyo (
  id integer PRIMARY KEY,
  tambon_name text,
  district_name text,
  province_name text,
  total_occurrences integer,
  years_detected integer[],
  yearly_frequency jsonb,
  start_year integer,
  end_year integer,
  response_status text,
  source text,
  geom geometry(MultiPolygon, 4326) NOT NULL
);

CREATE INDEX ON gis.amphoe USING gist (geom);
CREATE INDEX ON gis.tambon USING gist (geom);
CREATE INDEX ON gis.basin USING gist (geom);
CREATE INDEX ON gis.rice_potential USING gist (geom);
CREATE INDEX ON gis.maize_potential USING gist (geom);
CREATE INDEX ON gis.flood_recurrence_pyo USING gist (geom);
CREATE INDEX ON gis.drought_recurrence_tambon_pyo USING gist (geom);

CREATE TEMP TABLE e2e_shape AS
SELECT ST_Multi(ST_Transform(ST_MakeEnvelope(99.84, 18.98, 99.94, 19.08, 4326), 32647)) AS geom;

INSERT INTO gis.amphoe (id, amp_code, amphoe_t, amphoe_e, province_t, province_e, geom)
SELECT 1, 'E2E', 'เมืองพะเยา', 'Mueang Phayao', 'พะเยา', 'Phayao', geom FROM e2e_shape;
INSERT INTO gis.tambon (id, sdist_code, tambon, amphoe, changwat, geom)
SELECT 1, 'E2E', 'เวียง', 'เมืองพะเยา', 'พะเยา', geom FROM e2e_shape;
INSERT INTO gis.basin (id, "BASIN_ID", "BASIN_NA", "S_BASIN_ID", "S_BASIN_NA", geom)
SELECT 1, 'E2E', 'กว๊านพะเยา', 'E2E-1', 'กว๊านพะเยา', geom FROM e2e_shape;
INSERT INTO gis.rice_potential (id, suitability_class, suitability_label_th, source_name, geom)
SELECT 1, 'S1', 'เหมาะสมมาก', 'E2E fixture', geom FROM e2e_shape;
INSERT INTO gis.maize_potential (id, suitability_class, suitability_label_th, source_name, geom)
SELECT 1, 'S2', 'เหมาะสมปานกลาง', 'E2E fixture', geom FROM e2e_shape;
INSERT INTO gis.stream (id, stream_id, str_class, str_order, "STR_CL_T", "STR_NAME_T", geom)
VALUES (1, 'E2E-STREAM', 1, 1, 'ลำห้วย', 'ลำห้วยทดสอบ',
  ST_Transform(ST_SetSRID(ST_MakeLine(ST_MakePoint(99.85, 19.0), ST_MakePoint(99.93, 19.06)), 4326), 32647));
INSERT INTO gis.irrigation_canal (id, stream_id, str_class, str_order, str_cl_t, str_name_t, geom)
VALUES (1, 'E2E-CANAL', 1, 1, 'คลอง', 'คลองทดสอบ',
  ST_Transform(ST_SetSRID(ST_MakeLine(ST_MakePoint(99.86, 19.01), ST_MakePoint(99.92, 19.05)), 4326), 32647));
INSERT INTO gis.flood_recurrence_pyo (
  id, freq, area_rai, province_id, province_name, district_id, district_name,
  subdistrict_id, subdistrict_name, yearly_frequency, synced_at, geom
)
VALUES (1, 1, 100, '57', 'พะเยา', '5701', 'เมืองพะเยา', '570101', 'เวียง',
  '[{"year":2024,"frequency":1}]'::jsonb, now(),
  ST_Multi(ST_MakeEnvelope(99.86, 19.0, 99.91, 19.05, 4326)));
INSERT INTO gis.drought_recurrence_tambon_pyo (
  id, tambon_name, district_name, province_name, total_occurrences,
  years_detected, yearly_frequency, start_year, end_year, response_status, source, geom
)
VALUES (1, 'เวียง', 'เมืองพะเยา', 'พะเยา', 1, ARRAY[2024],
  '[{"year":2024,"frequency":1}]'::jsonb, 2024, 2024, 'success', 'E2E fixture',
  ST_Multi(ST_MakeEnvelope(99.84, 18.98, 99.94, 19.08, 4326)));
