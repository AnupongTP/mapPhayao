BEGIN;

ALTER TABLE app.users
ADD COLUMN IF NOT EXISTS display_name text;

CREATE TABLE IF NOT EXISTS app.parcel_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parcel_id uuid NOT NULL REFERENCES app.parcels(id) ON DELETE CASCADE,
  drive_file_id text NOT NULL UNIQUE,
  file_name text NOT NULL,
  link_image text NOT NULL,
  mime_type text NOT NULL CHECK (mime_type = 'image/webp'),
  byte_size bigint NOT NULL CHECK (byte_size > 0),
  width integer NOT NULL CHECK (width > 0),
  height integer NOT NULL CHECK (height > 0),
  sort_order integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS parcel_images_parcel_order_idx
ON app.parcel_images (parcel_id, sort_order, created_at, id);

DROP TRIGGER IF EXISTS parcel_images_set_updated_at ON app.parcel_images;
CREATE TRIGGER parcel_images_set_updated_at
BEFORE UPDATE ON app.parcel_images
FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

COMMIT;
