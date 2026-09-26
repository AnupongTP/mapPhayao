const test = require("node:test");
const assert = require("node:assert/strict");
const { createParcelCleanupWorker, isTransientCleanupError, retryDelaySeconds,
  CLEANUP_STAGES, MAX_ATTEMPTS, safeErrorLabel } = require("../src/services/parcelCleanupWorker");

const JOB_ID = "11111111-1111-4111-8111-111111111111";
const PARCEL_ID = "22222222-2222-4222-8222-222222222222";

function fakeQueue(initial = {}) {
  const job = { id: JOB_ID, parcel_id: PARCEL_ID, parcel_code: "PY-1",
    remaining_file_ids: ["file_1", "file_2", "file_3", "file_4"],
    sheet_deleted: false, attempts: 0, status: "pending", next_attempt_at: Date.now(), ...initial };
  const calls = [];
  return { job, calls, async query(sql, params) {
    calls.push({ sql, params });
    if (sql.includes("WITH due AS")) {
      assert.match(sql, /FOR UPDATE SKIP LOCKED/);
      if ((job.status !== "pending" || job.due === false) &&
        (job.status !== "processing" || job.stale !== true)) return { rows: [] };
      job.status = "processing";
      job.stale = false;
      job.attempts += 1;
      job.locked_by = params[0];
      return { rows: [{ ...job, remaining_file_ids: [...job.remaining_file_ids] }] };
    }
    if (params[0] !== job.id || params[1] !== job.locked_by || job.loseLease) return { rowCount: 0 };
    if (job.loseLeaseAt === "sheet-checkpoint" && sql.includes("SET sheet_deleted = true")) {
      job.loseLeaseAt = null;
      return { rowCount: 0 };
    }
    if (sql.includes("SET last_error = $3")) {
      job.last_error = params[2];
    } else if (sql.includes("SET sheet_deleted = true")) {
      if (job.failSheetCheckpoint) throw new Error("SECRET_DB_SHEET_ERROR");
      job.sheet_deleted = true;
      job.last_error = null;
    } else if (sql.includes("array_remove")) {
      if (job.failDriveCheckpoint) throw new Error("SECRET_DB_DRIVE_ERROR");
      job.remaining_file_ids = job.remaining_file_ids.filter((id) => id !== params[2]);
      job.last_error = null;
    }
    else if (sql.includes("SET status = 'completed'")) {
      if (job.failCompletionCheckpoint) throw new Error("SECRET_DB_COMPLETION_ERROR");
      assert.equal(job.sheet_deleted, true);
      assert.deepEqual(job.remaining_file_ids, []);
      job.status = "completed";
      job.last_error = null;
    } else if (sql.includes("SET status = $3")) {
      if (job.failFailureCheckpoint) throw new Error("SECRET_DB_FAILURE_ERROR");
      job.status = params[2];
      job.due = false;
      job.delaySeconds = params[4];
      job.last_error = params[5];
      if (params[3]) job.next_attempt_at = Date.now() + params[4] * 1000;
    } else throw new Error("Unexpected query");
    if (job.status !== "processing") job.locked_by = null;
    return { rowCount: 1 };
  } };
}

function captureLogger() {
  const events = [];
  return { events, info: (event, data) => events.push({ event, data }),
    warn: (event, data) => events.push({ event, data }),
    error: (event, data) => events.push({ event, data }) };
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
  const logger = captureLogger();
  const first = createParcelCleanupWorker({ database, google, logger });
  assert.equal(await first.runCycle(), 1);
  assert.deepEqual(operations, ["sheet:PY-1", "drive:file_1", "drive:file_2", "drive:file_3"]);
  assert.equal(database.job.sheet_deleted, true);
  assert.deepEqual(database.job.remaining_file_ids, ["file_3", "file_4"]);
  assert.equal(database.job.status, "pending");
  assert.equal(database.job.delaySeconds, 30);
  assert.equal(database.job.last_error, "DRIVE_DELETE_STARTED:apps-script-delete:timeout");
  assert.equal(JSON.stringify(database.job).includes("Bearer private"), false);
  assert.ok(logger.events.some((entry) => entry.data?.cleanupStage === CLEANUP_STAGES.SHEET_CHECKPOINT_COMPLETED));
  assert.ok(logger.events.some((entry) => entry.data?.cleanupStage === CLEANUP_STAGES.DRIVE_CHECKPOINT_COMPLETED));

  database.job.due = true;
  const restarted = createParcelCleanupWorker({ database, google, logger });
  assert.equal(await restarted.runCycle(), 1);
  assert.deepEqual(operations.slice(4), ["drive:file_3", "drive:file_4"]);
  assert.equal(database.job.status, "completed");
  assert.deepEqual(database.job.remaining_file_ids, []);
  assert.equal(database.job.last_error, null);
  assert.ok(logger.events.some((entry) => entry.data?.cleanupStage === CLEANUP_STAGES.JOB_COMPLETE_CHECKPOINT_COMPLETED));
  const stages = logger.events.filter((entry) => entry.event === "parcel-cleanup-stage")
    .map((entry) => entry.data.cleanupStage);
  assert.deepEqual(stages, [
    CLEANUP_STAGES.SHEET_DELETE_STARTED,
    CLEANUP_STAGES.SHEET_DELETE_COMPLETED,
    CLEANUP_STAGES.SHEET_CHECKPOINT_STARTED,
    CLEANUP_STAGES.SHEET_CHECKPOINT_COMPLETED,
    CLEANUP_STAGES.DRIVE_DELETE_STARTED,
    CLEANUP_STAGES.DRIVE_DELETE_COMPLETED,
    CLEANUP_STAGES.DRIVE_CHECKPOINT_STARTED,
    CLEANUP_STAGES.DRIVE_CHECKPOINT_COMPLETED,
    CLEANUP_STAGES.DRIVE_DELETE_STARTED,
    CLEANUP_STAGES.DRIVE_DELETE_COMPLETED,
    CLEANUP_STAGES.DRIVE_CHECKPOINT_STARTED,
    CLEANUP_STAGES.DRIVE_CHECKPOINT_COMPLETED,
    CLEANUP_STAGES.DRIVE_DELETE_STARTED,
    CLEANUP_STAGES.DRIVE_DELETE_STARTED,
    CLEANUP_STAGES.DRIVE_DELETE_COMPLETED,
    CLEANUP_STAGES.DRIVE_CHECKPOINT_STARTED,
    CLEANUP_STAGES.DRIVE_CHECKPOINT_COMPLETED,
    CLEANUP_STAGES.DRIVE_DELETE_STARTED,
    CLEANUP_STAGES.DRIVE_DELETE_COMPLETED,
    CLEANUP_STAGES.DRIVE_CHECKPOINT_STARTED,
    CLEANUP_STAGES.DRIVE_CHECKPOINT_COMPLETED,
    CLEANUP_STAGES.JOB_COMPLETE_CHECKPOINT_STARTED,
    CLEANUP_STAGES.JOB_COMPLETE_CHECKPOINT_COMPLETED,
  ]);
  assert.equal(await restarted.runCycle(), 0);
});

test("safe cleanup labels are bounded and never include raw provider text", () => {
  const label = safeErrorLabel({
    message: "SECRET_PROVIDER_BODY",
    googleStage: "apps-script-delete",
    bridgeCategory: "timeout",
    statusCode: 503,
    code: "SECRET_TOKEN",
  }, CLEANUP_STAGES.DRIVE_DELETE_STARTED);
  assert.equal(label, "DRIVE_DELETE_STARTED:apps-script-delete:http-503:timeout");
  assert.ok(label.length <= 120);
  assert.doesNotMatch(label, /SECRET/);
});

test("endpoint HTTP 404 is not proof of an absent Drive file", async () => {
  const database = fakeQueue({ sheet_deleted: true, remaining_file_ids: ["file_1"] });
  const worker = createParcelCleanupWorker({ database, logger: captureLogger(), google: { enabled: true,
    async deleteImage() {
      throw Object.assign(new Error("endpoint missing"), {
        googleStage: "apps-script-http", statusCode: 404,
      });
    },
  } });
  await worker.runCycle();
  assert.equal(database.job.status, "failed");
  assert.deepEqual(database.job.remaining_file_ids, ["file_1"]);
  assert.equal(database.job.last_error, "DRIVE_DELETE_STARTED:apps-script-http:http-404");
});

test("temporary Sheet cleanup failure schedules retry before any Drive deletion", async () => {
  const database = fakeQueue({ remaining_file_ids: ["file_1"] });
  const before = database.job.next_attempt_at;
  let driveCalls = 0;
  const worker = createParcelCleanupWorker({ database, logger: captureLogger(), google: { enabled: true,
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
  assert.ok(database.job.next_attempt_at > before);
  assert.equal(database.job.last_error, "SHEET_DELETE_STARTED:sheets-delete-parcel:http-429");
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
  const worker = createParcelCleanupWorker({ database, logger: captureLogger(), google: { enabled: true,
    async deleteParcel() {
      throw Object.assign(new Error("temporary"), {
        googleStage: "sheets-delete-parcel", statusCode: 503,
      });
    },
  } });
  await worker.runCycle();
  assert.equal(database.job.attempts, MAX_ATTEMPTS);
  assert.equal(database.job.status, "failed");
  assert.equal(database.job.last_error, "SHEET_DELETE_STARTED:sheets-delete-parcel:http-503");
});

test("Apps Script Drive timeout retries with the precise stage and safe structured log", async () => {
  const database = fakeQueue({ sheet_deleted: true, remaining_file_ids: ["file_1"] });
  const logger = captureLogger();
  const worker = createParcelCleanupWorker({ database, logger, google: { enabled: true,
    async deleteImage() {
      throw Object.assign(new Error("SECRET_PROVIDER_BODY"), {
        googleStage: "apps-script-delete", bridgeCategory: "timeout",
      });
    },
  } });
  await worker.runCycle();
  assert.equal(database.job.status, "pending");
  assert.equal(database.job.last_error, "DRIVE_DELETE_STARTED:apps-script-delete:timeout");
  assert.deepEqual(database.job.remaining_file_ids, ["file_1"]);
  const failure = logger.events.find((entry) => entry.event === "parcel-cleanup-retry-scheduled");
  assert.equal(failure.data.cleanupStage, CLEANUP_STAGES.DRIVE_DELETE_STARTED);
  assert.equal(failure.data.googleStage, "apps-script-delete");
  assert.equal(failure.data.retryable, true);
  assert.equal(failure.data.sheetDeleted, true);
  assert.doesNotMatch(JSON.stringify(logger.events), /SECRET_PROVIDER_BODY/);
});

test("permanent Sheet provider rejection fails with a safe precise label", async () => {
  const database = fakeQueue({ remaining_file_ids: ["file_1"] });
  let driveCalls = 0;
  const worker = createParcelCleanupWorker({ database, logger: captureLogger(), google: { enabled: true,
    async deleteParcel() {
      throw Object.assign(new Error("SECRET_RESPONSE"), {
        googleStage: "sheets-delete-parcel", bridgeCategory: "rejected", statusCode: 403,
      });
    },
    async deleteImage() { driveCalls += 1; },
  } });
  await worker.runCycle();
  assert.equal(database.job.status, "failed");
  assert.equal(database.job.last_error, "SHEET_DELETE_STARTED:sheets-delete-parcel:http-403:rejected");
  assert.equal(driveCalls, 0);
  assert.doesNotMatch(database.job.last_error, /SECRET_RESPONSE/);
});

test("unavailable or incomplete Google integration fails at worker precheck", async () => {
  for (const google of [{ enabled: false }, { enabled: true }]) {
    const database = fakeQueue({ remaining_file_ids: ["file_1"] });
    const worker = createParcelCleanupWorker({ database, google, logger: captureLogger() });
    await worker.runCycle();
    assert.equal(database.job.status, "failed");
    assert.equal(database.job.last_error, "WORKER_PRECHECK:google-unavailable");
    assert.equal(database.calls.some((call) => call.sql.includes("SET last_error = $3")), false);
  }
});

test("invalid cleanup file ID fails safely without invoking Drive", async () => {
  const database = fakeQueue({ sheet_deleted: true, remaining_file_ids: ["bad/file"] });
  let driveCalls = 0;
  const worker = createParcelCleanupWorker({ database, logger: captureLogger(), google: { enabled: true,
    async deleteImage() { driveCalls += 1; },
  } });
  await worker.runCycle();
  assert.equal(database.job.status, "failed");
  assert.equal(database.job.last_error, "DRIVE_DELETE_STARTED:invalid-file-id");
  assert.equal(driveCalls, 0);
});

test("Sheet checkpoint failure after deletion is failed and never starts Drive cleanup", async () => {
  const database = fakeQueue({ remaining_file_ids: ["file_1"], failSheetCheckpoint: true });
  const operations = [];
  const logger = captureLogger();
  const worker = createParcelCleanupWorker({ database, logger, google: { enabled: true,
    async deleteParcel() { operations.push("sheet"); },
    async deleteImage() { operations.push("drive"); },
  } });
  await worker.runCycle();
  assert.deepEqual(operations, ["sheet"]);
  assert.equal(database.job.status, "failed");
  assert.equal(database.job.sheet_deleted, false);
  assert.equal(database.job.last_error, "SHEET_CHECKPOINT_STARTED:database");
  assert.equal(logger.events.find((entry) => entry.event === "parcel-cleanup-failed").data.retryable, false);
});

test("Drive checkpoint failure after deletion stays failed with its file ID pending", async () => {
  const database = fakeQueue({ sheet_deleted: true, remaining_file_ids: ["file_1"],
    failDriveCheckpoint: true });
  let driveCalls = 0;
  const worker = createParcelCleanupWorker({ database, logger: captureLogger(), google: { enabled: true,
    async deleteImage() { driveCalls += 1; },
  } });
  await worker.runCycle();
  assert.equal(driveCalls, 1);
  assert.equal(database.job.status, "failed");
  assert.deepEqual(database.job.remaining_file_ids, ["file_1"]);
  assert.equal(database.job.last_error, "DRIVE_CHECKPOINT_STARTED:database");
  assert.equal(await worker.runCycle(), 0);
  assert.equal(driveCalls, 1);
});

test("a failed failure-checkpoint leaves a durable marker that blocks stale destructive replay", async () => {
  const database = fakeQueue({ sheet_deleted: true, remaining_file_ids: ["file_1"],
    failDriveCheckpoint: true, failFailureCheckpoint: true });
  let driveCalls = 0;
  const logger = captureLogger();
  const google = { enabled: true, async deleteImage() { driveCalls += 1; } };
  await createParcelCleanupWorker({ database, google, logger }).runCycle();
  assert.equal(database.job.status, "processing");
  assert.equal(database.job.last_error, "DRIVE_DELETE_IN_PROGRESS");
  assert.equal(driveCalls, 1);
  assert.ok(logger.events.some((entry) => entry.event === "parcel-cleanup-failure-checkpoint-failed"));
  database.job.failFailureCheckpoint = false;
  database.job.stale = true;
  await createParcelCleanupWorker({ database, google, logger }).runCycle();
  assert.equal(driveCalls, 1);
  assert.equal(database.job.status, "failed");
  assert.equal(database.job.last_error, "DRIVE_DELETE_STARTED:stale-side-effect");
});

test("lease loss and completion checkpoint failure retain precise safe stages", async () => {
  const lease = fakeQueue({ remaining_file_ids: [], loseLeaseAt: "sheet-checkpoint" });
  const leaseLogger = captureLogger();
  await createParcelCleanupWorker({ database: lease, logger: leaseLogger,
    google: { enabled: true, async deleteParcel() {} } }).runCycle();
  assert.equal(lease.job.status, "failed");
  assert.equal(lease.job.last_error, "SHEET_CHECKPOINT_STARTED:lease-lost");
  assert.doesNotMatch(JSON.stringify(leaseLogger.events), /SECRET_/);

  const completion = fakeQueue({ sheet_deleted: true, remaining_file_ids: [],
    failCompletionCheckpoint: true });
  await createParcelCleanupWorker({ database: completion, logger: captureLogger(),
    google: { enabled: true } }).runCycle();
  assert.equal(completion.job.status, "failed");
  assert.equal(completion.job.last_error, "JOB_COMPLETE_CHECKPOINT_STARTED:database");
});

test("stale non-destructive lease recovers and active processing is not claimed twice", async () => {
  const database = fakeQueue({ status: "processing", stale: true, sheet_deleted: true,
    remaining_file_ids: [] });
  const first = createParcelCleanupWorker({ database, logger: captureLogger(),
    google: { enabled: true } });
  assert.equal(await first.runCycle(), 1);
  assert.equal(database.job.status, "completed");
  const locked = fakeQueue({ status: "processing", stale: false });
  const second = createParcelCleanupWorker({ database: locked, logger: captureLogger(),
    google: { enabled: true } });
  assert.equal(await second.runCycle(), 0);
  assert.equal(locked.job.attempts, 0);
});
