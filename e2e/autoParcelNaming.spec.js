const { test, expect } = require("@playwright/test");
const path = require("node:path");
const db = require("../backend/src/config/database");
const parcelService = require("../backend/src/services/parcelService");
const { backendUrl, prepareContext, openMap, drawMobileParcel } = require("./support");

const ownerA = { Authorization: "Bearer e2e-line-token-user-a" };
const ownerB = { Authorization: "Bearer e2e-line-token-user-b" };
const geometry = { type: "Polygon", coordinates: [[
  [99.889, 19.028], [99.890, 19.028], [99.890, 19.029], [99.889, 19.028],
]] };

function payload(name) {
  return { parcelName: name, cropType: "rice", plantingDate: "2026-10-11", geometry };
}

async function create(request, headers, name) {
  const response = await request.post(`${backendUrl}/api/parcels`, { headers, data: payload(name) });
  expect(response.status()).toBe(201);
  return (await response.json()).parcel;
}

async function nextNumber(lineUserId) {
  const result = await db.query(`SELECT next_auto_parcel_name_number FROM app.users
    WHERE line_user_id = $1`, [lineUserId]);
  return BigInt(result.rows[0].next_auto_parcel_name_number);
}

async function queueOwnerNameWrites(first, second) {
  const holder = await db.pool.connect();
  const pending = [];
  try {
    await holder.query("BEGIN");
    await holder.query(`SELECT id FROM app.users WHERE line_user_id = $1 FOR UPDATE`, ["U_E2E_USER_A"]);
    const waitForBlocked = async (count) => {
      await expect.poll(async () => {
        const result = await db.query(`SELECT COUNT(*)::int AS blocked FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock'
            AND query LIKE '%FROM app.users%' AND query LIKE '%FOR UPDATE%'`);
        return result.rows[0].blocked;
      }, { timeout: 10000 }).toBeGreaterThanOrEqual(count);
    };
    pending.push(first());
    await waitForBlocked(1);
    pending.push(second());
    await waitForBlocked(2);
    await holder.query("COMMIT");
    return await Promise.all(pending);
  } catch (error) {
    await holder.query("ROLLBACK");
    await Promise.allSettled(pending);
    throw error;
  } finally {
    holder.release();
  }
}

test.beforeAll(() => {
  if (process.env.DB_HOST !== "127.0.0.1" || process.env.DB_PORT !== "55432" ||
    process.env.DB_NAME !== "mapphayao_e2e") throw new Error("Refusing non-local naming database");
});

test("owner-scoped names survive delete and rename, skip occupied names, and allocate concurrently", async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium");
  test.setTimeout(120000);
  const created = [];
  const save = async (headers, name) => {
    const parcel = await create(request, headers, name);
    created.push({ parcel, headers });
    return parcel;
  };
  try {
    const a1 = await save(ownerA, "  ");
    const a2 = await save(ownerA);
    const b1 = await save(ownerB);
    expect([a1.parcelName, a2.parcelName, b1.parcelName])
      .toEqual(["แปลงที่ 1", "แปลงที่ 2", "แปลงที่ 1"]);
    expect((await request.get(`${backendUrl}/api/parcels/${a1.id}`, { headers: ownerB })).status()).toBe(404);
    const named = await save(ownerA, " สวนหลังบ้าน ");
    expect(named.parcelName).toBe("สวนหลังบ้าน");
    expect((await request.delete(`${backendUrl}/api/parcels/${a2.id}`, { headers: ownerA })).status()).toBe(200);
    const a3 = await save(ownerA);
    expect(a3.parcelName).toBe("แปลงที่ 3");
    const renamed = await request.patch(`${backendUrl}/api/parcels/${a3.id}`,
      { headers: ownerA, data: { parcelName: "เปลี่ยนชื่อแล้ว" } });
    expect(renamed.status()).toBe(200);
    expect((await renamed.json()).parcel.parcelName).toBe("เปลี่ยนชื่อแล้ว");
    expect((await save(ownerA)).parcelName).toBe("แปลงที่ 4");
    expect((await save(ownerA, "แปลงที่ 5")).parcelName).toBe("แปลงที่ 5");
    expect((await save(ownerA)).parcelName).toBe("แปลงที่ 6");

    const [first, second] = await Promise.all([create(request, ownerA), create(request, ownerA)]);
    created.push({ parcel: first, headers: ownerA }, { parcel: second, headers: ownerA });
    expect(new Set([first.parcelName, second.parcelName])).toEqual(new Set(["แปลงที่ 7", "แปลงที่ 8"]));

    const user = (await db.query("SELECT id, next_auto_parcel_name_number FROM app.users WHERE line_user_id = $1",
      ["U_E2E_USER_A"])).rows[0];
    expect(user.next_auto_parcel_name_number).toBe("9");
    const tiny = { type: "Polygon", coordinates: [[
      [99.889, 19.028], [99.88900001, 19.028], [99.88900001, 19.02800001], [99.889, 19.028],
    ]] };
    await expect(parcelService.createParcel({ cropType: "rice", geometry: tiny },
      { lineUserId: "U_E2E_USER_A" })).rejects.toMatchObject({ statusCode: 400 });
    expect((await db.query("SELECT next_auto_parcel_name_number FROM app.users WHERE id = $1",
      [user.id])).rows[0].next_auto_parcel_name_number).toBe("9");
    expect((await save(ownerA)).parcelName).toBe("แปลงที่ 9");
    const sheet = await (await request.get(`${backendUrl}/__e2e__/google`)).json();
    expect(sheet.parcels.find((row) => row[2] === a1.parcelCode)[3]).toBe("แปลงที่ 1");
    expect((await request.get(`${backendUrl}/api/parcels`, { headers: ownerB })).ok()).toBe(true);
  } finally {
    for (const { parcel, headers } of created) {
      await request.delete(`${backendUrl}/api/parcels/${parcel.id}`, { headers }).catch(() => {});
    }
    await request.post(`${backendUrl}/__e2e__/cleanup/run`).catch(() => {});
  }
});

test("queued custom creates and renames cannot race an automatic name", async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium");
  test.setTimeout(120000);
  const created = [];
  const remember = (parcel) => { created.push(parcel); return parcel; };
  try {
    const base = remember(await create(request, ownerA, "RACE-RENAME-BASE"));

    let number = await nextNumber("U_E2E_USER_A");
    let name = `แปลงที่ ${number}`;
    const [customFirst, automaticSecond] = await queueOwnerNameWrites(
      () => request.post(`${backendUrl}/api/parcels`, { headers: ownerA, data: payload(name) }),
      () => request.post(`${backendUrl}/api/parcels`, { headers: ownerA, data: payload() }),
    );
    expect(customFirst.status()).toBe(201);
    expect(automaticSecond.status()).toBe(201);
    remember((await customFirst.json()).parcel);
    expect(remember((await automaticSecond.json()).parcel).parcelName).toBe(`แปลงที่ ${number + 1n}`);

    number = await nextNumber("U_E2E_USER_A");
    name = `แปลงที่ ${number}`;
    const [automaticFirst, customSecond] = await queueOwnerNameWrites(
      () => request.post(`${backendUrl}/api/parcels`, { headers: ownerA, data: payload() }),
      () => request.post(`${backendUrl}/api/parcels`, { headers: ownerA, data: payload(name) }),
    );
    expect(automaticFirst.status()).toBe(201);
    expect(customSecond.status()).toBe(409);
    expect(remember((await automaticFirst.json()).parcel).parcelName).toBe(name);

    number = await nextNumber("U_E2E_USER_A");
    name = `แปลงที่ ${number}`;
    const [renameFirst, automaticAfterRename] = await queueOwnerNameWrites(
      () => request.patch(`${backendUrl}/api/parcels/${base.id}`,
        { headers: ownerA, data: { parcelName: name } }),
      () => request.post(`${backendUrl}/api/parcels`, { headers: ownerA, data: payload() }),
    );
    expect(renameFirst.status()).toBe(200);
    expect(automaticAfterRename.status()).toBe(201);
    expect((await renameFirst.json()).parcel.parcelName).toBe(name);
    expect(remember((await automaticAfterRename.json()).parcel).parcelName).toBe(`แปลงที่ ${number + 1n}`);
    const baseName = name;

    number = await nextNumber("U_E2E_USER_A");
    name = `แปลงที่ ${number}`;
    const [automaticBeforeRename, renameSecond] = await queueOwnerNameWrites(
      () => request.post(`${backendUrl}/api/parcels`, { headers: ownerA, data: payload() }),
      () => request.patch(`${backendUrl}/api/parcels/${base.id}`,
        { headers: ownerA, data: { parcelName: name } }),
    );
    expect(automaticBeforeRename.status()).toBe(201);
    expect(renameSecond.status()).toBe(409);
    expect(remember((await automaticBeforeRename.json()).parcel).parcelName).toBe(name);
    const baseDetail = await request.get(`${backendUrl}/api/parcels/${base.id}`, { headers: ownerA });
    expect((await baseDetail.json()).parcel.parcelName).toBe(baseName);

    const start = await nextNumber("U_E2E_USER_A");
    const concurrent = await Promise.all(Array.from({ length: 4 }, () => create(request, ownerA)));
    concurrent.forEach(remember);
    expect(new Set(concurrent.map((parcel) => parcel.parcelName))).toEqual(new Set(
      Array.from({ length: 4 }, (_, index) => `แปลงที่ ${start + BigInt(index)}`)));
  } finally {
    for (const parcel of created) {
      await request.delete(`${backendUrl}/api/parcels/${parcel.id}`, { headers: ownerA }).catch(() => {});
    }
    await request.post(`${backendUrl}/__e2e__/cleanup/run`).catch(() => {});
  }
});

test("historical duplicate automatic-style names remain editable without a uniqueness migration", async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium");
  const ownerParcel = await create(request, ownerA, "HISTORICAL-OWNER");
  const inserted = [];
  try {
    const owner = await db.query("SELECT owner_user_id FROM app.parcels WHERE id = $1", [ownerParcel.id]);
    for (const code of ["E2E-HIST-NAME-A", "E2E-HIST-NAME-B"]) {
      const result = await db.query(`INSERT INTO app.parcels (parcel_code, parcel_name, owner_user_id, geom)
        VALUES ($1, 'แปลงที่ 9000', $2,
          ST_Multi(ST_Transform(ST_MakeEnvelope(99.88, 19.02, 99.881, 19.021, 4326), 32647)))
        RETURNING id`, [code, owner.rows[0].owner_user_id]);
      inserted.push(result.rows[0].id);
    }
    const updated = await parcelService.updateOwnedParcel(inserted[0],
      { parcelName: "แปลงที่ 9000", note: "แก้ไขข้อมูลเดิม" }, owner.rows[0].owner_user_id);
    expect(updated.parcelName).toBe("แปลงที่ 9000");
    expect(updated.note).toBe("แก้ไขข้อมูลเดิม");
    const count = await db.query(`SELECT COUNT(*)::int AS count FROM app.parcels
      WHERE owner_user_id = $1 AND parcel_name = 'แปลงที่ 9000'`, [owner.rows[0].owner_user_id]);
    expect(count.rows[0].count).toBe(2);
  } finally {
    if (inserted.length) await db.query("DELETE FROM app.parcels WHERE id = ANY($1::uuid[])", [inserted]);
    await request.delete(`${backendUrl}/api/parcels/${ownerParcel.id}`, { headers: ownerA }).catch(() => {});
    await request.post(`${backendUrl}/__e2e__/cleanup/run`).catch(() => {});
  }
});

test("new parcel input stays blank until the backend returns the saved name", async ({ page, context, request }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium");
  await prepareContext(context, { token: "e2e-line-token-user-a" });
  await openMap(page, true);
  await expect.poll(() => page.evaluate(() => window.MapLiffMode.isReady())).toBe(true);
  await drawMobileParcel(page);
  const modal = page.locator(".parcel-modal");
  await expect(modal.locator('input[name="parcelName"]')).toHaveValue("");
  await expect(modal).toContainText("ไม่ระบุชื่อ ระบบจะตั้งชื่อแปลงให้อัตโนมัติ");
  const created = page.waitForResponse((response) => response.url().endsWith("/api/parcels") &&
    response.request().method() === "POST");
  await modal.getByRole("button", { name: "บันทึกแปลง" }).click();
  const parcel = (await (await created).json()).parcel;
  expect(parcel.parcelName).toMatch(/^แปลงที่ [1-9]\d*$/);
  await expect(modal).toHaveCount(0);
  await expect(page.locator("#temporary-parcel-list .parcel-item")).toHaveCount(0);
  await expect(page.locator("#saved-parcels-control-button")).toBeVisible();
  expect((await request.delete(`${backendUrl}/api/parcels/${parcel.id}`, { headers: ownerA })).status()).toBe(200);
});

test("blank draft name survives cancel and details reopen", async ({ page, context }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium");
  await prepareContext(context, { token: "e2e-line-token-user-a" });
  await openMap(page, true);
  await expect.poll(() => page.evaluate(() => window.MapLiffMode.isReady())).toBe(true);
  await drawMobileParcel(page);
  const modal = page.locator(".parcel-modal");
  await expect(modal.locator('input[name="parcelName"]')).toHaveValue("");
  await modal.getByRole("button", { name: "ยกเลิก" }).click();
  await page.locator("#mobile-temporary-parcels-button").click();
  const draft = page.locator("#temporary-parcel-list .parcel-item").first();
  await expect(draft).toContainText("แปลงใหม่");
  await draft.locator(".parcel-item-toggle").click();
  await draft.getByRole("button", { name: "แก้ไขรายละเอียด" }).click();
  await expect(modal.locator('input[name="parcelName"]')).toHaveValue("");
  await modal.getByRole("button", { name: "บันทึกรายละเอียด" }).click();
  await expect(modal).toHaveCount(0);
  await expect(draft).toContainText("แปลงใหม่");
});

test("ambiguous photo upload keeps one auto-named parcel and consumes one number", async ({ page, context, request }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium");
  await prepareContext(context, { token: "e2e-line-token-user-a" });
  await openMap(page, true);
  await expect.poll(() => page.evaluate(() => window.MapLiffMode.isReady())).toBe(true);
  await drawMobileParcel(page);
  const modal = page.locator(".parcel-modal");
  await modal.locator('input[type="file"][multiple]').setInputFiles(
    path.resolve(__dirname, "../geoserver/data_dir/styles/grass_fill.png"));
  const before = (await db.query(`SELECT next_auto_parcel_name_number FROM app.users
    WHERE line_user_id = $1`, ["U_E2E_USER_A"])).rows[0].next_auto_parcel_name_number;
  expect((await request.post(`${backendUrl}/__e2e__/google/fail-next-ambiguous-upload`)).status()).toBe(200);
  let creates = 0;
  let uploads = 0;
  page.on("request", (item) => {
    if (item.url().endsWith("/api/parcels") && item.method() === "POST") creates += 1;
    if (/\/api\/parcels\/[^/]+\/images$/.test(item.url()) && item.method() === "POST") uploads += 1;
  });
  const created = page.waitForResponse((response) => response.url().endsWith("/api/parcels") &&
    response.request().method() === "POST");
  await modal.getByRole("button", { name: "บันทึกแปลง" }).click();
  const parcel = (await (await created).json()).parcel;
  try {
    await expect(modal).toHaveCount(0);
    await expect(page.locator("#temporary-parcel-list .parcel-item")).toHaveCount(0);
    await expect(page.locator("#my-parcels-sheet .is-warning")).toContainText("ไม่ทราบผล");
    await expect(page.locator("#my-parcels-sheet .saved-parcel-card")
      .filter({ hasText: parcel.parcelName })).toHaveCount(1);
    expect(creates).toBe(1);
    expect(uploads).toBe(1);
    const after = (await db.query(`SELECT next_auto_parcel_name_number FROM app.users
      WHERE line_user_id = $1`, ["U_E2E_USER_A"])).rows[0].next_auto_parcel_name_number;
    expect(BigInt(after)).toBe(BigInt(before) + 1n);
    expect((await db.query("SELECT COUNT(*)::int AS count FROM app.parcels WHERE id = $1",
      [parcel.id])).rows[0].count).toBe(1);
    const sheet = await (await request.get(`${backendUrl}/__e2e__/google`)).json();
    expect(sheet.parcels.find((row) => row[2] === parcel.parcelCode)[3]).toBe(parcel.parcelName);
  } finally {
    await request.delete(`${backendUrl}/api/parcels/${parcel.id}`, { headers: ownerA }).catch(() => {});
  }
});
