const path = require("node:path");
const { readFileSync } = require("node:fs");
const { randomUUID } = require("node:crypto");
const { test, expect } = require("@playwright/test");
const db = require("../backend/src/config/database");
const parcelService = require("../backend/src/services/parcelService");
const { backendUrl } = require("./support");

const ownerHeaders = { Authorization: "Bearer e2e-line-token-user-a" };
const otherHeaders = { Authorization: "Bearer e2e-line-token-user-b" };
const image = { name: "field.png", mimeType: "image/png",
  buffer: readFileSync(path.resolve(__dirname, "../geoserver/data_dir/styles/grass_fill.png")) };

function payload(name) {
  return { parcelName: name, cropType: "rice", riceVariety: "KDML105",
    plantingDate: "2026-09-25", note: "Initial note",
    geometry: { type: "Polygon", coordinates: [[
      [99.889, 19.028], [99.890, 19.028], [99.890, 19.029], [99.889, 19.028],
    ]] } };
}

async function runCleanupForParcel(request, parcelId) {
  await expect.poll(async () => {
    await request.post(`${backendUrl}/__e2e__/cleanup/run`);
    return (await db.query("SELECT status FROM app.cleanup_jobs WHERE parcel_id = $1", [parcelId])).rows[0]?.status;
  }).toBe("completed");
}

test.beforeAll(() => {
  if (process.env.DB_HOST !== "127.0.0.1" || process.env.DB_PORT !== "55432" ||
    process.env.DB_NAME !== "mapphayao_e2e") throw new Error("Refusing non-local CRUD database");
});

test("disposable PostGIS schema and authenticated parcel CRUD retain metadata and atomic cleanup", async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium");
  const columns = (await db.query(`SELECT table_name, column_name, data_type, is_nullable
    FROM information_schema.columns WHERE table_schema = 'app' AND
      ((table_name = 'parcels' AND column_name = 'note') OR table_name = 'cleanup_jobs')`)).rows;
  expect(columns.find((row) => row.table_name === "parcels" && row.column_name === "note"))
    .toMatchObject({ data_type: "text", is_nullable: "YES" });
  for (const field of ["id", "parcel_id", "remaining_file_ids", "status", "attempts",
    "next_attempt_at", "locked_at", "locked_by", "completed_at"]) {
    expect(columns.some((row) => row.table_name === "cleanup_jobs" && row.column_name === field)).toBe(true);
  }
  const indexes = (await db.query(`SELECT indexname FROM pg_indexes WHERE schemaname = 'app'
    AND tablename = 'cleanup_jobs'`)).rows.map((row) => row.indexname);
  expect(indexes).toEqual(expect.arrayContaining(["cleanup_jobs_pkey", "cleanup_jobs_due_idx", "cleanup_jobs_lease_idx"]));

  const created = await request.post(`${backendUrl}/api/parcels`, { headers: ownerHeaders,
    data: payload(`CRUD-${randomUUID()}`) });
  expect(created.status()).toBe(201);
  const parcel = (await created.json()).parcel;
  try {
    const row = (await db.query(`SELECT owner_user_id, parcel_code, parcel_name, crop_type,
      rice_variety, planting_date::text, note, ST_SRID(geom) AS srid,
      ST_IsEmpty(geom) AS empty, created_at, updated_at FROM app.parcels WHERE id = $1`,
    [parcel.id])).rows[0];
    expect(row).toMatchObject({ parcel_code: parcel.parcelCode, parcel_name: parcel.parcelName,
      crop_type: "rice", rice_variety: "KDML105", planting_date: "2026-09-25",
      note: "Initial note", srid: 32647, empty: false });
    expect(row.owner_user_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(row.created_at).toBeInstanceOf(Date);
    expect(row.updated_at).toBeInstanceOf(Date);
    const read = await request.get(`${backendUrl}/api/parcels/${parcel.id}`, { headers: ownerHeaders });
    expect((await read.json()).parcel).toMatchObject({ note: "Initial note", plantingDate: "2026-09-25" });
    expect((await request.get(`${backendUrl}/api/parcels/${parcel.id}`, { headers: otherHeaders })).status()).toBe(404);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const changed = await request.patch(`${backendUrl}/api/parcels/${parcel.id}`, { headers: ownerHeaders,
      data: { parcelName: "Updated", cropType: "maize", riceVariety: "Hybrid",
        plantingDate: "2026-09-26", note: "Changed" } });
    expect(changed.status()).toBe(200);
    const updated = (await db.query(`SELECT parcel_name, crop_type, rice_variety,
      planting_date::text, note, updated_at FROM app.parcels WHERE id = $1`, [parcel.id])).rows[0];
    expect(updated).toMatchObject({ parcel_name: "Updated", crop_type: "maize",
      rice_variety: "Hybrid", planting_date: "2026-09-26", note: "Changed" });
    expect(updated.updated_at.getTime()).toBeGreaterThan(row.updated_at.getTime());
    expect((await request.patch(`${backendUrl}/api/parcels/${parcel.id}`, { headers: ownerHeaders,
      data: { note: "Only note" } })).status()).toBe(200);
    expect((await db.query(`SELECT parcel_name, crop_type, rice_variety, planting_date::text, note
      FROM app.parcels WHERE id = $1`, [parcel.id])).rows[0]).toMatchObject({
      parcel_name: "Updated", crop_type: "maize", rice_variety: "Hybrid",
      planting_date: "2026-09-26", note: "Only note" });
    expect((await request.patch(`${backendUrl}/api/parcels/${parcel.id}`, { headers: ownerHeaders,
      data: { note: "   " } })).status()).toBe(200);
    expect((await db.query("SELECT note FROM app.parcels WHERE id = $1", [parcel.id])).rows[0].note).toBeNull();

    const uploaded = await request.post(`${backendUrl}/api/parcels/${parcel.id}/images`, {
      headers: ownerHeaders, multipart: { image, clientPhotoId: randomUUID() },
    });
    expect(uploaded.status()).toBe(201);
    const imageRecord = (await uploaded.json()).image;
    expect((await request.delete(`${backendUrl}/api/parcels/${parcel.id}`, { headers: ownerHeaders })).status()).toBe(200);
    expect((await db.query("SELECT id FROM app.parcels WHERE id = $1", [parcel.id])).rows).toHaveLength(0);
    const job = (await db.query(`SELECT status, remaining_file_ids, sheet_deleted FROM app.cleanup_jobs
      WHERE parcel_id = $1`, [parcel.id])).rows[0];
    expect(job).toMatchObject({ status: "pending", sheet_deleted: false });
    expect(job.remaining_file_ids).toHaveLength(1);
    const snapshot = (await (await request.get(`${backendUrl}/__e2e__/google`)).json());
    expect(snapshot.files.some((file) => file.fileName === imageRecord.id)).toBe(true);
    await runCleanupForParcel(request, parcel.id);
    expect((await db.query("SELECT status FROM app.cleanup_jobs WHERE parcel_id = $1", [parcel.id])).rows[0].status)
      .toBe("completed");
  } finally {
    await request.delete(`${backendUrl}/api/parcels/${parcel.id}`, { headers: ownerHeaders }).catch(() => {});
  }
});

test("upload and delete serialize on the same disposable PostGIS parcel lock", async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium");
  const created = await request.post(`${backendUrl}/api/parcels`, { headers: ownerHeaders,
    data: payload(`RACE-${randomUUID()}`) });
  expect(created.status()).toBe(201);
  const parcel = (await created.json()).parcel;
  let upload;
  let deletion;
  try {
    await parcelService.withParcelMutationLock(parcel.id, async () => {
      upload = request.post(`${backendUrl}/api/parcels/${parcel.id}/images`, {
        headers: ownerHeaders, multipart: { image, clientPhotoId: randomUUID() },
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
      deletion = request.delete(`${backendUrl}/api/parcels/${parcel.id}`, { headers: ownerHeaders });
      const early = await Promise.race([
        Promise.all([upload, deletion]).then(() => "completed"),
        new Promise((resolve) => setTimeout(() => resolve("blocked"), 200)),
      ]);
      expect(early).toBe("blocked");
    });
    const uploadResponse = await upload;
    const deleteResponse = await deletion;
    expect(deleteResponse.status()).toBe(200);
    expect([201, 404]).toContain(uploadResponse.status());
    const job = (await db.query("SELECT remaining_file_ids FROM app.cleanup_jobs WHERE parcel_id = $1",
      [parcel.id])).rows[0];
    if (uploadResponse.status() === 201) expect(job.remaining_file_ids).toHaveLength(1);
    else expect(job.remaining_file_ids).toHaveLength(0);
    await runCleanupForParcel(request, parcel.id);
    const snapshot = await (await request.get(`${backendUrl}/__e2e__/google`)).json();
    expect(snapshot.parcels.some((row) => row[2] === parcel.parcelCode)).toBe(false);
    expect(snapshot.files.some((file) => file.fileName.startsWith(`${parcel.parcelCode}_`))).toBe(false);
  } finally {
    await request.delete(`${backendUrl}/api/parcels/${parcel.id}`, { headers: ownerHeaders }).catch(() => {});
  }
});

test("metadata mirror cannot recreate a Sheet row after concurrent parcel deletion", async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium");
  const created = await request.post(`${backendUrl}/api/parcels`, { headers: ownerHeaders,
    data: payload(`MIRROR-RACE-${randomUUID()}`) });
  expect(created.status()).toBe(201);
  const parcel = (await created.json()).parcel;
  let update;
  let deletion;
  try {
    await parcelService.withParcelMutationLock(parcel.id, async () => {
      update = request.patch(`${backendUrl}/api/parcels/${parcel.id}`, { headers: ownerHeaders,
        data: { note: "Concurrent edit" } });
      await new Promise((resolve) => setTimeout(resolve, 100));
      deletion = request.delete(`${backendUrl}/api/parcels/${parcel.id}`, { headers: ownerHeaders });
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    expect([200, 404]).toContain((await update).status());
    expect((await deletion).status()).toBe(200);
    await runCleanupForParcel(request, parcel.id);
    const snapshot = await (await request.get(`${backendUrl}/__e2e__/google`)).json();
    expect(snapshot.parcels.some((row) => row[2] === parcel.parcelCode)).toBe(false);
  } finally {
    await request.delete(`${backendUrl}/api/parcels/${parcel.id}`, { headers: ownerHeaders }).catch(() => {});
  }
});

test("direct API upload rejects a sixth image and removes its unregistered Drive file", async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium");
  const created = await request.post(`${backendUrl}/api/parcels`, { headers: ownerHeaders,
    data: payload(`LIMIT-${randomUUID()}`) });
  expect(created.status()).toBe(201);
  const parcel = (await created.json()).parcel;
  try {
    for (let index = 0; index < 5; index += 1) {
      expect((await request.post(`${backendUrl}/api/parcels/${parcel.id}/images`, {
        headers: ownerHeaders, multipart: { image, clientPhotoId: randomUUID() },
      })).status()).toBe(201);
    }
    expect((await request.post(`${backendUrl}/api/parcels/${parcel.id}/images`, {
      headers: ownerHeaders, multipart: { image, clientPhotoId: randomUUID() },
    })).status()).toBe(400);
    const detail = await (await request.get(`${backendUrl}/api/parcels/${parcel.id}`, { headers: ownerHeaders })).json();
    expect(detail.parcel.images).toHaveLength(5);
    const snapshot = await (await request.get(`${backendUrl}/__e2e__/google`)).json();
    expect(snapshot.files.filter((file) => file.fileName.startsWith(`${parcel.parcelCode}_`))).toHaveLength(5);
  } finally {
    await request.delete(`${backendUrl}/api/parcels/${parcel.id}`, { headers: ownerHeaders }).catch(() => {});
    await runCleanupForParcel(request, parcel.id);
  }
});

test("cleanup queue insertion failure rolls back a real PostgreSQL parcel delete", async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium");
  const created = await request.post(`${backendUrl}/api/parcels`, { headers: ownerHeaders,
    data: payload(`ROLLBACK-${randomUUID()}`) });
  expect(created.status()).toBe(201);
  const parcel = (await created.json()).parcel;
  const constraint = `e2e_reject_${parcel.id.replaceAll("-", "")}`;
  await db.query(`ALTER TABLE app.cleanup_jobs ADD CONSTRAINT ${constraint}
    CHECK (parcel_id <> '${parcel.id}'::uuid) NOT VALID`);
  try {
    expect((await request.delete(`${backendUrl}/api/parcels/${parcel.id}`, { headers: ownerHeaders })).status()).toBe(500);
    expect((await db.query("SELECT id FROM app.parcels WHERE id = $1", [parcel.id])).rows).toHaveLength(1);
    expect((await db.query("SELECT id FROM app.cleanup_jobs WHERE parcel_id = $1", [parcel.id])).rows).toHaveLength(0);
  } finally {
    await db.query(`ALTER TABLE app.cleanup_jobs DROP CONSTRAINT ${constraint}`);
    await request.delete(`${backendUrl}/api/parcels/${parcel.id}`, { headers: ownerHeaders }).catch(() => {});
    await runCleanupForParcel(request, parcel.id);
  }
});
