-- Read-only verification for LINE-user parcel ownership migration.
-- Run before and after migration and compare:
--   parcel_row_count
--   parcel_geometry_fingerprint
--   geometry metadata
-- The fingerprint is a hash only; it does not display parcel geometry.

BEGIN READ ONLY;

WITH checks AS (
  SELECT
    'app.users exists' AS check_name,
    to_regclass('app.users') IS NOT NULL AS passed,
    NULL::text AS details
  UNION ALL
  SELECT
    'app.users.line_user_id is NOT NULL',
    EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'app'
        AND table_name = 'users'
        AND column_name = 'line_user_id'
        AND is_nullable = 'NO'
    ),
    NULL::text
  UNION ALL
  SELECT
    'app.users.line_user_id is UNIQUE',
    EXISTS (
      SELECT 1
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = 'app'
        AND t.relname = 'users'
        AND c.contype = 'u'
        AND pg_get_constraintdef(c.oid) = 'UNIQUE (line_user_id)'
    ),
    NULL::text
  UNION ALL
  SELECT
    'app.parcels.owner_user_id exists',
    EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'app'
        AND table_name = 'parcels'
        AND column_name = 'owner_user_id'
        AND udt_name = 'uuid'
    ),
    NULL::text
  UNION ALL
  SELECT
    'app.parcels owner foreign key references app.users',
    EXISTS (
      SELECT 1
      FROM pg_constraint c
      JOIN pg_class source_table ON source_table.oid = c.conrelid
      JOIN pg_namespace source_schema ON source_schema.oid = source_table.relnamespace
      JOIN pg_class target_table ON target_table.oid = c.confrelid
      JOIN pg_namespace target_schema ON target_schema.oid = target_table.relnamespace
      WHERE c.contype = 'f'
        AND source_schema.nspname = 'app'
        AND source_table.relname = 'parcels'
        AND target_schema.nspname = 'app'
        AND target_table.relname = 'users'
        AND pg_get_constraintdef(c.oid) LIKE '%FOREIGN KEY (owner_user_id)%'
        AND pg_get_constraintdef(c.oid) LIKE '%ON DELETE RESTRICT%'
    ),
    NULL::text
  UNION ALL
  SELECT
    'ownership index exists',
    EXISTS (
      SELECT 1
      FROM pg_indexes
      WHERE schemaname = 'app'
        AND tablename = 'parcels'
        AND indexname IN (
          'parcels_owner_user_id_created_at_idx',
          'parcels_owner_user_id_id_idx'
        )
    ),
    NULL::text
  UNION ALL
  SELECT
    'geometry metadata remains MultiPolygon SRID 32647',
    EXISTS (
      SELECT 1
      FROM geometry_columns
      WHERE f_table_schema = 'app'
        AND f_table_name = 'parcels'
        AND f_geometry_column = 'geom'
        AND srid = 32647
        AND type = 'MULTIPOLYGON'
    ),
    NULL::text
  UNION ALL
  SELECT
    'no token-like columns added',
    NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'app'
        AND table_name IN ('users', 'parcels')
        AND lower(column_name) ~ '(id_?token|access_?token|refresh_?token|channel_?access_?token|line_?token)'
    ),
    NULL::text
)
SELECT check_name, passed, details
FROM checks
ORDER BY check_name;

SELECT
  COUNT(*) AS parcel_row_count,
  COUNT(*) FILTER (WHERE owner_user_id IS NULL) AS ownerless_legacy_parcels,
  COUNT(*) FILTER (WHERE owner_user_id IS NOT NULL) AS owned_parcels
FROM app.parcels;

SELECT
  COUNT(*) AS orphaned_owner_references
FROM app.parcels p
LEFT JOIN app.users u ON u.id = p.owner_user_id
WHERE p.owner_user_id IS NOT NULL
  AND u.id IS NULL;

SELECT
  f_geometry_column,
  srid,
  type
FROM geometry_columns
WHERE f_table_schema = 'app'
  AND f_table_name = 'parcels';

SELECT
  table_schema,
  table_name,
  column_name
FROM information_schema.columns
WHERE table_schema = 'app'
  AND table_name IN ('users', 'parcels')
  AND lower(column_name) ~ '(id_?token|access_?token|refresh_?token|channel_?access_?token|line_?token)'
ORDER BY table_name, column_name;

WITH parcel_geometry_hashes AS (
  SELECT
    id,
    md5(ST_AsEWKB(geom)::text) AS geom_hash
  FROM app.parcels
)
SELECT
  COUNT(*) AS parcel_row_count_for_geometry_fingerprint,
  md5(COALESCE(string_agg(id::text || ':' || geom_hash, ',' ORDER BY id::text), '')) AS parcel_geometry_fingerprint
FROM parcel_geometry_hashes;

ROLLBACK;
