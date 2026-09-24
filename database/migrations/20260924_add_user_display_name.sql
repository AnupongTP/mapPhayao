BEGIN;

ALTER TABLE app.users
ADD COLUMN IF NOT EXISTS display_name text;

COMMIT;
