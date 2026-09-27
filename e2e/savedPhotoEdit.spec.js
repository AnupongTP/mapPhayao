const path = require("node:path");
const { readFileSync } = require("node:fs");
const { randomUUID } = require("node:crypto");
const { test, expect } = require("@playwright/test");
const db = require("../backend/src/config/database");
const { backendUrl } = require("./support");
const { prepareContext, openMap } = require("./support");

const owner = { Authorization: "Bearer e2e-line-token-user-a" };
const other = { Authorization: "Bearer e2e-line-token-user-b" };
const image = { name: "field.png", mimeType: "image/png",
  buffer: readFileSync(path.resolve(__dirname, "../geoserver/data_dir/styles/grass_fill.png")) };

async function detail(request, parcelId) {
  const response = await request.get(`${backendUrl}/api/parcels/${parcelId}`, { headers: owner });
  expect(response.status()).toBe(200);
  return (await response.json()).parcel;
}

async function begin(request, parcel, removedImageIds, newPhotoIds, metadata = {}) {
  return request.post(`${backendUrl}/api/parcels/${parcel.id}/photo-edits`, { headers: owner,
    data: { expectedUpdatedAt: parcel.updatedAt, expectedImageIds: parcel.images.map((item) => item.id),
      removedImageIds, newPhotoIds, metadata } });
}

async function createParcel(request, prefix) {
  const response = await request.post(`${backendUrl}/api/parcels`, { headers: owner,
    data: { parcelName: `${prefix}-${randomUUID()}`, cropType: "rice", plantingDate: "2026-09-27",
      geometry: { type: "Polygon", coordinates: [[
        [99.889, 19.028], [99.890, 19.028], [99.890, 19.029], [99.889, 19.028],
      ]] } } });
  expect(response.status()).toBe(201);
  return (await response.json()).parcel;
}

test.beforeAll(() => {
  if (process.env.DB_HOST !== "127.0.0.1" || process.env.DB_PORT !== "55432" ||
    process.env.DB_NAME !== "mapphayao_e2e") throw new Error("Refusing non-local photo edit database");
});

test("saved photo edit publishes one final set, preserves ownership, and durably deletes detached files", async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium");
  const created = await request.post(`${backendUrl}/api/parcels`, { headers: owner,
    data: { parcelName: `PHOTO-EDIT-${randomUUID()}`, cropType: "rice", plantingDate: "2026-09-27",
      geometry: { type: "Polygon", coordinates: [[
        [99.889, 19.028], [99.890, 19.028], [99.890, 19.029], [99.889, 19.028],
      ]] } } });
  expect(created.status()).toBe(201);
  const parcel = (await created.json()).parcel;
  try {
    for (let index = 0; index < 2; index += 1) {
      const uploaded = await request.post(`${backendUrl}/api/parcels/${parcel.id}/images`, {
        headers: owner, multipart: { image, clientPhotoId: randomUUID() },
      });
      expect(uploaded.status()).toBe(201);
    }
    const before = await detail(request, parcel.id);
    expect(before.images).toHaveLength(2);
    expect((await request.post(`${backendUrl}/__e2e__/google/require-idle-pool`,
      { data: { enabled: true } })).status()).toBe(200);
    const photoId = randomUUID();
    const started = await begin(request, before, [before.images[0].id], [photoId], { note: "Photo edit" });
    expect(started.status()).toBe(201);
    const operationId = (await started.json()).operation.id;
    expect((await begin(request, before, [], [randomUUID()])).status()).toBe(409);
    expect((await request.get(`${backendUrl}/api/parcels/${parcel.id}/photo-edits/${operationId}`,
      { headers: other })).status()).toBe(404);
    expect((await request.post(`${backendUrl}/api/parcels/${parcel.id}/photo-edits`, {
      headers: other, data: { expectedUpdatedAt: before.updatedAt,
        expectedImageIds: before.images.map((item) => item.id),
        removedImageIds: [before.images[0].id], newPhotoIds: [], metadata: {} },
    })).status()).toBe(404);
    expect((await request.delete(`${backendUrl}/api/parcels/${parcel.id}`, { headers: owner })).status()).toBe(409);
    expect((await request.post(`${backendUrl}/api/parcels/${parcel.id}/images`, {
      headers: owner, multipart: { image, clientPhotoId: randomUUID() },
    })).status()).toBe(409);

    const beforeFinal = await (await request.get(`${backendUrl}/__e2e__/google`)).json();
    const rowBefore = beforeFinal.parcels.find((row) => row[2] === parcel.parcelCode);
    expect(JSON.parse(rowBefore[11])).toEqual(before.images.map((item) => item.id));
    const uploaded = await request.post(`${backendUrl}/api/parcels/${parcel.id}/photo-edits/${operationId}/images`, {
      headers: owner, multipart: { image, clientPhotoId: photoId },
    });
    expect(uploaded.status()).toBe(201);
    expect((await request.post(`${backendUrl}/api/parcels/${parcel.id}/photo-edits/${operationId}/images`, {
      headers: other, multipart: { image, clientPhotoId: photoId },
    })).status()).toBe(404);
    expect((await request.post(`${backendUrl}/api/parcels/${parcel.id}/photo-edits/${operationId}/finalize`,
      { headers: other, data: {} })).status()).toBe(404);
    const newImageId = (await uploaded.json()).image.id;
    const repeated = await request.post(`${backendUrl}/api/parcels/${parcel.id}/photo-edits/${operationId}/images`, {
      headers: owner, multipart: { image, clientPhotoId: photoId },
    });
    expect(repeated.status()).toBe(201);
    expect((await repeated.json()).image.id).toBe(newImageId);
    expect((await detail(request, parcel.id)).images.map((item) => item.id))
      .toEqual(before.images.map((item) => item.id));

    const finalized = await request.post(`${backendUrl}/api/parcels/${parcel.id}/photo-edits/${operationId}/finalize`,
      { headers: owner, data: {} });
    expect(finalized.status()).toBe(200);
    expect((await finalized.json()).operation.status).toBe("completed");
    expect((await request.post(`${backendUrl}/api/parcels/${parcel.id}/photo-edits/${operationId}/finalize`,
      { headers: owner, data: {} })).status()).toBe(200);
    const after = await detail(request, parcel.id);
    expect(after.note).toBe("Photo edit");
    expect(after.images.map((item) => item.id)).toEqual([before.images[1].id, newImageId]);
    const job = (await db.query(`SELECT job_type, sheet_deleted, remaining_file_ids, status
      FROM app.cleanup_jobs WHERE source_operation_id = $1`, [operationId])).rows[0];
    expect(job).toMatchObject({ job_type: "photo_deletion", sheet_deleted: true, status: "pending" });
    expect(job.remaining_file_ids).toHaveLength(1);
    await expect.poll(async () => {
      await request.post(`${backendUrl}/__e2e__/cleanup/run`);
      return (await db.query("SELECT status FROM app.cleanup_jobs WHERE source_operation_id = $1",
        [operationId])).rows[0]?.status;
    }).toBe("completed");
    const cleaned = await (await request.get(`${backendUrl}/__e2e__/google`)).json();
    expect(cleaned.parcels.find((row) => row[2] === parcel.parcelCode)).toBeDefined();
    expect(cleaned.files.map((file) => file.fileName)).toEqual(expect.arrayContaining([newImageId]));
    expect(cleaned.files.some((file) => file.fileName === before.images[0].id)).toBe(false);
    expect((await db.query("SELECT to_regclass('app.parcel_images') AS name")).rows[0].name).toBeNull();
  } finally {
    await request.post(`${backendUrl}/__e2e__/google/require-idle-pool`, { data: { enabled: false } });
    await request.delete(`${backendUrl}/api/parcels/${parcel.id}`, { headers: owner }).catch(() => {});
  }
});

test("mobile edit stages photos locally, Undo and Cancel do not mutate Google, then Save publishes", async ({ page, context, request }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium");
  const forbidden = await prepareContext(context, { token: "e2e-line-token-user-a" });
  const created = await request.post(`${backendUrl}/api/parcels`, { headers: owner,
    data: { parcelName: `PHOTO-UI-${randomUUID()}`, cropType: "rice", plantingDate: "2026-09-27",
      geometry: { type: "Polygon", coordinates: [[
        [99.889, 19.028], [99.890, 19.028], [99.890, 19.029], [99.889, 19.028],
      ]] } } });
  expect(created.status()).toBe(201);
  const parcel = (await created.json()).parcel;
  try {
    expect((await request.post(`${backendUrl}/api/parcels/${parcel.id}/images`, {
      headers: owner, multipart: { image, clientPhotoId: randomUUID() },
    })).status()).toBe(201);
    const original = await (await request.get(`${backendUrl}/__e2e__/google`)).json();
    const originalRow = original.parcels.find((row) => row[2] === parcel.parcelCode);
    await openMap(page, true);
    await page.locator("#saved-parcels-control-button").click();
    const card = page.locator(`.saved-parcel-card[data-parcel-id="${parcel.id}"]`);
    await card.locator(".saved-parcel-header").click();
    await card.getByRole("button", { name: "แก้ไขข้อมูล" }).click();
    const sheet = page.locator("#parcel-edit-sheet");
    await expect(sheet.locator(".saved-photo-edit-count")).toHaveText("1/5");
    await expect(sheet.locator(".saved-photo-edit-item img")).toHaveAttribute("src", /^blob:/);
    await sheet.getByRole("button", { name: "ทำเครื่องหมายลบรูปภาพ" }).click();
    await expect(sheet.locator(".saved-photo-edit-item")).toContainText("รอลบ");
    await sheet.getByRole("button", { name: "ยกเลิกการลบรูปภาพ" }).click();
    await expect(sheet.locator(".saved-photo-edit-count")).toHaveText("1/5");
    await sheet.locator(".saved-photo-edit input[type=file]").setInputFiles(image);
    await expect(sheet.locator(".saved-photo-edit-count")).toHaveText("2/5");
    await expect(sheet.locator(".saved-photo-edit-item").last()).toContainText("ใหม่");
    await sheet.getByRole("button", { name: "นำรูปภาพใหม่ออก" }).click();
    await expect(sheet.locator(".saved-photo-edit-count")).toHaveText("1/5");
    await sheet.getByRole("button", { name: "ยกเลิก" }).click();
    await expect(sheet).toHaveCount(0);
    const afterCancel = await (await request.get(`${backendUrl}/__e2e__/google`)).json();
    expect(afterCancel.files).toEqual(original.files);
    expect(afterCancel.parcels.find((row) => row[2] === parcel.parcelCode)).toEqual(originalRow);

    await card.getByRole("button", { name: "แก้ไขข้อมูล" }).click();
    await expect(sheet).toBeVisible();
    await sheet.getByRole("button", { name: "ทำเครื่องหมายลบรูปภาพ" }).click();
    await sheet.locator(".saved-photo-edit input[type=file]").setInputFiles({
      name: image.name, mimeType: image.mimeType, buffer: image.buffer,
    });
    await expect(sheet.locator(".saved-photo-edit-count")).toHaveText("1/5");
    await sheet.getByRole("button", { name: "บันทึกแก้ไข" }).click();
    await expect(sheet).toHaveCount(0);
    const updated = await detail(request, parcel.id);
    expect(updated.images).toHaveLength(1);
    expect(updated.images[0].id).not.toBe(JSON.parse(originalRow[11])[0]);
    const finalGoogle = await (await request.get(`${backendUrl}/__e2e__/google`)).json();
    expect(JSON.parse(finalGoogle.parcels.find((row) => row[2] === parcel.parcelCode)[11]))
      .toEqual([updated.images[0].id]);
    expect(forbidden).toEqual([]);
  } finally {
    await request.delete(`${backendUrl}/api/parcels/${parcel.id}`, { headers: owner }).catch(() => {});
  }
});

test("ambiguous saved upload blocks replay and never publishes or deletes the old photo", async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium");
  const created = await request.post(`${backendUrl}/api/parcels`, { headers: owner,
    data: { parcelName: `AMBIGUOUS-${randomUUID()}`, cropType: "rice", plantingDate: "2026-09-27",
      geometry: { type: "Polygon", coordinates: [[
        [99.889, 19.028], [99.890, 19.028], [99.890, 19.029], [99.889, 19.028],
      ]] } } });
  expect(created.status()).toBe(201);
  const parcel = (await created.json()).parcel;
  expect((await request.post(`${backendUrl}/api/parcels/${parcel.id}/images`, {
    headers: owner, multipart: { image, clientPhotoId: randomUUID() },
  })).status()).toBe(201);
  const before = await detail(request, parcel.id);
  const photoId = randomUUID();
  const started = await begin(request, before, [before.images[0].id], [photoId]);
  expect(started.status()).toBe(201);
  const operationId = (await started.json()).operation.id;
  expect((await request.post(`${backendUrl}/__e2e__/google/fail-next-ambiguous-upload`)).status()).toBe(200);
  const url = `${backendUrl}/api/parcels/${parcel.id}/photo-edits/${operationId}/images`;
  const failed = await request.post(url, { headers: owner, multipart: { image, clientPhotoId: photoId } });
  expect(failed.status()).toBe(503);
  expect((await failed.json()).ambiguous).toBe(true);
  expect((await request.post(url, { headers: owner, multipart: { image, clientPhotoId: photoId } })).status())
    .toBe(409);
  expect((await request.post(`${backendUrl}/api/parcels/${parcel.id}/photo-edits/${operationId}/finalize`,
    { headers: owner, data: {} })).status()).toBe(409);
  await db.query("UPDATE app.parcel_photo_operations SET expires_at = now() - interval '1 second' WHERE id = $1",
    [operationId]);
  await request.post(`${backendUrl}/__e2e__/cleanup/run`);
  const ambiguous = (await db.query(`SELECT status, active_photo_id, uploaded_images
    FROM app.parcel_photo_operations WHERE id = $1`, [operationId])).rows[0];
  expect(ambiguous.status).toBe("ambiguous");
  expect(ambiguous.uploaded_images).toEqual({});
  expect((await detail(request, parcel.id)).images.map((item) => item.id))
    .toEqual(before.images.map((item) => item.id));
  const jobs = (await db.query("SELECT id FROM app.cleanup_jobs WHERE parcel_id = $1", [parcel.id])).rows;
  expect(jobs).toHaveLength(0);
});

test("failed Sheet final-set keeps old image and retries without early cleanup", async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium");
  const created = await request.post(`${backendUrl}/api/parcels`, { headers: owner,
    data: { parcelName: `SHEET-FAIL-${randomUUID()}`, cropType: "rice", plantingDate: "2026-09-27",
      geometry: { type: "Polygon", coordinates: [[
        [99.889, 19.028], [99.890, 19.028], [99.890, 19.029], [99.889, 19.028],
      ]] } } });
  expect(created.status()).toBe(201);
  const parcel = (await created.json()).parcel;
  try {
    expect((await request.post(`${backendUrl}/api/parcels/${parcel.id}/images`, {
      headers: owner, multipart: { image, clientPhotoId: randomUUID() },
    })).status()).toBe(201);
    const before = await detail(request, parcel.id);
    const started = await begin(request, before, [before.images[0].id], []);
    expect(started.status()).toBe(201);
    const operationId = (await started.json()).operation.id;
    expect((await request.post(`${backendUrl}/__e2e__/google/fail-next-replacement`)).status()).toBe(200);
    const finalizeUrl = `${backendUrl}/api/parcels/${parcel.id}/photo-edits/${operationId}/finalize`;
    expect((await request.post(finalizeUrl, { headers: owner, data: {} })).status()).toBe(503);
    expect((await detail(request, parcel.id)).images.map((item) => item.id))
      .toEqual(before.images.map((item) => item.id));
    expect((await db.query("SELECT id FROM app.cleanup_jobs WHERE source_operation_id = $1", [operationId])).rows)
      .toHaveLength(0);
    await db.query("UPDATE app.parcel_photo_operations SET lease_until = now() - interval '1 second' WHERE id = $1",
      [operationId]);
    expect((await request.post(finalizeUrl, { headers: owner, data: {} })).status()).toBe(200);
    expect((await detail(request, parcel.id)).images).toHaveLength(0);
    expect((await db.query("SELECT id FROM app.cleanup_jobs WHERE source_operation_id = $1", [operationId])).rows)
      .toHaveLength(1);
  } finally {
    await request.delete(`${backendUrl}/api/parcels/${parcel.id}`, { headers: owner }).catch(() => {});
  }
});

test("replacement at five images validates final count before external writes", async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium");
  const created = await request.post(`${backendUrl}/api/parcels`, { headers: owner,
    data: { parcelName: `CAPACITY-${randomUUID()}`, cropType: "rice", plantingDate: "2026-09-27",
      geometry: { type: "Polygon", coordinates: [[
        [99.889, 19.028], [99.890, 19.028], [99.890, 19.029], [99.889, 19.028],
      ]] } } });
  expect(created.status()).toBe(201);
  const parcel = (await created.json()).parcel;
  try {
    for (let index = 0; index < 5; index += 1) {
      expect((await request.post(`${backendUrl}/api/parcels/${parcel.id}/images`, {
        headers: owner, multipart: { image, clientPhotoId: randomUUID() },
      })).status()).toBe(201);
    }
    const before = await detail(request, parcel.id);
    const newIds = [randomUUID(), randomUUID()];
    expect((await begin(request, before, [before.images[0].id], newIds)).status()).toBe(400);
    expect((await db.query("SELECT id FROM app.parcel_photo_operations WHERE parcel_id = $1", [parcel.id])).rows)
      .toHaveLength(0);
    const started = await begin(request, before, before.images.slice(0, 2).map((item) => item.id), newIds);
    expect(started.status()).toBe(201);
    const operationId = (await started.json()).operation.id;
    const uploadUrl = `${backendUrl}/api/parcels/${parcel.id}/photo-edits/${operationId}/images`;
    for (const clientPhotoId of newIds) {
      expect((await request.post(uploadUrl, { headers: owner,
        multipart: { image, clientPhotoId } })).status()).toBe(201);
    }
    expect((await detail(request, parcel.id)).images).toHaveLength(5);
    expect((await request.post(`${backendUrl}/api/parcels/${parcel.id}/photo-edits/${operationId}/finalize`,
      { headers: owner, data: {} })).status()).toBe(200);
    const after = await detail(request, parcel.id);
    expect(after.images).toHaveLength(5);
    expect(after.images.map((item) => item.id).slice(0, 3))
      .toEqual(before.images.slice(2).map((item) => item.id));
  } finally {
    await request.delete(`${backendUrl}/api/parcels/${parcel.id}`, { headers: owner }).catch(() => {});
  }
});

test("expired unfinalized edit cleans confirmed orphan without changing Sheet", async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium");
  const created = await request.post(`${backendUrl}/api/parcels`, { headers: owner,
    data: { parcelName: `EXPIRE-${randomUUID()}`, cropType: "rice", plantingDate: "2026-09-27",
      geometry: { type: "Polygon", coordinates: [[
        [99.889, 19.028], [99.890, 19.028], [99.890, 19.029], [99.889, 19.028],
      ]] } } });
  expect(created.status()).toBe(201);
  const parcel = (await created.json()).parcel;
  try {
    const before = await detail(request, parcel.id);
    const photoId = randomUUID();
    const started = await begin(request, before, [], [photoId]);
    expect(started.status()).toBe(201);
    const operationId = (await started.json()).operation.id;
    expect((await request.post(`${backendUrl}/api/parcels/${parcel.id}/photo-edits/${operationId}/images`, {
      headers: owner, multipart: { image, clientPhotoId: photoId },
    })).status()).toBe(201);
    await request.post(`${backendUrl}/__e2e__/cleanup/run`);
    expect((await db.query("SELECT status FROM app.parcel_photo_operations WHERE id = $1",
      [operationId])).rows[0].status).toBe("ready");
    expect((await db.query("SELECT id FROM app.cleanup_jobs WHERE source_operation_id = $1",
      [operationId])).rows).toHaveLength(0);
    await db.query("UPDATE app.parcel_photo_operations SET expires_at = now() - interval '1 second' WHERE id = $1",
      [operationId]);
    await expect.poll(async () => {
      await request.post(`${backendUrl}/__e2e__/cleanup/run`);
      return (await db.query("SELECT status FROM app.parcel_photo_operations WHERE id = $1",
        [operationId])).rows[0]?.status;
    }).toBe("expired");
    await expect.poll(async () => {
      await request.post(`${backendUrl}/__e2e__/cleanup/run`);
      return (await db.query("SELECT status FROM app.cleanup_jobs WHERE source_operation_id = $1",
        [operationId])).rows[0]?.status;
    }).toBe("completed");
    expect((await detail(request, parcel.id)).images).toHaveLength(0);
    const google = await (await request.get(`${backendUrl}/__e2e__/google`)).json();
    expect(google.files.some((file) => file.fileName.includes(photoId))).toBe(false);
  } finally {
    await request.delete(`${backendUrl}/api/parcels/${parcel.id}`, { headers: owner }).catch(() => {});
  }
});

test("worker reconciles Sheet write that succeeded before its response was lost", async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium");
  const created = await request.post(`${backendUrl}/api/parcels`, { headers: owner,
    data: { parcelName: `RECONCILE-${randomUUID()}`, cropType: "rice", plantingDate: "2026-09-27",
      geometry: { type: "Polygon", coordinates: [[
        [99.889, 19.028], [99.890, 19.028], [99.890, 19.029], [99.889, 19.028],
      ]] } } });
  expect(created.status()).toBe(201);
  const parcel = (await created.json()).parcel;
  try {
    expect((await request.post(`${backendUrl}/api/parcels/${parcel.id}/images`, {
      headers: owner, multipart: { image, clientPhotoId: randomUUID() },
    })).status()).toBe(201);
    const before = await detail(request, parcel.id);
    const started = await begin(request, before, [before.images[0].id], []);
    expect(started.status()).toBe(201);
    const operationId = (await started.json()).operation.id;
    expect((await request.post(`${backendUrl}/__e2e__/google/fail-after-replacement`)).status()).toBe(200);
    const finalizeUrl = `${backendUrl}/api/parcels/${parcel.id}/photo-edits/${operationId}/finalize`;
    expect((await request.post(finalizeUrl, { headers: owner, data: {} })).status()).toBe(503);
    expect((await detail(request, parcel.id)).images).toHaveLength(0);
    expect((await db.query("SELECT id FROM app.cleanup_jobs WHERE source_operation_id = $1", [operationId])).rows)
      .toHaveLength(0);
    await db.query(`UPDATE app.parcel_photo_operations
      SET expires_at = now() - interval '1 second', lease_until = now() - interval '1 second'
      WHERE id = $1`, [operationId]);
    await expect.poll(async () => {
      await request.post(`${backendUrl}/__e2e__/cleanup/run`);
      return (await db.query("SELECT status FROM app.parcel_photo_operations WHERE id = $1",
        [operationId])).rows[0]?.status;
    }).toBe("completed");
    expect((await db.query("SELECT job_type, sheet_deleted FROM app.cleanup_jobs WHERE source_operation_id = $1",
      [operationId])).rows[0]).toMatchObject({ job_type: "photo_deletion", sheet_deleted: true });
  } finally {
    await request.delete(`${backendUrl}/api/parcels/${parcel.id}`, { headers: owner }).catch(() => {});
  }
});

test("mobile edit retains selected photo after a safe upload failure and resumes", async ({ page, context, request }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium");
  await prepareContext(context, { token: "e2e-line-token-user-a" });
  const created = await request.post(`${backendUrl}/api/parcels`, { headers: owner,
    data: { parcelName: `RETRY-UI-${randomUUID()}`, cropType: "rice", plantingDate: "2026-09-27",
      geometry: { type: "Polygon", coordinates: [[
        [99.889, 19.028], [99.890, 19.028], [99.890, 19.029], [99.889, 19.028],
      ]] } } });
  expect(created.status()).toBe(201);
  const parcel = (await created.json()).parcel;
  try {
    await openMap(page, true);
    await page.locator("#saved-parcels-control-button").click();
    const card = page.locator(`.saved-parcel-card[data-parcel-id="${parcel.id}"]`);
    await card.locator(".saved-parcel-header").click();
    await card.getByRole("button", { name: "แก้ไขข้อมูล" }).click();
    const sheet = page.locator("#parcel-edit-sheet");
    await expect(sheet.locator(".saved-photo-edit-count")).toHaveText("0/5");
    await sheet.locator(".saved-photo-edit input[type=file]").setInputFiles(image);
    const uploadPattern = "**/api/parcels/*/photo-edits/*/images";
    let attempts = 0;
    await page.route(uploadPattern, async (route) => {
      attempts += 1;
      await new Promise((resolve) => setTimeout(resolve, 350));
      return route.fulfill({ status: 503, contentType: "application/json",
        body: JSON.stringify({ error: "Temporary", retryable: false }) });
    });
    await sheet.getByRole("button", { name: "บันทึกแก้ไข" }).click();
    await expect(sheet.getByRole("button", { name: "ยกเลิก" })).toBeDisabled();
    await expect(sheet.getByRole("button", { name: "ปิด" })).toBeDisabled();
    await expect(sheet.locator(".saved-photo-edit-message")).toContainText("บันทึกไม่สำเร็จ");
    await expect(sheet.locator(".saved-photo-edit-count")).toHaveText("1/5");
    await expect(sheet.locator(".saved-photo-edit-item")).toContainText("ใหม่");
    expect(attempts).toBe(1);
    await page.unroute(uploadPattern);
    await sheet.getByRole("button", { name: "บันทึกแก้ไข" }).click();
    await expect(sheet).toHaveCount(0);
    expect((await detail(request, parcel.id)).images).toHaveLength(1);
    expect((await db.query("SELECT COUNT(*)::int AS count FROM app.parcel_photo_operations WHERE parcel_id = $1",
      [parcel.id])).rows[0].count).toBe(1);
  } finally {
    await request.delete(`${backendUrl}/api/parcels/${parcel.id}`, { headers: owner }).catch(() => {});
  }
});

test("simultaneous begins use the DB unique active-operation index", async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium");
  const parcel = await createParcel(request, "BEGIN-RACE");
  const before = await detail(request, parcel.id);
  const results = await Promise.all([
    begin(request, before, [], [randomUUID()]),
    begin(request, before, [], [randomUUID()]),
  ]);
  expect(results.map((result) => result.status()).sort()).toEqual([201, 409]);
  const rows = (await db.query(`SELECT id FROM app.parcel_photo_operations
    WHERE parcel_id = $1 AND status NOT IN ('completed', 'expired')`, [parcel.id])).rows;
  expect(rows).toHaveLength(1);
});

test("overlapping begin and whole-parcel delete cannot resurrect the Sheet row", async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium");
  const parcel = await createParcel(request, "DELETE-RACE");
  const before = await detail(request, parcel.id);
  const [started, deleted] = await Promise.all([
    begin(request, before, [], [randomUUID()]),
    request.delete(`${backendUrl}/api/parcels/${parcel.id}`, { headers: owner }),
  ]);
  expect([[201, 409], [404, 200]]).toContainEqual([started.status(), deleted.status()]);
  let operationId;
  if (started.status() === 201) {
    operationId = (await started.json()).operation.id;
    const photoId = (await db.query("SELECT new_photo_ids FROM app.parcel_photo_operations WHERE id = $1",
      [operationId])).rows[0].new_photo_ids[0];
    expect((await request.post(`${backendUrl}/api/parcels/${parcel.id}/photo-edits/${operationId}/images`,
      { headers: owner, multipart: { image, clientPhotoId: photoId } })).status()).toBe(201);
    expect((await request.delete(`${backendUrl}/api/parcels/${parcel.id}`, { headers: owner })).status()).toBe(409);
    await db.query("UPDATE app.parcel_photo_operations SET expires_at = now() - interval '1 second' WHERE id = $1",
      [operationId]);
    await expect.poll(async () => {
      await request.post(`${backendUrl}/__e2e__/cleanup/run`);
      return (await db.query("SELECT status FROM app.cleanup_jobs WHERE source_operation_id = $1",
        [operationId])).rows[0]?.status;
    }).toBe("completed");
    expect((await request.delete(`${backendUrl}/api/parcels/${parcel.id}`, { headers: owner })).status()).toBe(200);
  }
  if (operationId) {
    expect((await request.post(`${backendUrl}/api/parcels/${parcel.id}/photo-edits/${operationId}/finalize`,
      { headers: owner, data: {} })).status()).toBe(409);
  }
  const snapshot = await (await request.get(`${backendUrl}/__e2e__/google`)).json();
  // Whole-parcel Sheet cleanup is asynchronous; a photo edit must not recreate the row after DELETE.
  await expect.poll(async () => {
    await request.post(`${backendUrl}/__e2e__/cleanup/run`);
    const current = await (await request.get(`${backendUrl}/__e2e__/google`)).json();
    return current.parcels.some((row) => row[2] === parcel.parcelCode);
  }).toBe(false);
  expect(snapshot.files.filter((file) => file.fileName.startsWith(parcel.parcelCode)).length).toBe(0);
});

test("Sheet response loss is recognized and Save retry does not replay photos or jobs", async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium");
  const parcel = await createParcel(request, "LOST-RESPONSE");
  expect((await request.post(`${backendUrl}/api/parcels/${parcel.id}/images`,
    { headers: owner, multipart: { image, clientPhotoId: randomUUID() } })).status()).toBe(201);
  const before = await detail(request, parcel.id);
  const photoId = randomUUID();
  const started = await begin(request, before, [before.images[0].id], [photoId], { note: "recovered" });
  expect(started.status()).toBe(201);
  const operationId = (await started.json()).operation.id;
  const imageUrl = `${backendUrl}/api/parcels/${parcel.id}/photo-edits/${operationId}/images`;
  expect((await request.post(imageUrl, { headers: owner, multipart: { image, clientPhotoId: photoId } })).status())
    .toBe(201);
  const filesBefore = (await (await request.get(`${backendUrl}/__e2e__/google`)).json()).files.length;
  await request.post(`${backendUrl}/__e2e__/google/fail-after-replacement`);
  const finalizeUrl = `${backendUrl}/api/parcels/${parcel.id}/photo-edits/${operationId}/finalize`;
  const failed = await request.post(finalizeUrl, { headers: owner, data: {} });
  expect(failed.status()).toBe(503);
  expect((await failed.json()).outcome).toBe("PHOTO_SET_COMMITTED_METADATA_PENDING");
  expect((await detail(request, parcel.id)).images.map((item) => item.id))
    .toEqual([`${parcel.parcelCode}_${photoId}.webp`]);
  const resumed = await request.post(finalizeUrl, { headers: owner, data: {} });
  expect(resumed.status()).toBe(200);
  expect((await resumed.json()).operation.status).toBe("completed");
  expect((await detail(request, parcel.id)).note).toBe("recovered");
  const after = await (await request.get(`${backendUrl}/__e2e__/google`)).json();
  expect(after.files).toHaveLength(filesBefore);
  expect((await db.query("SELECT id FROM app.cleanup_jobs WHERE source_operation_id = $1",
    [operationId])).rows).toHaveLength(1);
});

test("metadata mirror failure after Sheet commit reports partial success and resumes", async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium");
  const parcel = await createParcel(request, "META-RETRY");
  const before = await detail(request, parcel.id);
  const photoId = randomUUID();
  const started = await begin(request, before, [], [photoId], { note: "metadata resumed" });
  expect(started.status()).toBe(201);
  const operationId = (await started.json()).operation.id;
  expect((await request.post(`${backendUrl}/api/parcels/${parcel.id}/photo-edits/${operationId}/images`,
    { headers: owner, multipart: { image, clientPhotoId: photoId } })).status()).toBe(201);
  await request.post(`${backendUrl}/__e2e__/google/fail-next-parcel-upsert`);
  const finalizeUrl = `${backendUrl}/api/parcels/${parcel.id}/photo-edits/${operationId}/finalize`;
  const failed = await request.post(finalizeUrl, { headers: owner, data: {} });
  expect(failed.status()).toBe(503);
  expect((await failed.json()).outcome).toBe("PHOTO_SET_COMMITTED_METADATA_PENDING");
  expect((await detail(request, parcel.id)).images).toHaveLength(1);
  expect((await db.query("SELECT status FROM app.parcel_photo_operations WHERE id = $1", [operationId])).rows[0].status)
    .toBe("sheet_committed");
  const beforeRetry = await (await request.get(`${backendUrl}/__e2e__/google`)).json();
  expect((await request.post(finalizeUrl, { headers: owner, data: {} })).status()).toBe(200);
  expect((await detail(request, parcel.id)).note).toBe("metadata resumed");
  const afterRetry = await (await request.get(`${backendUrl}/__e2e__/google`)).json();
  expect(afterRetry.files).toEqual(beforeRetry.files);
  expect((await db.query("SELECT id FROM app.cleanup_jobs WHERE source_operation_id = $1",
    [operationId])).rows).toHaveLength(0);
});

test("competing finalizers create exactly one detached-photo job", async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium");
  const parcel = await createParcel(request, "FINAL-RACE");
  expect((await request.post(`${backendUrl}/api/parcels/${parcel.id}/images`,
    { headers: owner, multipart: { image, clientPhotoId: randomUUID() } })).status()).toBe(201);
  const before = await detail(request, parcel.id);
  const started = await begin(request, before, [before.images[0].id], []);
  expect(started.status()).toBe(201);
  const operationId = (await started.json()).operation.id;
  const url = `${backendUrl}/api/parcels/${parcel.id}/photo-edits/${operationId}/finalize`;
  const results = await Promise.all([
    request.post(url, { headers: owner, data: {} }),
    request.post(url, { headers: owner, data: {} }),
  ]);
  expect(results.map((result) => result.status())).toContain(200);
  expect(results.every((result) => [200, 409, 503].includes(result.status()))).toBe(true);
  for (const result of results) {
    if (result.status() === 503) {
      expect((await result.json()).outcome).toBe("PHOTO_SET_COMMITTED_METADATA_PENDING");
    }
  }
  expect((await request.post(url, { headers: owner, data: {} })).status()).toBe(200);
  expect((await db.query("SELECT id FROM app.cleanup_jobs WHERE source_operation_id = $1",
    [operationId])).rows).toHaveLength(1);
  expect((await db.query("SELECT status FROM app.parcel_photo_operations WHERE id = $1",
    [operationId])).rows[0].status).toBe("completed");
});

test("empty photo change cannot save metadata through expiry", async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium");
  const parcel = await createParcel(request, "EMPTY-EXPIRY");
  const before = await detail(request, parcel.id);
  expect((await begin(request, before, [], [], { note: "must not save" })).status()).toBe(400);
  const inserted = await db.query(`INSERT INTO app.parcel_photo_operations
    (parcel_id, owner_user_id, kind, status, parcel_code, metadata, expires_at)
    SELECT id, owner_user_id, 'saved_edit', 'ready', parcel_code,
      '{"note":"must not save"}'::jsonb, now() - interval '1 second'
    FROM app.parcels WHERE id = $1 RETURNING id`, [parcel.id]);
  const operationId = inserted.rows[0].id;
  await expect.poll(async () => {
    await request.post(`${backendUrl}/__e2e__/cleanup/run`);
    return (await db.query("SELECT status FROM app.parcel_photo_operations WHERE id = $1",
      [operationId])).rows[0]?.status;
  }).toBe("expired");
  expect((await detail(request, parcel.id)).note).not.toBe("must not save");
});

test("mobile Save tells the truth after photo commit and resumes metadata without re-upload", async ({ page, context, request }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium");
  await prepareContext(context, { token: "e2e-line-token-user-a" });
  const parcel = await createParcel(request, "PARTIAL-UI");
  await openMap(page, true);
  await page.locator("#saved-parcels-control-button").click();
  const card = page.locator(`.saved-parcel-card[data-parcel-id="${parcel.id}"]`);
  await card.locator(".saved-parcel-header").click();
  await card.getByRole("button", { name: "แก้ไขข้อมูล" }).click();
  const sheet = page.locator("#parcel-edit-sheet");
  await sheet.locator(".saved-photo-edit input[type=file]").setInputFiles(image);
  await request.post(`${backendUrl}/__e2e__/google/fail-next-parcel-upsert`);
  await sheet.getByRole("button", { name: "บันทึกแก้ไข" }).click();
  await expect(sheet.locator(".saved-photo-edit-message")).toContainText("รูปภาพได้รับการบันทึกแล้ว");
  await expect(sheet.locator(".parcel-sheet-status")).toContainText("รูปภาพได้รับการบันทึกแล้ว");
  await expect(sheet.getByRole("button", { name: "ยกเลิก" })).toBeDisabled();
  expect((await detail(request, parcel.id)).images).toHaveLength(1);
  const filesBefore = (await (await request.get(`${backendUrl}/__e2e__/google`)).json()).files.length;
  await sheet.getByRole("button", { name: "บันทึกแก้ไข" }).click();
  await expect(sheet).toHaveCount(0);
  const filesAfter = (await (await request.get(`${backendUrl}/__e2e__/google`)).json()).files.length;
  expect(filesAfter).toBe(filesBefore);
  expect((await detail(request, parcel.id)).images).toHaveLength(1);
});

test("orphan sweep never deletes a file still referenced by the trusted Sheet", async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium");
  const parcel = await createParcel(request, "ORPHAN-GUARD");
  expect((await request.post(`${backendUrl}/api/parcels/${parcel.id}/images`,
    { headers: owner, multipart: { image, clientPhotoId: randomUUID() } })).status()).toBe(201);
  const before = await detail(request, parcel.id);
  const google = await (await request.get(`${backendUrl}/__e2e__/google`)).json();
  const trusted = google.files.find((file) => file.fileName === before.images[0].id);
  const photoId = randomUUID();
  const inserted = await db.query(`INSERT INTO app.parcel_photo_operations
    (parcel_id, owner_user_id, kind, status, parcel_code, expected_images,
      new_photo_ids, uploaded_images, expires_at)
    SELECT id, owner_user_id, 'saved_edit', 'ready', parcel_code, $2::jsonb,
      $3::uuid[], $4::jsonb, now() - interval '1 second'
    FROM app.parcels WHERE id = $1 RETURNING id`, [parcel.id,
    JSON.stringify([{ fileName: trusted.fileName, fileId: trusted.id }]), [photoId],
    JSON.stringify({ [photoId]: { fileName: `${parcel.parcelCode}_${photoId}.webp`, fileId: trusted.id } })]);
  const operationId = inserted.rows[0].id;
  await expect.poll(async () => {
    await request.post(`${backendUrl}/__e2e__/cleanup/run`);
    return (await db.query("SELECT status FROM app.parcel_photo_operations WHERE id = $1",
      [operationId])).rows[0]?.status;
  }).toBe("ambiguous");
  expect((await db.query("SELECT id FROM app.cleanup_jobs WHERE source_operation_id = $1",
    [operationId])).rows).toHaveLength(0);
  const after = await (await request.get(`${backendUrl}/__e2e__/google`)).json();
  expect(after.files.some((file) => file.id === trusted.id)).toBe(true);
});
