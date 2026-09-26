const { randomUUID } = require("node:crypto");
const db = require("../config/database");

const MAX_ATTEMPTS = 10;
const LEASE_SECONDS = 600;
const RETRY_SECONDS = [30, 120, 300, 900, 1800];
const TRANSIENT_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const TRANSIENT_CODES = new Set(["EAI_AGAIN", "ECONNRESET", "ETIMEDOUT"]);
const TRANSIENT_CATEGORIES = new Set(["timeout", "network"]);
const CLEANUP_STAGES = Object.freeze({
  WORKER_PRECHECK: "WORKER_PRECHECK",
  SHEET_DELETE_STARTED: "SHEET_DELETE_STARTED",
  SHEET_DELETE_COMPLETED: "SHEET_DELETE_COMPLETED",
  SHEET_CHECKPOINT_STARTED: "SHEET_CHECKPOINT_STARTED",
  SHEET_CHECKPOINT_COMPLETED: "SHEET_CHECKPOINT_COMPLETED",
  DRIVE_DELETE_STARTED: "DRIVE_DELETE_STARTED",
  DRIVE_DELETE_COMPLETED: "DRIVE_DELETE_COMPLETED",
  DRIVE_CHECKPOINT_STARTED: "DRIVE_CHECKPOINT_STARTED",
  DRIVE_CHECKPOINT_COMPLETED: "DRIVE_CHECKPOINT_COMPLETED",
  JOB_COMPLETE_CHECKPOINT_STARTED: "JOB_COMPLETE_CHECKPOINT_STARTED",
  JOB_COMPLETE_CHECKPOINT_COMPLETED: "JOB_COMPLETE_CHECKPOINT_COMPLETED",
});
const IN_FLIGHT_MARKERS = new Set(["SHEET_DELETE_IN_PROGRESS", "DRIVE_DELETE_IN_PROGRESS"]);
const SAFE_CLEANUP_CODES = new Set(["google-unavailable", "invalid-file-id", "attempt-limit",
  "lease-lost", "database", "stale-side-effect", "internal"]);
const SAFE_CATEGORIES = new Set(["timeout", "network", "rejected", "invalid-config",
  "invalid-json", "invalid-response", "http"]);

function cleanupError(code) {
  const error = new Error("Parcel cleanup operation failed");
  error.cleanupCode = code;
  return error;
}

function safeErrorLabel(error, cleanupStage = CLEANUP_STAGES.WORKER_PRECHECK) {
  const stage = Object.hasOwn(CLEANUP_STAGES, cleanupStage) ? cleanupStage : "WORKER_PRECHECK";
  const googleStage = /^[a-z-]{1,50}$/.test(error?.googleStage || "") ? error.googleStage : null;
  const status = Number(error?.response?.status ?? error?.statusCode);
  const category = SAFE_CATEGORIES.has(error?.bridgeCategory) ? error.bridgeCategory : null;
  const code = TRANSIENT_CODES.has(error?.code) || error?.code === "SHEET_HEADER_MISMATCH"
    ? error.code : null;
  const internal = SAFE_CLEANUP_CODES.has(error?.cleanupCode) ? error.cleanupCode : null;
  return [stage, googleStage, Number.isInteger(status) && status >= 100 && status <= 599
    ? `http-${status}` : null, category, code, internal || (!googleStage ? "internal" : null)]
    .filter(Boolean).join(":").slice(0, 120);
}

function isTransientCleanupError(error) {
  const stage = error?.googleStage || "";
  if (stage === "drive-config" || error?.code === "SHEET_HEADER_MISMATCH") return false;
  if (!stage.startsWith("sheets-") && !stage.startsWith("apps-script-") &&
    !stage.startsWith("drive-")) return false;
  const status = Number(error?.response?.status ?? error?.statusCode);
  return TRANSIENT_STATUSES.has(status) || TRANSIENT_CODES.has(error?.code) ||
    TRANSIENT_CATEGORIES.has(error?.bridgeCategory);
}

function retryDelaySeconds(attempts) {
  return RETRY_SECONDS[Math.min(Math.max(attempts - 1, 0), RETRY_SECONDS.length - 1)];
}

function createParcelCleanupWorker({ database = db, google, workerId = randomUUID(),
  pollIntervalMs = 30000, maxJobsPerCycle = 2, leaseSeconds = LEASE_SECONDS,
  logger = console } = {}) {
  if (!google) throw new Error("Parcel cleanup Google integration is required");
  let timer;
  let busy = false;

  async function checkpoint(sql, params) {
    let result;
    try { result = await database.query(sql, params); } catch { throw cleanupError("database"); }
    if (result.rowCount !== 1) throw cleanupError("lease-lost");
  }

  async function claim() {
    const result = await database.query(`
      WITH due AS (
        SELECT id FROM app.cleanup_jobs
        WHERE (status = 'pending' AND next_attempt_at <= now())
          OR (status = 'processing' AND locked_at < now() - ($2::int * interval '1 second'))
        ORDER BY next_attempt_at, id
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE app.cleanup_jobs AS job
      SET status = 'processing', attempts = job.attempts + 1,
        locked_at = now(), locked_by = $1
      FROM due WHERE job.id = due.id
      RETURNING job.id, job.parcel_id, job.parcel_code, job.remaining_file_ids,
        job.sheet_deleted, job.attempts, job.last_error;
    `, [workerId, leaseSeconds]);
    return result.rows[0] || null;
  }

  async function recordFailure(job, error, cleanupStage) {
    const transient = [CLEANUP_STAGES.SHEET_DELETE_STARTED, CLEANUP_STAGES.DRIVE_DELETE_STARTED]
      .includes(cleanupStage) && isTransientCleanupError(error);
    const retry = transient && job.attempts < MAX_ATTEMPTS;
    const label = safeErrorLabel(error, cleanupStage);
    await checkpoint(`
      UPDATE app.cleanup_jobs
      SET status = $3, next_attempt_at = CASE WHEN $4::boolean
        THEN now() + ($5::int * interval '1 second') ELSE next_attempt_at END,
        last_error = $6, locked_at = NULL, locked_by = NULL
      WHERE id = $1 AND locked_by = $2 AND status = 'processing';
    `, [job.id, workerId, retry ? "pending" : "failed", retry,
      retryDelaySeconds(job.attempts), label]);
    logger.warn(retry ? "parcel-cleanup-retry-scheduled" : "parcel-cleanup-failed", {
      parcelId: job.parcel_id, jobId: job.id, attempt: job.attempts,
      cleanupStage, googleStage: /^[a-z-]{1,50}$/.test(error?.googleStage || "")
        ? error.googleStage : undefined,
      remainingFiles: job.remaining_file_ids.length, sheetDeleted: job.sheet_deleted,
      retryable: retry, reason: label,
      ...(retry ? { delaySeconds: retryDelaySeconds(job.attempts) } : {}),
    });
  }

  async function markExternalDelete(job, marker) {
    await checkpoint(`
      UPDATE app.cleanup_jobs SET last_error = $3, locked_at = now()
      WHERE id = $1 AND locked_by = $2 AND status = 'processing';
    `, [job.id, workerId, marker]);
  }

  async function runOne() {
    const job = await claim();
    if (!job) return false;
    logger.info("parcel-cleanup-started", { parcelId: job.parcel_id, jobId: job.id,
      attempt: job.attempts, remainingFiles: job.remaining_file_ids.length });
    let cleanupStage = CLEANUP_STAGES.WORKER_PRECHECK;
    const setStage = (stage) => {
      cleanupStage = stage;
      logger.info("parcel-cleanup-stage", { parcelId: job.parcel_id, jobId: job.id,
        attempt: job.attempts, cleanupStage: stage,
        remainingFiles: job.remaining_file_ids.length, sheetDeleted: job.sheet_deleted });
    };
    try {
      if (IN_FLIGHT_MARKERS.has(job.last_error)) {
        setStage(job.last_error === "SHEET_DELETE_IN_PROGRESS"
          ? CLEANUP_STAGES.SHEET_DELETE_STARTED : CLEANUP_STAGES.DRIVE_DELETE_STARTED);
        throw cleanupError("stale-side-effect");
      }
      if (job.attempts > MAX_ATTEMPTS) throw cleanupError("attempt-limit");
      if (!google.enabled || (!job.sheet_deleted && typeof google.deleteParcel !== "function") ||
        (job.remaining_file_ids.length > 0 && typeof google.deleteImage !== "function")) {
        throw cleanupError("google-unavailable");
      }
      if (!job.sheet_deleted) {
        setStage(CLEANUP_STAGES.SHEET_DELETE_STARTED);
        await markExternalDelete(job, "SHEET_DELETE_IN_PROGRESS");
        await google.deleteParcel(job.parcel_code);
        setStage(CLEANUP_STAGES.SHEET_DELETE_COMPLETED);
        setStage(CLEANUP_STAGES.SHEET_CHECKPOINT_STARTED);
        await checkpoint(`
          UPDATE app.cleanup_jobs SET sheet_deleted = true, last_error = NULL, locked_at = now()
          WHERE id = $1 AND locked_by = $2 AND status = 'processing';
        `, [job.id, workerId]);
        job.sheet_deleted = true;
        setStage(CLEANUP_STAGES.SHEET_CHECKPOINT_COMPLETED);
      }
      for (const fileId of job.remaining_file_ids) {
        if (typeof fileId !== "string" || !/^[A-Za-z0-9_-]+$/.test(fileId)) {
          setStage(CLEANUP_STAGES.DRIVE_DELETE_STARTED);
          throw cleanupError("invalid-file-id");
        }
        setStage(CLEANUP_STAGES.DRIVE_DELETE_STARTED);
        await markExternalDelete(job, "DRIVE_DELETE_IN_PROGRESS");
        await google.deleteImage(fileId);
        setStage(CLEANUP_STAGES.DRIVE_DELETE_COMPLETED);
        setStage(CLEANUP_STAGES.DRIVE_CHECKPOINT_STARTED);
        await checkpoint(`
          UPDATE app.cleanup_jobs
          SET remaining_file_ids = array_remove(remaining_file_ids, $3::text),
            last_error = NULL, locked_at = now()
          WHERE id = $1 AND locked_by = $2 AND status = 'processing';
        `, [job.id, workerId, fileId]);
        job.remaining_file_ids = job.remaining_file_ids.filter((id) => id !== fileId);
        setStage(CLEANUP_STAGES.DRIVE_CHECKPOINT_COMPLETED);
      }
      setStage(CLEANUP_STAGES.JOB_COMPLETE_CHECKPOINT_STARTED);
      await checkpoint(`
        UPDATE app.cleanup_jobs
        SET status = 'completed', completed_at = now(), locked_at = NULL, locked_by = NULL,
          last_error = NULL
        WHERE id = $1 AND locked_by = $2 AND status = 'processing'
          AND sheet_deleted AND cardinality(remaining_file_ids) = 0;
      `, [job.id, workerId]);
      setStage(CLEANUP_STAGES.JOB_COMPLETE_CHECKPOINT_COMPLETED);
      logger.info("parcel-cleanup-completed", { parcelId: job.parcel_id, jobId: job.id,
        attempt: job.attempts });
    } catch (error) {
      try { await recordFailure(job, error, cleanupStage); } catch (checkpointError) {
        logger.error("parcel-cleanup-failure-checkpoint-failed", {
          parcelId: job.parcel_id, jobId: job.id, attempt: job.attempts, cleanupStage,
          reason: safeErrorLabel(checkpointError, cleanupStage),
          sheetDeleted: job.sheet_deleted, remainingFiles: job.remaining_file_ids.length,
        });
      }
    }
    return true;
  }

  async function runCycle() {
    if (busy) return 0;
    busy = true;
    let processed = 0;
    try {
      while (processed < maxJobsPerCycle && await runOne()) processed += 1;
      return processed;
    } finally {
      busy = false;
    }
  }

  function start() {
    if (timer) return;
    const tick = () => { void runCycle().catch(() => logger.error("parcel-cleanup-poll-failed")); };
    timer = setInterval(tick, pollIntervalMs);
    timer.unref?.();
    const initial = setImmediate(tick);
    initial.unref?.();
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { claim, runOne, runCycle, start, stop };
}

module.exports = { createParcelCleanupWorker, isTransientCleanupError,
  retryDelaySeconds, safeErrorLabel, CLEANUP_STAGES, MAX_ATTEMPTS, LEASE_SECONDS };
