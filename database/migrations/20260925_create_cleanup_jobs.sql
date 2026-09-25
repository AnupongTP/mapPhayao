BEGIN;

CREATE TABLE IF NOT EXISTS app.cleanup_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type text NOT NULL DEFAULT 'parcel_deletion' CHECK (job_type = 'parcel_deletion'),
  parcel_id uuid NOT NULL,
  parcel_code varchar(30) NOT NULL,
  remaining_file_ids text[] NOT NULL DEFAULT '{}',
  sheet_deleted boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  locked_by uuid,
  last_error varchar(120),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT cleanup_jobs_lock_pair CHECK ((locked_at IS NULL) = (locked_by IS NULL)),
  CONSTRAINT cleanup_jobs_processing_lock CHECK (status = 'processing' OR locked_at IS NULL)
);

CREATE INDEX IF NOT EXISTS cleanup_jobs_due_idx
ON app.cleanup_jobs (next_attempt_at, id) WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS cleanup_jobs_lease_idx
ON app.cleanup_jobs (locked_at, id) WHERE status = 'processing';

DROP TRIGGER IF EXISTS cleanup_jobs_set_updated_at ON app.cleanup_jobs;
CREATE TRIGGER cleanup_jobs_set_updated_at
BEFORE UPDATE ON app.cleanup_jobs
FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

COMMIT;
