const db = require("../config/database");
const parcelService = require("./parcelService");
const parcelMirrorService = require("./parcelMirrorService");
const { normalizeImage, validateClientPhotoId, ambiguousDriveWrite } = require("./parcelImageService");
const createHttpError = require("../utils/httpError");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IMAGE_ID = /^[A-Za-z0-9_-]+\.webp$/;
const ACTIVE = "status NOT IN ('completed', 'expired')";

function conflict() { return createHttpError(409, "ข้อมูลรูปภาพแปลงเปลี่ยนแล้ว กรุณาโหลดข้อมูลใหม่"); }
function ids(images) { return images.map((image) => image.fileName); }
function sameIds(left, right) {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}
function sameImages(left, right) {
  return left.length === right.length && left.every((image, index) =>
    image.fileName === right[index]?.fileName && image.fileId === right[index]?.fileId);
}
function safeIds(value, pattern, limit = 5) {
  if (!Array.isArray(value) || value.length > limit ||
    value.some((id) => typeof id !== "string" || !pattern.test(id)) ||
    new Set(value).size !== value.length) throw createHttpError(400, "ข้อมูลรูปภาพไม่ถูกต้อง");
  return value;
}
function safeMetadata(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
    Object.keys(value).some((key) => !["parcelName", "cropType", "riceVariety", "plantingDate", "note"].includes(key))) {
    throw createHttpError(400, "ข้อมูลแปลงไม่ถูกต้อง");
  }
  const text = (key, max) => typeof value[key] === "string" && value[key].length <= max;
  if ((value.parcelName !== undefined && !text("parcelName", 150)) ||
    (value.cropType !== undefined && (!text("cropType", 100) || !value.cropType.trim())) ||
    (value.riceVariety !== undefined && !text("riceVariety", 150)) ||
    (value.note !== undefined && !text("note", 5000))) throw createHttpError(400, "ข้อมูลแปลงไม่ถูกต้อง");
  if (value.plantingDate !== undefined) parcelService._private.validateDate(value.plantingDate);
  return value;
}

function parseRevision(value) {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT/.test(value) ||
    !Number.isFinite(Date.parse(value))) throw createHttpError(400, "เวลาอ้างอิงแปลงไม่ถูกต้อง");
  return new Date(value).toISOString();
}

async function claimParcelMutation(parcelId, ownerId, kind, database = db) {
  const result = await database.query(`
    INSERT INTO app.parcel_photo_operations (parcel_id, owner_user_id, kind)
    SELECT id, owner_user_id, $3 FROM app.parcels
    WHERE id = $1 AND owner_user_id = $2
    ON CONFLICT DO NOTHING RETURNING id;
  `, [parcelId, ownerId, kind]);
  if (result.rows[0]) return result.rows[0].id;
  await parcelService.getOwnedParcelById(parcelId, ownerId, database);
  throw conflict();
}

async function assertNoSavedEdit(parcelId, database = db) {
  const result = await database.query(`
    SELECT id FROM app.parcel_photo_operations
    WHERE parcel_id = $1 AND kind = 'saved_edit' AND ${ACTIVE} LIMIT 1;
  `, [parcelId]);
  if (result.rows.length) throw conflict();
}

async function getOwnedOperation(parcelId, ownerId, operationId, database = db) {
  if (!UUID.test(parcelId || "")) throw createHttpError(400, "รหัสแปลงไม่ถูกต้อง");
  if (!UUID.test(operationId || "")) throw createHttpError(400, "รหัสการแก้ไขไม่ถูกต้อง");
  const result = await database.query(`
    SELECT id, parcel_id, owner_user_id, kind, status, parcel_code, expected_updated_at,
      expected_images, removed_image_ids, new_photo_ids, uploaded_images, metadata,
      active_photo_id, lease_until, expires_at
    FROM app.parcel_photo_operations
    WHERE id = $1 AND parcel_id = $2 AND owner_user_id = $3 AND kind = 'saved_edit';
  `, [operationId, parcelId, ownerId]);
  if (!result.rows[0]) throw createHttpError(404, "ไม่พบรายการแก้ไข");
  return result.rows[0];
}

function publicOperation(operation) {
  return { id: operation.id, status: operation.status,
    uploadedPhotoIds: Object.keys(operation.uploaded_images || {}),
    ...(["sheet_committed", "metadata_applied"].includes(operation.status)
      ? { outcome: "PHOTO_SET_COMMITTED_METADATA_PENDING" } : {}),
    ...(operation.active_photo_id ? { activePhotoId: operation.active_photo_id } : {}) };
}

async function beginSavedEdit(parcelId, ownerId, payload, google, database = db) {
  if (!google?.enabled) throw createHttpError(503, "บริการรูปภาพแปลงยังไม่พร้อมใช้งาน");
  const expectedIds = safeIds(payload?.expectedImageIds, IMAGE_ID);
  const removedIds = safeIds(payload?.removedImageIds, IMAGE_ID);
  const newIds = safeIds(payload?.newPhotoIds, UUID).map(validateClientPhotoId);
  const metadata = safeMetadata(payload?.metadata);
  const expectedUpdatedAt = parseRevision(payload?.expectedUpdatedAt);
  if (!removedIds.length && !newIds.length) {
    throw createHttpError(400, "ไม่มีการเปลี่ยนแปลงรูปภาพแปลง");
  }
  if (!removedIds.every((id) => expectedIds.includes(id)) ||
    expectedIds.length - removedIds.length + newIds.length > 5) {
    throw createHttpError(400, "เลือกได้สูงสุด 5 รูป");
  }
  const parcel = await parcelService.getOwnedParcelById(parcelId, ownerId, database);
  if (new Date(parcel.updatedAt).toISOString() !== expectedUpdatedAt) throw conflict();
  const operationId = await parcelService.withParcelMutationLock(parcel.id, async (client) => {
    const current = await parcelService.getOwnedParcelById(parcel.id, ownerId, client);
    if (new Date(current.updatedAt).toISOString() !== expectedUpdatedAt) throw conflict();
    return claimParcelMutation(parcel.id, ownerId, "saved_edit", client);
  });
  try {
    const images = await google.getParcelImages(parcel.parcelCode, ownerId);
    if (!sameIds(ids(images), expectedIds)) throw conflict();
    const saved = await database.query(`
      UPDATE app.parcel_photo_operations SET status = 'ready', parcel_code = $2,
        expected_updated_at = $3, expected_images = $4::jsonb,
        removed_image_ids = $5::text[], new_photo_ids = $6::uuid[], metadata = $7::jsonb
      WHERE id = $1 AND status = 'preparing' RETURNING id, status, uploaded_images;
    `, [operationId, parcel.parcelCode, parcel.updatedAt, JSON.stringify(images),
      removedIds, newIds, JSON.stringify(metadata)]);
    if (!saved.rows[0]) throw conflict();
    return publicOperation(saved.rows[0]);
  } catch (error) {
    await database.query("UPDATE app.parcel_photo_operations SET status = 'expired' WHERE id = $1 AND status = 'preparing'", [operationId]);
    throw error;
  }
}

async function uploadSavedEditImage(parcelId, ownerId, operationId, clientPhotoId, file, google, database = db) {
  const photoId = validateClientPhotoId(clientPhotoId);
  const operation = await getOwnedOperation(parcelId, ownerId, operationId, database);
  if (!operation.new_photo_ids.includes(photoId)) throw createHttpError(400, "รหัสรูปภาพไม่ถูกต้อง");
  if (operation.uploaded_images?.[photoId]) {
    return { id: operation.uploaded_images[photoId].fileName };
  }
  if (operation.status !== "ready") throw conflict();
  const normalized = await normalizeImage(file);
  const claimed = await database.query(`
    UPDATE app.parcel_photo_operations SET status = 'uploading', active_photo_id = $2,
      lease_until = now() + interval '2 minutes'
    WHERE id = $1 AND status = 'ready' AND expires_at > now()
      AND (lease_until IS NULL OR lease_until < now()) RETURNING id;
  `, [operationId, photoId]);
  if (!claimed.rows[0]) throw conflict();
  const fileName = `${operation.parcel_code}_${photoId}.webp`;
  let fileId;
  try {
    fileId = await google.uploadImage(normalized.bytes, fileName);
  } catch (error) {
    const ambiguous = ambiguousDriveWrite(error);
    await database.query(`
      UPDATE app.parcel_photo_operations SET status = $2, active_photo_id = NULL, lease_until = NULL
      WHERE id = $1 AND status = 'uploading';
    `, [operationId, ambiguous ? "ambiguous" : "ready"]);
    if (ambiguous) error.photoAmbiguous = true;
    throw error;
  }
  let updated;
  try {
    updated = await database.query(`
      UPDATE app.parcel_photo_operations
      SET uploaded_images = uploaded_images || jsonb_build_object($2::text,
        jsonb_build_object('fileName', $3::text, 'fileId', $4::text)),
        status = 'ready', active_photo_id = NULL, lease_until = NULL
      WHERE id = $1 AND status = 'uploading' AND active_photo_id = $2::uuid
      RETURNING id;
    `, [operationId, photoId, fileName, fileId]);
  } catch {
    const error = createHttpError(503, "ไม่สามารถยืนยันผลอัปโหลดได้");
    error.photoAmbiguous = true;
    throw error;
  }
  if (!updated.rows[0]) {
    const error = createHttpError(503, "ไม่สามารถยืนยันผลอัปโหลดได้");
    error.photoAmbiguous = true;
    throw error;
  }
  return { id: fileName };
}

function finalImages(operation) {
  const removed = new Set(operation.removed_image_ids);
  const kept = operation.expected_images.filter((image) => !removed.has(image.fileName));
  const added = operation.new_photo_ids.map((id) => operation.uploaded_images[id]);
  if (added.some((image) => !image?.fileId)) throw createHttpError(409, "รูปภาพยังอัปโหลดไม่ครบ");
  return [...kept, ...added];
}

async function enqueueDetached(operation, database = db) {
  const detached = operation.expected_images.filter((image) =>
    operation.removed_image_ids.includes(image.fileName)).map((image) => image.fileId);
  if (detached.length) await database.query(`
    INSERT INTO app.cleanup_jobs (job_type, parcel_id, parcel_code, remaining_file_ids,
      sheet_deleted, source_operation_id)
    VALUES ('photo_deletion', $1, $2, $3::text[], true, $4)
    ON CONFLICT DO NOTHING;
  `, [operation.parcel_id, operation.parcel_code, detached, operation.id]);
  await database.query(`
    UPDATE app.parcel_photo_operations SET status = 'sheet_committed', lease_until = NULL
    WHERE id = $1 AND status = 'finalizing';
  `, [operation.id]);
}

async function finalizeSavedEdit(parcelId, ownerId, operationId, google, database = db) {
  const operation = await getOwnedOperation(parcelId, ownerId, operationId, database);
  if (operation.status === "completed") return publicOperation(operation);
  if (["ambiguous", "uploading", "preparing", "expired"].includes(operation.status)) throw conflict();
  const desired = finalImages(operation);
  let photoSetCommitted = ["sheet_committed", "metadata_applied"].includes(operation.status);
  let leasePhase = null;
  try {
    if (operation.status === "ready" || operation.status === "finalizing") {
      const claimed = await database.query(`
        UPDATE app.parcel_photo_operations SET status = 'finalizing',
          lease_until = now() + interval '2 minutes'
        WHERE id = $1 AND (status = 'ready' AND expires_at > now()
          AND (lease_until IS NULL OR lease_until < now()) OR
          (status = 'finalizing' AND (lease_until IS NULL OR lease_until < now()))) RETURNING id;
      `, [operationId]);
      if (!claimed.rows[0]) throw conflict();
      leasePhase = "finalizing";
      try {
        await google.replaceParcelImages(operation.parcel_code, ownerId, operation.expected_images, desired);
        photoSetCommitted = true;
      } catch (error) {
        // A lost provider response can follow a successful Sheet write.
        try {
          const currentImages = await google.getParcelImages(operation.parcel_code, ownerId);
          photoSetCommitted = sameImages(currentImages, desired);
        } catch { /* Keep the write outcome unknown. */ }
        throw error;
      }
      await enqueueDetached(operation, database);
      leasePhase = null;
    }
    const current = await getOwnedOperation(parcelId, ownerId, operationId, database);
    if (current.status === "sheet_committed") {
      const claimed = await database.query(`
        UPDATE app.parcel_photo_operations SET lease_until = now() + interval '2 minutes'
        WHERE id = $1 AND status = 'sheet_committed'
          AND (lease_until IS NULL OR lease_until < now()) RETURNING id;
      `, [operationId]);
      if (!claimed.rows[0]) throw conflict();
      leasePhase = "sheet_committed";
      if (Object.keys(current.metadata).length) {
        await parcelService.updateOwnedParcel(parcelId, current.metadata, ownerId);
      }
      const record = await parcelMirrorService.getParcelMirrorRecord(parcelId, database);
      await google.upsertParcel(record);
      await database.query(`
        UPDATE app.parcel_photo_operations SET status = 'metadata_applied', lease_until = NULL
        WHERE id = $1 AND status = 'sheet_committed';
      `, [operationId]);
      leasePhase = null;
    }
    await database.query(`
      UPDATE app.parcel_photo_operations SET status = 'completed', completed_at = now(),
        expected_images = '[]'::jsonb, uploaded_images = '{}'::jsonb,
        metadata = '{}'::jsonb, removed_image_ids = '{}', new_photo_ids = '{}',
        expires_at = now() + interval '1 day'
      WHERE id = $1 AND status = 'metadata_applied';
    `, [operationId]);
    return publicOperation(await getOwnedOperation(parcelId, ownerId, operationId, database));
  } catch (error) {
    if (photoSetCommitted) {
      error.photoSetCommitted = true;
      if (leasePhase) {
        try {
          await database.query(`UPDATE app.parcel_photo_operations SET lease_until = NULL
            WHERE id = $1 AND status = $2`, [operationId, leasePhase]);
        } catch { /* The lease still expires for worker reconciliation. */ }
      }
    }
    throw error;
  }
}

async function sweepExpired(google, database = db) {
  await database.query(`
    DELETE FROM app.parcel_photo_operations
    WHERE status IN ('completed', 'expired') AND expires_at < now();
  `);
  const candidate = await database.query(`
    WITH due AS (
      SELECT id FROM app.parcel_photo_operations
      WHERE expires_at < now() AND status IN (
        'preparing', 'ready', 'uploading', 'finalizing', 'sheet_committed', 'metadata_applied'
      ) AND (lease_until IS NULL OR lease_until < now())
      ORDER BY expires_at, id FOR UPDATE SKIP LOCKED LIMIT 1
    )
    UPDATE app.parcel_photo_operations AS operation
    SET lease_until = now() + interval '2 minutes'
    FROM due WHERE operation.id = due.id
    RETURNING operation.id, operation.parcel_id, operation.owner_user_id, operation.kind,
      operation.status, operation.parcel_code, operation.expected_images,
      operation.removed_image_ids, operation.new_photo_ids, operation.uploaded_images;
  `);
  const operation = candidate.rows[0];
  if (!operation) return false;
  if (operation.status === "uploading") {
    await database.query(`
      UPDATE app.parcel_photo_operations SET status = 'ambiguous', lease_until = NULL
      WHERE id = $1;
    `, [operation.id]);
    return true;
  }
  if (operation.status === "sheet_committed" || operation.status === "metadata_applied") {
    if (operation.status === "sheet_committed") {
      await database.query("UPDATE app.parcel_photo_operations SET lease_until = NULL WHERE id = $1 AND status = 'sheet_committed'", [operation.id]);
    }
    await finalizeSavedEdit(operation.parcel_id, operation.owner_user_id, operation.id, google, database);
    return true;
  }
  if (operation.status === "preparing") {
    await database.query("UPDATE app.parcel_photo_operations SET status = 'expired' WHERE id = $1", [operation.id]);
    return true;
  }
  const current = await google.getParcelImages(operation.parcel_code, operation.owner_user_id);
  const expected = operation.expected_images;
  const desired = Object.keys(operation.uploaded_images).length === operation.new_photo_ids.length
    ? finalImages(operation) : null;
  if (operation.status === "finalizing" && desired && sameImages(current, desired)) {
    await enqueueDetached(operation, database);
    await finalizeSavedEdit(operation.parcel_id, operation.owner_user_id, operation.id, google, database);
    return true;
  }
  if (!sameImages(current, expected)) {
    await database.query("UPDATE app.parcel_photo_operations SET status = 'ambiguous', lease_until = NULL WHERE id = $1", [operation.id]);
    return true;
  }
  if (operation.status === "finalizing") {
    await database.query("UPDATE app.parcel_photo_operations SET status = 'ambiguous', lease_until = NULL WHERE id = $1", [operation.id]);
    return true;
  }
  const uploadedFileIds = Object.values(operation.uploaded_images).map((image) => image.fileId);
  if (uploadedFileIds.some((fileId) => current.some((image) => image.fileId === fileId))) {
    await database.query("UPDATE app.parcel_photo_operations SET status = 'ambiguous', lease_until = NULL WHERE id = $1", [operation.id]);
    return true;
  }
  if (uploadedFileIds.length) await database.query(`
    INSERT INTO app.cleanup_jobs (job_type, parcel_id, parcel_code, remaining_file_ids,
      sheet_deleted, source_operation_id)
    VALUES ('photo_deletion', $1, $2, $3::text[], true, $4) ON CONFLICT DO NOTHING;
  `, [operation.parcel_id, operation.parcel_code, uploadedFileIds, operation.id]);
  await database.query(`
    UPDATE app.parcel_photo_operations SET status = 'expired', lease_until = NULL,
      expected_images = '[]'::jsonb, uploaded_images = '{}'::jsonb,
      expires_at = now() + interval '1 day'
    WHERE id = $1;
  `, [operation.id]);
  return true;
}

module.exports = { claimParcelMutation, assertNoSavedEdit, getOwnedOperation,
  publicOperation, beginSavedEdit, uploadSavedEditImage, finalizeSavedEdit, sweepExpired };
