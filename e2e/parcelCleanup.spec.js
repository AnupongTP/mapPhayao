const { randomUUID } = require("node:crypto");
const { test, expect } = require("@playwright/test");
const db = require("../backend/src/config/database");
const { createParcelCleanupWorker } = require("../backend/src/services/parcelCleanupWorker");

test.beforeAll(() => {
  if (process.env.DB_HOST !== "127.0.0.1" || process.env.DB_NAME !== "mapphayao_e2e") {
    throw new Error("Refusing non-local cleanup E2E database");
  }
});

test("PostgreSQL claims distinct due jobs and reclaims an expired lease, not terminal or future jobs", async ({}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium");
  const ids = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const parcelIds = ids.map(() => randomUUID());
  const rows = [
    [ids[0], parcelIds[0], "E2E-DUE", "pending", -60, null, null],
    [ids[1], parcelIds[1], "E2E-STALE", "processing", -60, -660, randomUUID()],
    [ids[2], parcelIds[2], "E2E-FUTURE", "pending", 3600, null, null],
    [ids[3], parcelIds[3], "E2E-COMPLETED", "completed", -60, null, null],
    [ids[4], parcelIds[4], "E2E-FAILED", "failed", -60, null, null],
  ];
  for (const [id, parcelId, code, status, nextSeconds, lockedSeconds, lockedBy] of rows) {
    await db.query(`INSERT INTO app.cleanup_jobs
      (id, parcel_id, parcel_code, status, next_attempt_at, locked_at, locked_by)
      VALUES ($1, $2, $3, $4, now() + ($5::int * interval '1 second'),
        CASE WHEN $6::int IS NULL THEN NULL ELSE now() + ($6::int * interval '1 second') END, $7)`,
    [id, parcelId, code, status, nextSeconds, lockedSeconds, lockedBy]);
  }
  const google = { enabled: false };
  const first = createParcelCleanupWorker({ google });
  const second = createParcelCleanupWorker({ google });
  const [claimedA, claimedB] = await Promise.all([first.claim(), second.claim()]);
  expect(new Set([claimedA?.id, claimedB?.id])).toEqual(new Set(ids.slice(0, 2)));
  const states = (await db.query(`SELECT id, status, attempts FROM app.cleanup_jobs
    WHERE id = ANY($1::uuid[])`, [ids])).rows;
  const byId = new Map(states.map((row) => [row.id, row]));
  expect(byId.get(ids[0])).toMatchObject({ status: "processing", attempts: 1 });
  expect(byId.get(ids[1])).toMatchObject({ status: "processing", attempts: 1 });
  expect(byId.get(ids[2])).toMatchObject({ status: "pending", attempts: 0 });
  expect(byId.get(ids[3])).toMatchObject({ status: "completed", attempts: 0 });
  expect(byId.get(ids[4])).toMatchObject({ status: "failed", attempts: 0 });
});

test("PostgreSQL cleanup checkpoints partial Drive progress across worker restart", async ({}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium");
  const id = randomUUID();
  const parcelId = randomUUID();
  await db.query(`INSERT INTO app.cleanup_jobs
    (id, parcel_id, parcel_code, remaining_file_ids, next_attempt_at)
    VALUES ($1, $2, $3, $4::text[], now() - interval '1 day')`,
  [id, parcelId, "E2E-PARTIAL", ["file_1", "file_2", "file_3"]]);
  const calls = [];
  let failSecond = true;
  const google = { enabled: true,
    async deleteParcel() { calls.push("sheet"); },
    async deleteImage(fileId) {
      calls.push(fileId);
      if (fileId === "file_2" && failSecond) {
        failSecond = false;
        throw Object.assign(new Error("transient"), { googleStage: "drive-delete", statusCode: 503 });
      }
    },
  };
  expect(await createParcelCleanupWorker({ google }).runOne()).toBe(true);
  const failed = (await db.query(`SELECT status, attempts, sheet_deleted, remaining_file_ids,
    next_attempt_at, last_error FROM app.cleanup_jobs WHERE id = $1`, [id])).rows[0];
  expect(failed).toMatchObject({ status: "pending", attempts: 1, sheet_deleted: true,
    remaining_file_ids: ["file_2", "file_3"], last_error: "DRIVE_DELETE_STARTED:drive-delete:http-503" });
  expect(failed.next_attempt_at.getTime()).toBeGreaterThan(Date.now());
  expect(calls).toEqual(["sheet", "file_1", "file_2"]);
  await db.query("UPDATE app.cleanup_jobs SET next_attempt_at = now() - interval '1 day' WHERE id = $1", [id]);
  expect(await createParcelCleanupWorker({ google }).runOne()).toBe(true);
  const completed = (await db.query(`SELECT status, attempts, sheet_deleted, remaining_file_ids,
    completed_at FROM app.cleanup_jobs WHERE id = $1`, [id])).rows[0];
  expect(completed).toMatchObject({ status: "completed", attempts: 2, sheet_deleted: true,
    remaining_file_ids: [] });
  expect(completed.completed_at).toBeInstanceOf(Date);
  expect(calls).toEqual(["sheet", "file_1", "file_2", "file_2", "file_3"]);
});
