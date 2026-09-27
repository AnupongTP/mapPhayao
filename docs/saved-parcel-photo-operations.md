# Saved parcel photo operations: migration and recovery

This journal supports edits to photos on an existing saved parcel. PostgreSQL remains authoritative for the parcel and owner; Drive holds image bytes; the existing Sheet Image/LinkImage columns hold the published photo set. There is no `app.parcel_images` table.

## Migration precheck and apply

Run these only against the explicitly approved database, during a planned release. Back up the database and inspect the current migration history first. Confirm `app.parcels`, `app.cleanup_jobs`, `app.set_updated_at()`, and the existing `cleanup_jobs_job_type_check` constraint exist. Confirm no object named `app.parcel_photo_operations` or `cleanup_jobs_photo_operation_idx` already exists. Confirm the worker version deployed with this migration understands `photo_deletion` before enabling saved-photo edits.

Apply the checked-in migrations in filename/date order, including `database/migrations/20260925_create_cleanup_jobs.sql` before `database/migrations/20260927_create_parcel_photo_operations.sql`. The new migration is one transaction; an SQL error rolls back its DDL. Do not apply it to production as part of tests.

Read-only verification queries after an approved apply:

```sql
SELECT to_regclass('app.parcel_photo_operations');
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'app.cleanup_jobs'::regclass
  AND conname IN ('cleanup_jobs_job_type_check', 'photo_deletion_sheet_detached');
SELECT indexname FROM pg_indexes
WHERE schemaname = 'app'
  AND indexname IN ('parcel_photo_operations_active_idx', 'cleanup_jobs_photo_operation_idx');
SELECT job_type, count(*) FROM app.cleanup_jobs GROUP BY job_type;
```

Existing `parcel_deletion` rows remain valid. The new `photo_deletion` jobs must have `sheet_deleted = true`; they delete only detached Drive file IDs, not the parcel Sheet row. `source_operation_id` makes enqueue idempotent.

## Rollback implications

There is no automatic down migration. Do not drop the journal, its index, or the extended cleanup-job constraint after photo operations or photo-deletion jobs exist: that would lose recovery evidence or strand Drive cleanup. To disable new edits, disable the feature at the application/release level and let the worker finish known jobs. Any schema rollback requires an operator-reviewed export and reconciliation of every active/ambiguous operation and pending/failed photo-deletion job, followed by a separately approved migration. Do not blindly delete operation rows merely to unblock a parcel.

## Ambiguous operation recovery

An `ambiguous` operation is retained and blocks further parcel mutation. Upload may have created a Drive file even though its response was lost. Do not replay its `clientPhotoId`, infer absence from a timeout, scan Drive filenames, or queue deletion based on an unconfirmed file ID. An operator must inspect the journal, trusted Sheet Image/LinkImage arrays, and provider evidence using approved read-only methods, then decide whether the write completed. Record that decision and obtain approval for any repair. Never mark an ambiguous operation `expired` or `completed` solely to clear the active-operation index.

The expiry sweep re-reads the trusted Sheet state. It can queue deletion only for confirmed uploaded IDs absent from that state. It never treats expiry as permission to save metadata. Completed/abandoned journals are pruned after their retention period; ambiguous journals are not. The current browser session retains selected `File` objects for safe retry, but a reload loses unsent local files. The server journal retains confirmed progress, not browser file bytes.
