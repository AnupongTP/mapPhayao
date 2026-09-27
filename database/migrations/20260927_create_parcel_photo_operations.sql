BEGIN;

CREATE TABLE app.parcel_photo_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parcel_id uuid NOT NULL,
  owner_user_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind = 'saved_edit'),
  status text NOT NULL DEFAULT 'preparing' CHECK (status IN (
    'preparing', 'ready', 'uploading', 'ambiguous', 'finalizing',
    'sheet_committed', 'metadata_applied', 'completed', 'expired'
  )),
  parcel_code varchar(30),
  expected_updated_at timestamptz,
  expected_images jsonb NOT NULL DEFAULT '[]'::jsonb,
  removed_image_ids text[] NOT NULL DEFAULT '{}',
  new_photo_ids uuid[] NOT NULL DEFAULT '{}',
  uploaded_images jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  active_photo_id uuid,
  lease_until timestamptz,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '1 day',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE UNIQUE INDEX parcel_photo_operations_active_idx
ON app.parcel_photo_operations (parcel_id)
WHERE status NOT IN ('completed', 'expired');

CREATE INDEX parcel_photo_operations_expiry_idx
ON app.parcel_photo_operations (expires_at)
WHERE status NOT IN ('completed', 'expired', 'ambiguous');

CREATE TRIGGER parcel_photo_operations_set_updated_at
BEFORE UPDATE ON app.parcel_photo_operations
FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

ALTER TABLE app.cleanup_jobs DROP CONSTRAINT cleanup_jobs_job_type_check;
ALTER TABLE app.cleanup_jobs ADD CONSTRAINT cleanup_jobs_job_type_check
  CHECK (job_type IN ('parcel_deletion', 'photo_deletion'));
ALTER TABLE app.cleanup_jobs ADD COLUMN source_operation_id uuid;
ALTER TABLE app.cleanup_jobs ADD CONSTRAINT photo_deletion_sheet_detached
  CHECK (job_type <> 'photo_deletion' OR sheet_deleted);
CREATE UNIQUE INDEX cleanup_jobs_photo_operation_idx
ON app.cleanup_jobs (source_operation_id) WHERE source_operation_id IS NOT NULL;

COMMIT;
