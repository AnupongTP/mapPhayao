const test = require("node:test");
const assert = require("node:assert/strict");
const { createParcelCleanupWorker, isTransientCleanupError, retryDelaySeconds,
  MAX_ATTEMPTS } = require("../src/services/parcelCleanupWorker");

const JOB_ID = "11111111-1111-4111-8111-111111111111";
const PARCEL_ID = "22222222-2222-4222-8222-222222222222";

function fakeQueue(initial = {}) {
  const job = { id: JOB_ID, parcel_id: PARCEL_ID, parcel_code: "PY-1",
    remaining_file_ids: ["file_1", "file_2", "file_3", "file_4"],
    sheet_deleted: false, attempts: 0, status: "pending", ...initial };
  const calls = [];
  return { job, calls, async query(sql, params) {
    calls.push({ sql, params });
    if (sql.includes("WITH due AS")) {
      if (job.status !== "pending" || job.due === false) return { rows: [] };
      job.status = "processing";
      job.attempts += 1;
      job.locked_by = params[0];
      return { rows: [{ ...job, remaining_file_ids: [...job.remaining_file_ids] }] };
    }
    if (params[0] !== job.id || params[1] !== job.locked_by) return { rowCount: 0 };
    if (sql.includes("SET sheet_deleted = true")) job.sheet_deleted = true;
    else if (sql.includes("array_remove")) job.remaining_file_ids =
      job.remaining_file_ids.filter((id) => id !== params[2]);
    else if (sql.includes("SET status = 'completed'")) {
      assert.equal(job.sheet_deleted, true);
      assert.deepEqual(job.remaining_file_ids, []);
      job.status = "completed";
    } else if (sql.includes("SET status = $3")) {
      job.status = params[2];
      job.due = false;
      job.delaySeconds = params[4];
      job.last_error = params[5];
    } else throw new Error("Unexpected query");
    if (job.status !== "processing") job.locked_by = null;
    return { rowCount: 1 };
  } };
}

test("worker deletes Sheet first, persists each confirmed Drive deletion, and resumes on a new worker", async () => {
  const database = fakeQueue();
  const operations = [];
  let failThird = true;
  const google = { enabled: true,
    async deleteParcel(code) { operations.push(`sheet:${code}`); },
    async deleteImage(id) {
      operations.push(`drive:${id}`);
      if (id === "file_3" && failThird) {
        failThird = false;
        throw Object.assign(new Error("Bearer private"), {
          googleStage: "apps-script-delete", bridgeCategory: "timeout",
        });
      }
    },
  };
  const first = createParcelCleanupWorker({ database, google });
  assert.equal(await first.runCycle(), 1);
  assert.deepEqual(operations, ["sheet:PY-1", "drive:file_1", "drive:file_2", "drive:file_3"]);
  assert.equal(database.job.sheet_deleted, true);
  assert.deepEqual(database.job.remaining_file_ids, ["file_3", "file_4"]);
  assert.equal(database.job.status, "pending");
  assert.equal(database.job.delaySeconds, 30);
  assert.equal(database.job.last_error, "apps-script-delete:timeout");
  assert.equal(JSON.stringify(database.job).includes("Bearer private"), false);

  database.job.due = true;
  const restarted = createParcelCleanupWorker({ database, google });
  assert.equal(await restarted.runCycle(), 1);
  assert.deepEqual(operations.slice(4), ["drive:file_3", "drive:file_4"]);
  assert.equal(database.job.status, "completed");
  assert.deepEqual(database.job.remaining_file_ids, []);
  assert.equal(await restarted.runCycle(), 0);
});

test("endpoint HTTP 404 is not proof of an absent Drive file", async () => {
  const database = fakeQueue({ sheet_deleted: true, remaining_file_ids: ["file_1"] });
  const worker = createParcelCleanupWorker({ database, google: { enabled: true,
    async deleteImage() {
      throw Object.assign(new Error("endpoint missing"), {
        googleStage: "apps-script-http", statusCode: 404,
      });
    },
  } });
  await worker.runCycle();
  assert.equal(database.job.status, "failed");
  assert.deepEqual(database.job.remaining_file_ids, ["file_1"]);
  assert.equal(database.job.last_error, "apps-script-http:http-404");
});

test("temporary Sheet cleanup failure schedules retry before any Drive deletion", async () => {
  const database = fakeQueue({ remaining_file_ids: ["file_1"] });
  let driveCalls = 0;
  const worker = createParcelCleanupWorker({ database, google: { enabled: true,
    async deleteParcel() {
      throw Object.assign(new Error("temporary"), {
        googleStage: "sheets-delete-parcel", statusCode: 429,
      });
    },
    async deleteImage() { driveCalls += 1; },
  } });
  await worker.runCycle();
  assert.equal(database.job.status, "pending");
  assert.equal(database.job.sheet_deleted, false);
  assert.equal(database.job.delaySeconds, 30);
  assert.equal(database.job.last_error, "sheets-delete-parcel:http-429");
  assert.equal(driveCalls, 0);
});

test("transient failures use bounded backoff and stop at maximum attempts", async () => {
  for (const statusCode of [408, 429, 500, 502, 503, 504]) {
    assert.equal(isTransientCleanupError({ googleStage: "apps-script-http", statusCode }), true);
  }
  for (const code of ["EAI_AGAIN", "ECONNRESET", "ETIMEDOUT"]) {
    assert.equal(isTransientCleanupError({ googleStage: "sheets-delete-parcel", code }), true);
  }
  for (const statusCode of [400, 401, 403, 404, 413, 415]) {
    assert.equal(isTransientCleanupError({ googleStage: "apps-script-http", statusCode }), false);
  }
  assert.equal(isTransientCleanupError({ statusCode: 500 }), false);
  assert.equal(isTransientCleanupError({ googleStage: "drive-config", statusCode: 503 }), false);
  assert.equal(isTransientCleanupError({ googleStage: "sheets-header-check",
    code: "SHEET_HEADER_MISMATCH", statusCode: 500 }), false);
  assert.deepEqual([1, 2, 3, 4, 5, 10].map(retryDelaySeconds), [30, 120, 300, 900, 1800, 1800]);
  const database = fakeQueue({ attempts: MAX_ATTEMPTS - 1, remaining_file_ids: [] });
  const worker = createParcelCleanupWorker({ database, google: { enabled: true,
    async deleteParcel() {
      throw Object.assign(new Error("temporary"), {
        googleStage: "sheets-delete-parcel", statusCode: 503,
      });
    },
  } });
  await worker.runCycle();
  assert.equal(database.job.attempts, MAX_ATTEMPTS);
  assert.equal(database.job.status, "failed");
  assert.equal(database.job.last_error, "sheets-delete-parcel:http-503");
});
