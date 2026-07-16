-- Phase 3 preparation for LINE-user parcel ownership.
-- This migration is intentionally non-destructive and does not backfill owners.
-- Run only after reviewing the current parcel row count and legacy ownership plan.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS app;

-- Reuse the existing app timestamp convention used by app.parcels.
CREATE OR REPLACE FUNCTION app.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS app.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  line_user_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_line_user_id_key UNIQUE (line_user_id),
  CONSTRAINT users_line_user_id_not_blank_chk CHECK (btrim(line_user_id) <> '')
);

COMMENT ON TABLE app.users IS
  'Application users derived from successfully verified LINE idToken subjects.';
COMMENT ON COLUMN app.users.line_user_id IS
  'Stable LINE subject (sub) from server-side idToken verification. Do not store LINE tokens.';

DROP TRIGGER IF EXISTS users_set_updated_at ON app.users;

CREATE TRIGGER users_set_updated_at
BEFORE UPDATE ON app.users
FOR EACH ROW
EXECUTE FUNCTION app.set_updated_at();

ALTER TABLE app.parcels
ADD COLUMN IF NOT EXISTS owner_user_id uuid;

COMMENT ON COLUMN app.parcels.owner_user_id IS
  'Internal app.users owner. Nullable only during legacy parcel ownership migration.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'app.parcels'::regclass
      AND conname = 'parcels_owner_user_id_fkey'
  ) THEN
    ALTER TABLE app.parcels
    ADD CONSTRAINT parcels_owner_user_id_fkey
    FOREIGN KEY (owner_user_id)
    REFERENCES app.users(id)
    ON DELETE RESTRICT
    NOT VALID;
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS parcels_owner_user_id_created_at_idx
ON app.parcels (owner_user_id, created_at DESC, id);

CREATE INDEX IF NOT EXISTS parcels_owner_user_id_id_idx
ON app.parcels (owner_user_id, id);

COMMIT;
