CREATE SCHEMA IF NOT EXISTS ref;

CREATE TABLE IF NOT EXISTS ref.soil_rice_suitability (
  id bigserial PRIMARY KEY,
  series_no integer,
  soil_symbol varchar(30),
  soil_name_th varchar(255),
  rice_ecosystem varchar(50) NOT NULL DEFAULT 'LOWLAND_PADDY',
  suitability_class varchar(10) NOT NULL,
  suitability_label_th varchar(100) NOT NULL,
  limitation_th text,
  recommendation_th text,
  source_name varchar(255) NOT NULL,
  source_year integer,
  rule_version varchar(30) NOT NULL,
  is_verified boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT soil_rice_suitability_class_chk CHECK (
    suitability_class IN ('S1', 'S2', 'S3', 'N', 'NO_DATA', 'NO_RULE')
  )
);

CREATE INDEX IF NOT EXISTS soil_rice_suitability_series_idx
ON ref.soil_rice_suitability (series_no, rice_ecosystem, is_verified);

CREATE TABLE IF NOT EXISTS ref.rice_variety_recommendation (
  id bigserial PRIMARY KEY,
  variety_code varchar(50) NOT NULL,
  variety_name_th varchar(150) NOT NULL,
  rice_type varchar(30) NOT NULL,
  region varchar(100),
  water_regime varchar(50),
  photoperiod_type varchar(50),
  suitable_classes varchar(10)[] NOT NULL,
  recommendation_th text,
  caution_th text,
  source_name varchar(255) NOT NULL,
  source_year integer,
  rule_version varchar(30) NOT NULL,
  is_verified boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rice_variety_type_chk CHECK (
    rice_type IN ('NON_GLUTINOUS', 'GLUTINOUS')
  ),
  CONSTRAINT rice_variety_water_regime_chk CHECK (
    water_regime IS NULL OR water_regime IN (
      'RAINFED',
      'IRRIGATED',
      'ADEQUATE_WATER',
      'UNKNOWN'
    )
  )
);

CREATE INDEX IF NOT EXISTS rice_variety_recommendation_lookup_idx
ON ref.rice_variety_recommendation (is_verified, region, water_regime);
