const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "../..");
const prepareMigration = readRepoFile("database/migrations/20260716_prepare_line_user_parcel_ownership.sql");
const enforceMigration = readRepoFile("database/migrations/20260716_enforce_line_user_parcel_ownership.sql");
const rollbackSql = readRepoFile("database/rollbacks/20260716_rollback_line_user_parcel_ownership.sql");
const verificationSql = readRepoFile("database/verification/20260716_verify_line_user_parcel_ownership.sql");
const phase3Doc = readRepoFile("docs/line-user-parcel-ownership-phase3.md");
const parcelServiceSource = readRepoFile("backend/src/services/parcelService.js");
const appUserServiceSource = readRepoFile("backend/src/services/appUserService.js");
const parcelControllerSource = readRepoFile("backend/src/controllers/parcelController.js");
const parcelRoutesSource = readRepoFile("backend/src/routes/parcelRoutes.js");

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function stripSqlComments(sql) {
  return sql
    .replace(/--.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

function stripSqlCommentsAndStrings(sql) {
  return stripSqlComments(sql).replace(/'(?:''|[^'])*'/g, "''");
}

test("prepare migration creates app.users with unique non-token LINE subject", () => {
  const executableSql = stripSqlCommentsAndStrings(prepareMigration);

  assert.match(prepareMigration, /CREATE TABLE IF NOT EXISTS app\.users/i);
  assert.match(prepareMigration, /id uuid PRIMARY KEY DEFAULT gen_random_uuid\(\)/i);
  assert.match(prepareMigration, /line_user_id text NOT NULL/i);
  assert.match(prepareMigration, /CONSTRAINT users_line_user_id_key UNIQUE \(line_user_id\)/i);
  assert.doesNotMatch(executableSql, /\b(id_token|idtoken|access_token|refresh_token|line_token)\b/i);
});

test("prepare migration adds owner foreign key and ownership indexes", () => {
  assert.match(prepareMigration, /ADD COLUMN IF NOT EXISTS owner_user_id uuid/i);
  assert.match(prepareMigration, /FOREIGN KEY \(owner_user_id\)\s+REFERENCES app\.users\(id\)\s+ON DELETE RESTRICT/is);
  assert.match(prepareMigration, /CREATE INDEX IF NOT EXISTS parcels_owner_user_id_created_at_idx/is);
  assert.match(prepareMigration, /ON app\.parcels \(owner_user_id, created_at DESC, id\)/i);
  assert.match(prepareMigration, /CREATE INDEX IF NOT EXISTS parcels_owner_user_id_id_idx/is);
  assert.match(prepareMigration, /ON app\.parcels \(owner_user_id, id\)/i);
});

test("migrations do not perform arbitrary owner assignment or destructive parcel changes", () => {
  const combined = stripSqlComments(`${prepareMigration}\n${enforceMigration}`);

  assert.doesNotMatch(combined, /UPDATE\s+app\.parcels\s+SET\s+owner_user_id/i);
  assert.doesNotMatch(combined, /INSERT\s+INTO\s+app\.users[\s\S]*SELECT/i);
  assert.doesNotMatch(combined, /DROP\s+TABLE\s+app\.parcels/i);
  assert.doesNotMatch(combined, /TRUNCATE\s+app\.parcels/i);
  assert.doesNotMatch(combined, /DROP\s+COLUMN\s+geom/i);
  assert.doesNotMatch(combined, /ALTER\s+COLUMN\s+geom/i);
  assert.doesNotMatch(combined, /UPDATE\s+app\.parcels[\s\S]*\bgeom\s*=/i);
});

test("enforcement migration blocks new ownerless parcels without forcing legacy backfill", () => {
  assert.match(enforceMigration, /CHECK \(owner_user_id IS NOT NULL\)\s+NOT VALID/i);
  assert.match(enforceMigration, /SELECT COUNT\(\*\)[\s\S]*WHERE owner_user_id IS NULL/i);
  assert.doesNotMatch(enforceMigration, /owner_user_id\s*=\s*'[^']+'/i);
});

test("rollback preserves ownership data and avoids destructive cascade", () => {
  const rollback = stripSqlComments(rollbackSql);

  assert.match(rollback, /DROP CONSTRAINT IF EXISTS parcels_owner_user_id_required_chk/i);
  assert.match(rollback, /DROP CONSTRAINT IF EXISTS parcels_owner_user_id_fkey/i);
  assert.doesNotMatch(rollback, /\bCASCADE\b/i);
  assert.doesNotMatch(rollback, /DROP\s+TABLE\s+app\.users/i);
  assert.doesNotMatch(rollback, /DROP\s+COLUMN\s+owner_user_id/i);
});

test("verification SQL is read-only and checks ownership safety", () => {
  const verification = stripSqlComments(verificationSql);
  const executableSql = stripSqlCommentsAndStrings(verificationSql);

  assert.match(verification, /BEGIN READ ONLY/i);
  assert.match(verification, /to_regclass\('app\.users'\)/i);
  assert.match(verification, /ownerless_legacy_parcels/i);
  assert.match(verification, /orphaned_owner_references/i);
  assert.match(verification, /geometry_columns/i);
  assert.match(verification, /parcel_geometry_fingerprint/i);
  assert.doesNotMatch(
    executableSql,
    /\b(CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|TRUNCATE|GRANT|REVOKE|VACUUM|ANALYZE)\b/i,
  );
});

test("Phase 3 documentation records the confirmed Case A production state", () => {
  assert.match(phase3Doc, /Case A on 2026-07-16/i);
  assert.match(phase3Doc, /row count is `0`/i);
  assert.match(phase3Doc, /`app\.users` is absent/i);
  assert.match(phase3Doc, /no ownership column exists/i);
  assert.match(phase3Doc, /RLS is disabled on `app\.parcels`/i);
  assert.match(phase3Doc, /no grants exist for `anon`, `auth`, or `service_role`/i);
  assert.match(phase3Doc, /No legacy backfill is required/i);
});

test("backend ownership code uses the same app.users and owner_user_id contract as migrations", () => {
  const source = [
    parcelServiceSource,
    appUserServiceSource,
    parcelControllerSource,
    parcelRoutesSource,
  ].join("\n");

  assert.match(appUserServiceSource, /INSERT INTO app\.users \(line_user_id\)/i);
  assert.match(appUserServiceSource, /ON CONFLICT \(line_user_id\) DO NOTHING/i);
  assert.match(appUserServiceSource, /SELECT id\s+FROM app\.users\s+WHERE line_user_id = \$1/is);
  assert.match(parcelServiceSource, /owner_user_id/is);
  assert.match(parcelServiceSource, /WHERE id = \$1\s+AND owner_user_id = \$2/is);
  assert.match(parcelServiceSource, /WHERE owner_user_id = \$1/is);
  assert.match(parcelServiceSource, /AND owner_user_id = \$10/is);
  assert.match(parcelRoutesSource, /router\.use\(requireLineAuth\)/i);
  assert.match(parcelRoutesSource, /router\.get\("\/mine"/i);
  assert.match(parcelRoutesSource, /router\.post\("\/:parcelId\/analyze"/i);
  assert.doesNotMatch(source, /\bapp\.line_users\b/i);
  assert.doesNotMatch(source, /\bline_users\b/i);
});
