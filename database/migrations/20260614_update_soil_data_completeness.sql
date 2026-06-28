-- รวม horizon ของ soil profile แล้วสรุปเป็นข้อมูลใช้แสดงใน API
CREATE OR REPLACE VIEW gis.soil_profile_summary AS
WITH profile_agg AS (
    SELECT
        d.series_no,
        COUNT(*)::integer AS horizon_count,
        MIN(d.top_depth)::integer AS profile_min_depth_cm,
        MAX(d.bot_depth)::integer AS profile_max_depth_cm,
        -- texture = 0 หมายถึงไม่มี lookup ที่ใช้ได้ ไม่ใช่ค่าจริงด้านเนื้อดิน
        COUNT(*) FILTER (
            WHERE d.texture IS NOT NULL
              AND d.texture <> 0
        )::integer AS texture_horizon_count,
        COUNT(*) FILTER (
            WHERE d.ph_water IS NOT NULL
        )::integer AS ph_water_horizon_count
    FROM raw.soil_dat d
    WHERE d.series_no IS NOT NULL
    GROUP BY d.series_no
),
surface_horizon AS (
    SELECT DISTINCT ON (d.series_no)
        d.series_no,
        d.horizon AS surface_horizon,
        d.texture AS surface_texture_code,
        -- ดึงค่า horizon แรกสุดเป็น surface horizon สำหรับแสดงรายละเอียดพื้นฐาน
        tx.tex_desc_t AS surface_texture_th,
        tx.tex_desc_e AS surface_texture_en,
        d.ph_water AS surface_ph_water,
        d.ph_kcl AS surface_ph_kcl,
        d.sand AS surface_sand_pct,
        d.silt AS surface_silt_pct,
        d.clay AS surface_clay_pct
    FROM raw.soil_dat d
    LEFT JOIN ref.texture tx ON d.texture = tx.texture
    WHERE d.series_no IS NOT NULL
    ORDER BY
        d.series_no,
        d.top_depth NULLS LAST,
        d.bot_depth NULLS LAST,
        d.id
)
SELECT
    a.series_no,
    a.horizon_count,
    a.profile_min_depth_cm,
    a.profile_max_depth_cm,
    s.surface_horizon,
    s.surface_texture_code,
    s.surface_texture_th,
    s.surface_texture_en,
    s.surface_ph_water,
    s.surface_ph_kcl,
    s.surface_sand_pct,
    s.surface_silt_pct,
    s.surface_clay_pct,
    a.texture_horizon_count,
    a.ph_water_horizon_count,
    (a.horizon_count > 0) AS has_profile_data
FROM profile_agg a
LEFT JOIN surface_horizon s ON a.series_no = s.series_no;

-- view หลักนี้รวม soil polygon กับ lookup ตาราง reference และ profile summary
CREATE OR REPLACE VIEW gis.soil_enriched_basic AS
WITH joined AS (
    SELECT
        s.gid,
        s.series_no,
        COALESCE(
            n.soilname_t,
            CASE
                WHEN s.series_no = ANY (ARRAY[7777, 8888, 9999])
                    THEN 'พื้นที่พิเศษหรือไม่มีข้อมูลชุดดิน'::character varying
                ELSE NULLIF(BTRIM(s."SOILNAME_T"), '')::character varying
            END,
            'ไม่พบข้อมูลชื่อชุดดิน'::character varying
        ) AS soilname_t,
        COALESCE(n.soilname_e, NULLIF(BTRIM(s."SOILNAME_E"), '')::character varying(100))::character varying(100) AS soilname_e,
        s.drainage,
        -- drainage/depth zero ใช้เป็นรหัสไม่มีข้อมูลในบางชุด import
        COALESCE(dr.dr_desc_t, 'ไม่มีข้อมูลการระบายน้ำ'::character varying) AS drainage_desc_t,
        dr.dr_desc_e AS drainage_desc_e,
        s.eff_depth,
        COALESCE(dp.ed_desc_t, 'ไม่มีข้อมูลความลึกดิน'::character varying) AS depth_desc_t,
        dp.ed_desc_e AS depth_desc_e,
        p.horizon_count,
        p.profile_min_depth_cm,
        p.profile_max_depth_cm,
        p.surface_horizon,
        p.surface_texture_code,
        p.surface_texture_th,
        p.surface_texture_en,
        p.surface_ph_water,
        p.surface_ph_kcl,
        p.surface_sand_pct,
        p.surface_silt_pct,
        p.surface_clay_pct,
        CASE
            WHEN p.has_profile_data THEN 'AVAILABLE'::text
            ELSE 'NO_DATA'::text
        END AS profile_data_status,
        s.geom,
        (s.series_no = ANY (ARRAY[5281, 7777, 8888, 9999])) AS is_special_no_data,
        (
            n.soilname_t IS NOT NULL
            OR NULLIF(BTRIM(s."SOILNAME_T"), '') IS NOT NULL
        ) AS has_soil_name,
        (
            s.drainage IS NOT NULL
            AND s.drainage <> 0
            AND dr.dr_desc_t IS NOT NULL
        ) AS has_drainage,
        (
            s.eff_depth IS NOT NULL
            AND s.eff_depth <> 0
            AND dp.ed_desc_t IS NOT NULL
        ) AS has_effective_depth,
        COALESCE(p.has_profile_data, false) AS has_profile_data
    FROM gis.soil s
    LEFT JOIN ref.soilname n ON s.series_no = n.series_no
    LEFT JOIN ref.drainage dr ON s.drainage = dr.drainage
    LEFT JOIN ref.depth dp ON s.eff_depth = dp.eff_depth
    LEFT JOIN gis.soil_profile_summary p ON s.series_no = p.series_no
),
classified AS (
    SELECT
        *,
        ARRAY_REMOVE(ARRAY[
            CASE WHEN NOT has_soil_name THEN 'soilName' END,
            CASE WHEN NOT has_drainage THEN 'drainage' END,
            CASE WHEN NOT has_effective_depth THEN 'effectiveDepth' END
        ], NULL)::text[] AS missing_fields
    FROM joined
)
SELECT
    gid,
    series_no,
    soilname_t,
    soilname_e,
    drainage,
    drainage_desc_t,
    drainage_desc_e,
    eff_depth,
    depth_desc_t,
    depth_desc_e,
        -- data_status แยก AVAILABLE / PARTIAL_DATA / NO_DATA เพื่อไม่ทิ้งข้อมูลบางส่วนทิ้งหมด
        CASE
            WHEN is_special_no_data THEN 'NO_DATA'::text
        WHEN has_soil_name AND has_drainage AND has_effective_depth THEN 'AVAILABLE'::text
        WHEN has_soil_name OR has_drainage OR has_effective_depth OR has_profile_data THEN 'PARTIAL_DATA'::text
        ELSE 'NO_DATA'::text
    END AS data_status,
    geom,
    missing_fields,
    horizon_count,
    profile_min_depth_cm,
    profile_max_depth_cm,
    surface_horizon,
    surface_texture_code,
    surface_texture_th,
    surface_texture_en,
    surface_ph_water,
    surface_ph_kcl,
    surface_sand_pct,
    surface_silt_pct,
    surface_clay_pct,
    profile_data_status
FROM classified;
