# LINE User Parcel Ownership - Phase 3

## Inspection Summary

- Active parcel storage is `app.parcels`.
- Current primary key type is `uuid`, defaulting to `gen_random_uuid()`.
- Current geometry column is `geom geometry(MultiPolygon, 32647) NOT NULL`.
- Current parcel timestamp convention is `created_at timestamptz DEFAULT now()` plus `updated_at timestamptz DEFAULT now()` maintained by `app.set_updated_at()`.
- Current `app.parcels` columns in the repository schema are: `id`, `parcel_code`, `parcel_name`, `crop_type`, `rice_variety`, `planting_date`, `geom`, `created_at`, `updated_at`.
- Current constraints are `parcels_pkey` and `parcels_parcel_code_key`.
- Current parcel index is `parcels_geom_gix`.
- No owner column exists in the checked-in schema before the Phase 3 migration.
- No `app.users` table exists in the checked-in schema before the Phase 3 migration.
- Phase 4 read-only production inspection confirmed Case A on 2026-07-16: `app.parcels` exists, row count is `0`, `app.users` is absent, no ownership column exists, RLS is disabled on `app.parcels`, and no grants exist for `anon`, `auth`, or `service_role`.

## Transition Case

The checked-in schema has no trustworthy legacy owner field. Phase 4 read-only production inspection confirmed Case A on 2026-07-16 because `app.parcels` has zero rows. No legacy backfill is required, and no arbitrary owner assignment is allowed.

If a later pre-deployment verification finds any parcel rows, stop and treat the environment as Case C: legacy/unassigned parcels must remain ownerless until an approved administrative decision deletes, archives, or assigns them.

Do not assign existing rows to a test user, administrator, first user, or any arbitrary LINE account.

## Proposed Schema

`app.users`

- `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
- `line_user_id text NOT NULL UNIQUE`
- `created_at timestamptz NOT NULL DEFAULT now()`
- `updated_at timestamptz NOT NULL DEFAULT now()`
- `users_line_user_id_not_blank_chk CHECK (btrim(line_user_id) <> '')`

`app.parcels`

- Add `owner_user_id uuid`.
- Add `parcels_owner_user_id_fkey` referencing `app.users(id) ON DELETE RESTRICT`.
- Add `parcels_owner_user_id_created_at_idx` for listing a user's parcels.
- Add `parcels_owner_user_id_id_idx` for owned lookup/update/delete predicates.

`ON DELETE RESTRICT` is intentional. Deleting an app user must not silently delete parcel ownership history or parcel geometry.

## Nullability Plan

1. Preparation migration creates `app.users`, adds nullable `owner_user_id`, creates the foreign key as `NOT VALID`, and adds ownership indexes.
2. Phase 4 backend writes `owner_user_id` for all new parcels after verifying the LINE `idToken`.
3. Because Case A is confirmed for the inspected production database, the enforcement migration can follow the preparation migration after re-confirming zero parcel rows.
4. Enforcement migration adds `parcels_owner_user_id_required_chk CHECK (owner_user_id IS NOT NULL) NOT VALID`. This blocks new ownerless inserts and updates while allowing legacy ownerless rows to remain temporarily if another environment is not Case A.
5. If `SELECT COUNT(*) FROM app.parcels WHERE owner_user_id IS NULL` returns zero, the enforcement migration validates the check and sets `owner_user_id NOT NULL`.
6. If ownerless legacy rows exist, `owner_user_id` remains nullable until deletion, archival, or administrative assignment is approved.

## RLS and PostgREST Review

No Supabase/PostgREST configuration, RLS policy, or direct frontend table access was found in the repository. Phase 4 read-only production inspection confirmed RLS is disabled on `app.parcels`, and no direct grants exist for `anon`, `auth`, or `service_role`. The frontend calls the Render backend API. The intended access path remains:

`LIFF frontend -> Render backend -> PostgreSQL`

Recommendation before production migration: confirm in the Supabase Dashboard that the `app` schema is not exposed through PostgREST. If it is exposed, do not create permissive anonymous policies. Either remove `app` from exposed schemas or deny direct anon/auth access. Do not depend on Supabase Auth JWT claims because this product authenticates through LINE and server-side idToken verification.

## Security Invariants

- LINE identity comes only from `lineTokenService.verifyIdToken(idToken)`.
- Client-supplied `userId`, `lineUserId`, `ownerId`, `owner_user_id`, or `user_id` is ignored.
- No LINE `idToken`, access token, refresh token, or channel access token is stored.
- Store only `app.users.line_user_id`, the verified stable LINE subject needed for ownership.
- Parcel list queries filter by `owner_user_id`.
- Parcel read/update/delete queries include both parcel `id` and `owner_user_id`.
- Missing parcel and unauthorized parcel access return the same not-found shape.
- Database constraints prevent dangling owners.
- Ownership indexes support efficient owner predicates.

## Rollback Strategy

The rollback SQL drops only the ownership check, foreign key, and indexes. It preserves `app.users` and `app.parcels.owner_user_id` so ownership data is not silently discarded. Dropping the user table or owner column must be a separate manual operation after export/review.

## Phase 4 Backend Plan

1. Add one reusable LINE auth middleware that extracts an `Authorization: Bearer <idToken>` value, calls `lineTokenService.verifyIdToken`, and stores only the verified LINE subject on `req.lineIdentity.lineUserId`. Keep existing `/api/line` behavior intact unless intentionally migrated.
2. Add `appUserService.findOrCreateLineUser(lineUserId, client)` using parameterized SQL against `app.users (line_user_id)` with `ON CONFLICT (line_user_id) DO NOTHING`, returning only the internal `id`.
3. Extend the existing `parcelRoutes`; do not create a duplicate parcel router.
4. Protect parcel persistence routes with the middleware. Keep `GET /api/parcels/mine` before `GET /api/parcels/:id`.
5. Create parcel: `POST /api/parcels` with body `{ parcelName, cropType, riceVariety, plantingDate, geometry }` and bearer idToken. Insert `owner_user_id` from `app.users.id`.
6. List owned parcels: `GET /api/parcels/mine?limit=100`; SQL predicate `WHERE owner_user_id = $1 ORDER BY created_at DESC LIMIT $2`.
7. Read owned parcel: `GET /api/parcels/:id`; SQL predicate `WHERE id = $1 AND owner_user_id = $2`.
8. Update owned parcel: `PATCH /api/parcels/:id`; SQL predicate `WHERE id = $1 AND owner_user_id = $2 RETURNING ...`.
9. Delete owned parcel: `DELETE /api/parcels/:id`; SQL predicate `WHERE id = $1 AND owner_user_id = $2 RETURNING id`.
10. Re-analyze stored parcel: add `POST /api/parcels/:id/analyze`, load geometry only through `WHERE id = $1 AND owner_user_id = $2`, then reuse `areaAnalysisService` logic instead of duplicating GIS SQL.
11. Replace the current unauthenticated `GET /api/parcels` global list with an owned endpoint or restrict it to authenticated owned rows.
12. Tests should cover token verification, ignoring client owner fields, find-or-create idempotency, owned list/read/update/delete predicates, not-found behavior for another user's parcel, no token persistence, and stored parcel re-analysis ownership.
