-- โครงสร้าง rule versioned สำหรับประเมินความเหมาะสมด้านดินของข้าวนาน้ำฝน/นาชลประทาน
CREATE TABLE IF NOT EXISTS ref.rice_soil_rule_sets (
    id bigserial PRIMARY KEY,
    rule_version varchar(50) NOT NULL UNIQUE,
    rule_name_th varchar(255) NOT NULL,
    rice_ecosystem varchar(50) NOT NULL DEFAULT 'LOWLAND_PADDY',
    source_name varchar(255) NOT NULL,
    source_reference text,
    source_year integer,
    is_verified boolean NOT NULL DEFAULT false,
    is_active boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- ตารางนี้เก็บ factor rules เช่น drainage, effective depth หรือ texture ตาม rule set
CREATE TABLE IF NOT EXISTS ref.rice_soil_factor_rules (
    id bigserial PRIMARY KEY,
    rule_set_id bigint NOT NULL
        REFERENCES ref.rice_soil_rule_sets(id)
        ON DELETE CASCADE,
    factor_code varchar(50) NOT NULL,
    factor_label_th varchar(150) NOT NULL,
    value_type varchar(30) NOT NULL,
    min_value numeric,
    max_value numeric,
    text_value varchar(255),
    suitability_class varchar(10) NOT NULL,
    limitation_th text,
    sort_order integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (
        suitability_class IN ('S1', 'S2', 'S3', 'N')
    )
);

-- ตารางนี้เก็บ rule แบบตรงต่อ series_no เมื่อมีหลักฐานอ้างอิงชัดเจน
CREATE TABLE IF NOT EXISTS ref.rice_soil_series_rules (
    id bigserial PRIMARY KEY,
    rule_set_id bigint NOT NULL
        REFERENCES ref.rice_soil_rule_sets(id)
        ON DELETE CASCADE,
    series_no integer NOT NULL,
    soil_symbol varchar(50),
    suitability_class varchar(10) NOT NULL,
    limitation_th text,
    recommendation_th text,
    source_reference text,
    is_verified boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (rule_set_id, series_no),
    CHECK (
        suitability_class IN ('S1', 'S2', 'S3', 'N')
    )
);

-- index ช่วยให้เลือก active rule set และค้นหา rule ตาม series ได้เร็ว
CREATE INDEX IF NOT EXISTS rice_soil_rule_sets_active_idx
ON ref.rice_soil_rule_sets (rice_ecosystem, is_active, is_verified);

CREATE INDEX IF NOT EXISTS rice_soil_factor_rules_set_factor_idx
ON ref.rice_soil_factor_rules (rule_set_id, factor_code, sort_order);

CREATE INDEX IF NOT EXISTS rice_soil_series_rules_set_series_idx
ON ref.rice_soil_series_rules (rule_set_id, series_no);

CREATE INDEX IF NOT EXISTS rice_soil_series_rules_verified_idx
ON ref.rice_soil_series_rules (series_no, is_verified);
