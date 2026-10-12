BEGIN;

CREATE TABLE IF NOT EXISTS gis.dataset_generations (
  dataset_key text PRIMARY KEY,
  generation bigint NOT NULL CHECK (generation > 0),
  source_count bigint CHECK (source_count IS NULL OR source_count > 0),
  published_row_count bigint CHECK (published_row_count IS NULL OR published_row_count > 0),
  published_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

ALTER TABLE gis.dataset_generations ENABLE ROW LEVEL SECURITY;

INSERT INTO gis.dataset_generations (dataset_key, generation)
VALUES ('flood_recurrence_pyo', 1)
ON CONFLICT (dataset_key) DO NOTHING;

COMMIT;
