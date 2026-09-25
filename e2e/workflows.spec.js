const { test, expect, devices } = require("@playwright/test");
const db = require("../backend/src/config/database");
const {
  backendUrl,
  prepareContext,
  watchPageErrors,
  openMap,
  drawMobileParcel,
  expectVisualSnapshot,
} = require("./support");

const tokenA = "e2e-line-token-user-a";
const tokenB = "e2e-line-token-user-b";
const auth = (token) => ({ Authorization: `Bearer ${token}` });

test.beforeAll(() => {
  if (process.env.DB_HOST !== "127.0.0.1" || process.env.DB_NAME !== "mapphayao_e2e") {
    throw new Error("Refusing to run E2E against a non-local database");
  }
});

test("public point confirmation uses the local backend without LINE authentication", async ({ page, context, request }) => {
  const forbidden = await prepareContext(context);
  const errors = watchPageErrors(page);
  const health = await request.get(`${backendUrl}/api/health/database`);
  expect(health.ok()).toBe(true);
  await openMap(page);
  const map = page.locator("#map");
  const box = await map.boundingBox();
  await map.click({ position: { x: box.width / 2, y: box.height / 2 } });
  const confirm = page.locator("#mobile-point-confirm:visible, #confirm-location-button:visible").first();
  await expect(confirm).toBeEnabled();
  const result = page.waitForResponse((response) => response.url().includes("/api/location-report?"));
  await confirm.click();
  expect((await result).status()).toBe(200);
  await expect(page.locator("#result-panel")).toBeVisible();
  expect(forbidden).toEqual([]);
  expect(errors).toEqual([]);
});

test("two LIFF users persist separate parcels and cannot access one another", async ({ browser, request }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium");
  test.setTimeout(120000);
  const contextA = await browser.newContext({ ...devices["Pixel 7"] });
  const contextB = await browser.newContext({ ...devices["Pixel 7"] });
  const forbiddenA = await prepareContext(contextA, { token: tokenA });
  const forbiddenB = await prepareContext(contextB, { token: tokenB });
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  const errorsA = watchPageErrors(pageA);
  const errorsB = watchPageErrors(pageB);

  try {
    await openMap(pageA, true);
    await openMap(pageB, true);
    await expect.poll(() => pageA.evaluate(() => window.MapLiffMode.isReady())).toBe(true);
    await expect.poll(() => pageB.evaluate(() => window.MapLiffMode.isReady())).toBe(true);

    async function saveParcel(page, name) {
      await drawMobileParcel(page, name);
      await page.locator("#mobile-parcel-save-button").click();
      const sheet = page.locator("#parcel-save-sheet");
      await expect(sheet).toBeVisible();
      await expect(sheet.locator("input, select, textarea")).toHaveCount(0);
      const responsePromise = page.waitForResponse((response) => response.url().endsWith("/api/parcels") && response.request().method() === "POST");
      await sheet.getByRole("button", { name: "บันทึกแปลง" }).click();
      const response = await responsePromise;
      expect(response.status()).toBe(201);
      return (await response.json()).parcel;
    }

    const parcelA = await saveParcel(pageA, "E2E-A-PARCEL-1");
    const parcelB = await saveParcel(pageB, "E2E-B-PARCEL-1");
    expect(parcelA.geometry.type).toBe("MultiPolygon");
    expect(parcelB.geometry.type).toBe("MultiPolygon");
    expect(parcelA).not.toHaveProperty("ownerUserId");
    expect(parcelA).not.toHaveProperty("lineUserId");

    const listA = await request.get(`${backendUrl}/api/parcels/mine`, { headers: auth(tokenA) });
    const listB = await request.get(`${backendUrl}/api/parcels/mine`, { headers: auth(tokenB) });
    expect((await listA.json()).parcels.map((item) => item.id)).toContain(parcelA.id);
    expect((await listA.json()).parcels.map((item) => item.id)).not.toContain(parcelB.id);
    expect((await listB.json()).parcels.map((item) => item.id)).toContain(parcelB.id);
    expect((await listB.json()).parcels.map((item) => item.id)).not.toContain(parcelA.id);

    for (const operation of [
      () => request.get(`${backendUrl}/api/parcels/${parcelA.id}`, { headers: auth(tokenB) }),
      () => request.patch(`${backendUrl}/api/parcels/${parcelA.id}`, { headers: auth(tokenB), data: { parcelName: "stolen" } }),
      () => request.post(`${backendUrl}/api/parcels/${parcelA.id}/analyze`, { headers: auth(tokenB) }),
      () => request.delete(`${backendUrl}/api/parcels/${parcelA.id}`, { headers: auth(tokenB) }),
    ]) {
      const response = await operation();
      expect(response.status()).toBe(404);
      expect(JSON.stringify(await response.json())).not.toContain("coordinates");
    }
    for (const headers of [{}, { Authorization: "Basic invalid" }, auth("e2e-line-token-invalid")]) {
      const response = await request.get(`${backendUrl}/api/parcels/mine`, { headers });
      expect(response.status()).toBe(401);
      expect(JSON.stringify(await response.json())).not.toContain("postgres");
    }

    await pageA.reload();
    await expect.poll(() => pageA.evaluate(() => window.MapLiffMode.isReady())).toBe(true);
    await pageA.locator("#saved-parcels-control-button").click();
    await expect(pageA.locator("#my-parcels-list")).toContainText("E2E-A-PARCEL-1");
    await expect(pageA.locator("#my-parcels-list")).not.toContainText("E2E-B-PARCEL-1");
    await pageA.locator(".saved-parcel-card").filter({ hasText: "E2E-A-PARCEL-1" }).locator(".saved-parcel-header").click();
    await pageA.locator(".saved-parcel-card.is-expanded").getByRole("button", { name: "แก้ไขข้อมูล" }).click();
    await pageA.locator("#parcel-edit-name").fill("E2E-A-PARCEL-EDITED");
    await pageA.locator("#parcel-edit-form button[type=submit]").click();
    await expect(pageA.locator("#my-parcels-list")).toContainText("E2E-A-PARCEL-EDITED");
    const edited = await request.get(`${backendUrl}/api/parcels/${parcelA.id}`, { headers: auth(tokenA) });
    expect((await edited.json()).parcel.parcelName).toBe("E2E-A-PARCEL-EDITED");
    await pageB.locator("#saved-parcels-control-button").click();
    await expect(pageB.locator("#my-parcels-list")).toContainText("E2E-B-PARCEL-1");
    await expect(pageB.locator("#my-parcels-list")).not.toContainText("E2E-A-PARCEL-1");

    const rows = await db.query(`
      SELECT u.id AS user_id, u.line_user_id, p.id AS parcel_id,
        p.owner_user_id, ST_IsValid(p.geom) AS valid,
        ST_GeometryType(p.geom) AS geometry_type, ST_SRID(p.geom) AS srid,
        ST_Area(p.geom) AS area_sqm
      FROM app.users u
      JOIN app.parcels p ON p.owner_user_id = u.id
      WHERE p.id = ANY($1::uuid[])
      ORDER BY u.line_user_id;
    `, [[parcelA.id, parcelB.id]]);
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows[0].line_user_id).toBe("U_E2E_USER_A");
    expect(rows.rows[1].line_user_id).toBe("U_E2E_USER_B");
    expect(rows.rows[0].user_id).not.toBe(rows.rows[1].user_id);
    for (const row of rows.rows) {
      expect(row.owner_user_id).toBe(row.user_id);
      expect(row.valid).toBe(true);
      expect(row.geometry_type).toBe("ST_MultiPolygon");
      expect(row.srid).toBe(32647);
      expect(Number(row.area_sqm)).toBeGreaterThan(10);
    }
    const users = await db.query("SELECT line_user_id, COUNT(*)::int AS count FROM app.users GROUP BY line_user_id ORDER BY line_user_id;");
    expect(users.rows).toEqual([
      { line_user_id: "U_E2E_USER_A", count: 1 },
      { line_user_id: "U_E2E_USER_B", count: 1 },
    ]);

    const deletionFixture = await request.post(`${backendUrl}/api/parcels`, {
      headers: auth(tokenA),
      data: {
        parcelName: "E2E-A-DELETE-1",
        cropType: "rice",
        geometry: {
          type: "Polygon",
          coordinates: [[[99.889, 19.028], [99.891, 19.028], [99.891, 19.030], [99.889, 19.028]]],
        },
      },
    });
    expect(deletionFixture.status()).toBe(201);
    const deleteId = (await deletionFixture.json()).parcel.id;
    const twoParcels = await request.get(`${backendUrl}/api/parcels/mine`, { headers: auth(tokenA) });
    expect((await twoParcels.json()).parcels.map((item) => item.id)).toEqual(expect.arrayContaining([parcelA.id, deleteId]));
    const stillOnlyB = await request.get(`${backendUrl}/api/parcels/mine`, { headers: auth(tokenB) });
    expect((await stillOnlyB.json()).parcels.map((item) => item.id)).not.toContain(deleteId);
    await pageA.locator("#my-parcels-sheet").getByRole("button", { name: "ปิด" }).click();
    await pageA.locator("#saved-parcels-control-button").click();
    const deleteCard = pageA.locator(".saved-parcel-card").filter({ hasText: "E2E-A-DELETE-1" });
    await expect(deleteCard).toBeVisible();
    await deleteCard.locator(".saved-parcel-header").click();
    await deleteCard.getByRole("button", { name: "ลบ", exact: true }).click();
    const deletedResponse = pageA.waitForResponse((response) => response.url().endsWith(`/api/parcels/${deleteId}`) && response.request().method() === "DELETE");
    await pageA.locator("#parcel-delete-dialog").getByRole("button", { name: "ลบแปลง" }).click();
    expect((await deletedResponse).status()).toBe(200);
    await expect(pageA.locator("#my-parcels-list")).not.toContainText("E2E-A-DELETE-1");
    const gone = await request.get(`${backendUrl}/api/parcels/${deleteId}`, { headers: auth(tokenA) });
    expect(gone.status()).toBe(404);
    const removed = await db.query("SELECT COUNT(*)::int AS count FROM app.parcels WHERE id = $1", [deleteId]);
    expect(removed.rows[0].count).toBe(0);

    await pageA.locator("#my-parcels-sheet").getByRole("button", { name: "ปิด" }).click();
    const mapBox = await pageA.locator("#map").boundingBox();
    await pageA.locator("#map").click({ position: { x: mapBox.width * 0.8, y: mapBox.height * 0.55 } });
    await expect(pageA.locator("#mobile-point-confirm")).toBeVisible();
    await pageA.locator("#mobile-point-confirm").click();
    await expect(pageA.locator("#result-panel")).toBeVisible();
    await pageA.getByRole("button", { name: "ปิดหน้าต่างผลการตรวจสอบ" }).click();
    await expect(pageA.locator("#mobile-line-summary-button")).toBeEnabled();
    const summary = pageA.waitForResponse((response) => response.url().endsWith("/api/line/location-summary"));
    await pageA.locator("#mobile-line-summary-button").click();
    expect((await summary).status()).toBe(200);
    const messages = await request.get(`${backendUrl}/__e2e__/messages`);
    const sent = await messages.json();
    expect(sent.at(-1).recipient).toBe("U_E2E_USER_A");
    expect(sent.at(-1).message.type).toBe("flex");
    expect(sent.at(-1).message.contents.type).toBe("bubble");

    expect(forbiddenA).toEqual([]);
    expect(forbiddenB).toEqual([]);
    expect(errorsA).toEqual([]);
    expect(errorsB).toEqual([]);
  } finally {
    await Promise.allSettled([contextA.close(), contextB.close()]);
  }
});

test("mobile hazard legend opens, scrolls, and collapses after a local layer request", async ({ page, context }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith("mobile"));
  const forbidden = await prepareContext(context);
  const errors = watchPageErrors(page);
  await openMap(page);
  await page.locator('[aria-label="เปิดรายการชั้นข้อมูลแผนที่"]').click();
  const drought = page.locator(".leaflet-control-layers-overlays label").filter({ hasText: "พื้นที่ภัยแล้งซ้ำซาก" }).locator("input");
  const response = page.waitForResponse((item) => item.url().includes("/api/hazard-layers/drought-recurrence"));
  await drought.check();
  expect((await response).status()).toBe(200);
  await page.getByRole("button", { name: "ปิดรายการชั้นข้อมูลแผนที่" }).click();
  const legend = page.locator(".hazard-legend");
  await expect(legend).toBeVisible();
  const toggle = legend.locator(".hazard-legend-mobile-toggle");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(legend.locator(".hazard-legend-content")).toBeVisible();
  await expectVisualSnapshot(legend, "mobile-hazard-legend.png");
  const box = await legend.boundingBox();
  const viewport = page.viewportSize();
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  expect(forbidden).toEqual([]);
  expect(errors).toEqual([]);
});
