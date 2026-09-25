const { randomUUID } = require("node:crypto");
const db = require("../config/database");

const MAX_ATTEMPTS = 10;
const LEASE_SECONDS = 600;
const RETRY_SECONDS = [30, 120, 300, 900, 1800];
const TRANSIENT_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const TRANSIENT_CODES = new Set(["EAI_AGAIN", "ECONNRESET", "ETIMEDOUT"]);
const TRANSIENT_CATEGORIES = new Set(["timeout", "network"]);

function safeErrorLabel(error) {
  const stage = /^[a-z-]{1,50}$/.test(error?.googleStage || "") ? error.googleStage : "cleanup";
  const status = Number(error?.response?.status ?? error?.statusCode);
  const category = TRANSIENT_CATEGORIES.has(error?.bridgeCategory) ? error.bridgeCategory : null;
  const code = TRANSIENT_CODES.has(error?.code) || error?.code === "SHEET_HEADER_MISMATCH"
    ? error.code : null;
  return [stage, Number.isInteger(status) && status >= 100 && status <= 599 ? `http-${status}` : null,
    category, code].filter(Boolean).join(":");
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
  pollIntervalMs = 30000, maxJobsPerCycle = 2, leaseSeconds = LEASE_SECONDS } = {}) {
  if (!google) throw new Error("Parcel cleanup Google integration is required");
  let timer;
  let busy = false;

  async function checkpoint(sql, params) {
    const result = await database.query(sql, params);
    if (result.rowCount !== 1) throw new Error("Parcel cleanup lease was lost");
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
        job.sheet_deleted, job.attempts;
    `, [workerId, leaseSeconds]);
    return result.rows[0] || null;
  }

  async function recordFailure(job, error) {
    const transient = isTransientCleanupError(error);
    const retry = transient && job.attempts < MAX_ATTEMPTS;
    const label = safeErrorLabel(error);
    await checkpoint(`
      UPDATE app.cleanup_jobs
      SET status = $3, next_attempt_at = CASE WHEN $4::boolean
        THEN now() + ($5::int * interval '1 second') ELSE next_attempt_at END,
        last_error = $6, locked_at = NULL, locked_by = NULL
      WHERE id = $1 AND locked_by = $2 AND status = 'processing';
    `, [job.id, workerId, retry ? "pending" : "failed", retry,
      retryDelaySeconds(job.attempts), label]);
    console.warn(retry ? "parcel-cleanup-retry-scheduled" : "parcel-cleanup-failed", {
      parcelId: job.parcel_id, jobId: job.id, attempt: job.attempts,
      remainingFiles: job.remaining_file_ids.length, reason: label,
      ...(retry ? { delaySeconds: retryDelaySeconds(job.attempts) } : {}),
    });
  }

  async function runOne() {
    const job = await claim();
    if (!job) return false;
    console.info("parcel-cleanup-started", { parcelId: job.parcel_id, jobId: job.id,
      attempt: job.attempts, remainingFiles: job.remaining_file_ids.length });
    try {
      if (job.attempts > MAX_ATTEMPTS) throw new Error("Parcel cleanup attempt limit reached");
      if (!google.enabled) throw new Error("Parcel cleanup Google integration is unavailable");
      if (!job.sheet_deleted) {
        await google.deleteParcel(job.parcel_code);
        await checkpoint(`
          UPDATE app.cleanup_jobs SET sheet_deleted = true, locked_at = now()
          WHERE id = $1 AND locked_by = $2 AND status = 'processing';
        `, [job.id, workerId]);
        console.info("parcel-sheet-cleanup-complete", { parcelId: job.parcel_id, jobId: job.id });
      }
      for (const fileId of job.remaining_file_ids) {
        if (typeof fileId !== "string" || !/^[A-Za-z0-9_-]+$/.test(fileId)) {
          throw new Error("Invalid cleanup file ID");
        }
        await google.deleteImage(fileId);
        await checkpoint(`
          UPDATE app.cleanup_jobs
          SET remaining_file_ids = array_remove(remaining_file_ids, $3::text), locked_at = now()
          WHERE id = $1 AND locked_by = $2 AND status = 'processing';
        `, [job.id, workerId, fileId]);
        job.remaining_file_ids = job.remaining_file_ids.filter((id) => id !== fileId);
        console.info("parcel-drive-cleanup-file-complete", { parcelId: job.parcel_id, jobId: job.id,
          remainingFiles: job.remaining_file_ids.length });
      }
      await checkpoint(`
        UPDATE app.cleanup_jobs
        SET status = 'completed', completed_at = now(), locked_at = NULL, locked_by = NULL,
          last_error = NULL
        WHERE id = $1 AND locked_by = $2 AND status = 'processing'
          AND sheet_deleted AND cardinality(remaining_file_ids) = 0;
      `, [job.id, workerId]);
      console.info("parcel-cleanup-completed", { parcelId: job.parcel_id, jobId: job.id,
        attempt: job.attempts });
    } catch (error) {
      try { await recordFailure(job, error); } catch (checkpointError) {
        console.error("parcel-cleanup-checkpoint-failed", { parcelId: job.parcel_id, jobId: job.id });
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
    const tick = () => { void runCycle().catch(() => console.error("parcel-cleanup-poll-failed")); };
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
  retryDelaySeconds, safeErrorLabel, MAX_ATTEMPTS, LEASE_SECONDS };
