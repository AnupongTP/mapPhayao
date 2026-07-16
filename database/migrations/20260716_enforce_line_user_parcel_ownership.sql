-- Phase 3/4 enforcement migration for LINE-user parcel ownership.
-- Run after the backend writes owner_user_id from a verified LINE idToken.
-- This file does not assign legacy parcels to any user.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'app.parcels'::regclass
      AND conname = 'parcels_owner_user_id_required_chk'
  ) THEN
    -- NOT VALID allows legacy ownerless rows to remain while enforcing all new
    -- inserts and updates to carry a verified owner.
    ALTER TABLE app.parcels
    ADD CONSTRAINT parcels_owner_user_id_required_chk
    CHECK (owner_user_id IS NOT NULL)
    NOT VALID;
  END IF;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'app.parcels'::regclass
      AND conname = 'parcels_owner_user_id_fkey'
  ) THEN
    ALTER TABLE app.parcels
    VALIDATE CONSTRAINT parcels_owner_user_id_fkey;
  END IF;
END;
$$;

DO $$
DECLARE
  ownerless_count bigint;
BEGIN
  SELECT COUNT(*)
  INTO ownerless_count
  FROM app.parcels
  WHERE owner_user_id IS NULL;

  IF ownerless_count = 0 THEN
    ALTER TABLE app.parcels
    VALIDATE CONSTRAINT parcels_owner_user_id_required_chk;

    ALTER TABLE app.parcels
    ALTER COLUMN owner_user_id SET NOT NULL;
  ELSE
    RAISE NOTICE
      'owner_user_id remains nullable: % legacy ownerless parcels need approved handling',
      ownerless_count;
  END IF;
END;
$$;

COMMIT;
