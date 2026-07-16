-- Safe rollback for LINE-user parcel ownership preparation.
-- This intentionally preserves app.users and app.parcels.owner_user_id so
-- ownership data is not silently discarded.

BEGIN;

ALTER TABLE app.parcels
DROP CONSTRAINT IF EXISTS parcels_owner_user_id_required_chk;

ALTER TABLE app.parcels
DROP CONSTRAINT IF EXISTS parcels_owner_user_id_fkey;

DROP INDEX IF EXISTS app.parcels_owner_user_id_created_at_idx;
DROP INDEX IF EXISTS app.parcels_owner_user_id_id_idx;

COMMENT ON COLUMN app.parcels.owner_user_id IS
  'Rollback preserved this column intentionally; review/export ownership data before any manual removal.';

COMMIT;
