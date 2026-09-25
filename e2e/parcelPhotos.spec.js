const path = require("node:path");
const { readFileSync } = require("node:fs");
const { test, expect } = require("@playwright/test");
const db = require("../backend/src/config/database");
const { backendUrl, prepareContext, watchPageErrors, openMap, panMap, drawMobileParcel } = require("./support");

const fixture = path.resolve(__dirname, "../geoserver/data_dir/styles/grass_fill.png");
const token = "e2e-line-token-user-a";
const auth = { Authorization: `Bearer ${token}` };

test.beforeAll(() => {
  if (process.env.DB_HOST !== "127.0.0.1" || process.env.DB_NAME !== "mapphayao_e2e") {
    throw new Error("Refusing non-local parcel photo E2E database");
  }
});
test("mobile parcel photos stay local until save, then persist through fake Google", async ({ page, context, request }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium");
  test.setTimeout(120000);
  const forbidden = await prepareContext(context, { token });
  const errors = watchPageErrors(page);
  const driveRequests = [];
  let imageProxyRequests = 0;
  await page.route(/^https:\/\/drive\.google\.com\/uc\?/, (route) => {
    driveRequests.push(route.request().url());
    return route.fulfill({ status: 200, contentType: "image/png", body: readFileSync(fixture) });
  });
  await page.route("**/api/parcels/*/images/*/content", (route) => {
    imageProxyRequests += 1;
    return route.abort();
  });
  await context.addInitScript(() => {
    window.__revokedPhotoUrls = [];
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.revokeObjectURL = (url) => {
      window.__revokedPhotoUrls.push(url);
      revoke(url);
    };
  });
  await openMap(page, true);
  await expect.poll(() => page.evaluate(() => window.MapLiffMode.isReady())).toBe(true);
  await page.setViewportSize({ width: 320, height: 700 });

  await page.locator(".parcel-draw-button").click();
  const hud = page.locator("#mobile-parcel-draw-hud");
  await hud.locator(".mobile-parcel-draw-add").click();
  await panMap(page, 90, 0);
  await hud.locator(".mobile-parcel-draw-add").click();
  await panMap(page, 0, 90);
  await hud.locator(".mobile-parcel-draw-add").click();
  await hud.locator(".mobile-parcel-draw-finish").click();
  const modal = page.locator(".parcel-modal");
  await expect(modal).toBeVisible();
  await expect(modal).toContainText("รูปภาพแปลง");
  await expect(modal.getByRole("button", { name: "ถ่ายรูป" })).toBeVisible();
  await expect(modal.getByRole("button", { name: "เลือกรูป" })).toBeVisible();
  const gallery = modal.locator('input[type="file"][multiple]');
  const camera = modal.locator('input[type="file"][capture="environment"]');
  await gallery.setInputFiles([fixture, fixture]);
  await camera.setInputFiles(fixture);
  await expect(modal.locator(".parcel-photo-item")).toHaveCount(3);
  await expect(modal.locator(".parcel-photo-count")).toHaveText("รูปภาพ 3 รูป");
  const mobileFit = await page.evaluate(() => {
    const modal = document.querySelector(".parcel-modal");
    const strip = modal.querySelector(".parcel-photo-strip");
    return { pageOverflow: document.documentElement.scrollWidth - innerWidth,
      modalOverflow: modal.scrollWidth - modal.clientWidth,
      galleryScrolls: strip.scrollWidth > strip.clientWidth };
  });
  expect(mobileFit.pageOverflow).toBe(0);
  expect(mobileFit.modalOverflow).toBe(0);
  expect(mobileFit.galleryScrolls).toBe(true);
  await page.setViewportSize({ width: 360, height: 780 });
  expect(await page.evaluate(() => document.querySelector(".parcel-modal").scrollWidth -
    document.querySelector(".parcel-modal").clientWidth)).toBe(0);
  await modal.getByRole("button", { name: "ลบรูปภาพแปลง 2" }).click();
  await expect(modal.locator(".parcel-photo-item")).toHaveCount(2);
  expect(await page.evaluate(() => window.__revokedPhotoUrls.length)).toBe(1);
  await modal.locator('input[type="text"]').fill("PHOTO-E2E");
  const analyze = page.waitForResponse((response) => response.url().includes("/api/area-analysis/polygon"));
  await modal.getByRole("button", { name: "เริ่มวิเคราะห์" }).click();
  const analysisResponse = await analyze;
  expect(analysisResponse.status()).toBe(200);
  const analysisPayload = await analysisResponse.json();
  await page.locator(".leaflet-popup").getByRole("button", { name: "เปิดรายละเอียด" }).click();
  const result = page.locator("#result-panel-content");
  const analyzedCoordinate = `${analysisPayload.representativePoint.latitude.toFixed(6)}, ${analysisPayload.representativePoint.longitude.toFixed(6)}`;
  await expect(result).toContainText(`พิกัดแปลง${analyzedCoordinate}`);
  await expect(result.locator(".parcel-photo-section .parcel-photo-item")).toHaveCount(2);
  await result.locator(".parcel-photo-section .parcel-photo-item").first().click();
  await expect(page.locator(".parcel-photo-viewer")).toBeVisible();
  await expect(page.locator(".parcel-photo-viewer img")).toHaveAttribute("src", /^blob:/);
  await page.getByRole("button", { name: "ปิดรูปภาพ" }).click();
  await expect(page.locator(".parcel-photo-viewer")).toBeHidden();
  await expect(result.locator(".parcel-photo-section")).toBeVisible();
  await expect(result.locator(".parcel-photo-section")).toHaveClass(/parcel-result-card/);
  expect(await result.evaluate((node) => node.scrollWidth - node.clientWidth)).toBe(0);
  await page.locator("#mobile-parcel-save-button").click();
  const sheet = page.locator("#parcel-save-sheet");
  const created = page.waitForResponse((response) => response.url().endsWith("/api/parcels") && response.request().method() === "POST");
  await sheet.locator('button[type="submit"]').click();
  const parcel = (await (await created).json()).parcel;
  expect(parcel.representativePoint).not.toBeNull();
  await expect(sheet).toHaveCount(0);
  expect(await page.evaluate(() => window.__revokedPhotoUrls.length)).toBe(3);
  const detail = await request.get(`${backendUrl}/api/parcels/${parcel.id}`, { headers: auth });
  expect(detail.status()).toBe(200);
  expect((await detail.json()).parcel.images).toHaveLength(2);
  expect((await db.query("SELECT to_regclass('app.parcel_images') AS image_table")).rows[0].image_table).toBeNull();
  const google = (await (await request.get(`${backendUrl}/__e2e__/google`)).json());
  expect(google.users).toHaveLength(1);
  expect(google.users[0][1]).toBe("ผู้ใช้ทดสอบ A");
  const sheetRow = google.parcels.find((row) => row[2] === parcel.parcelCode);
  expect(sheetRow).toHaveLength(16);
  const owner = await db.query("SELECT owner_user_id FROM app.parcels WHERE id = $1", [parcel.id]);
  expect(sheetRow[0]).toBe(owner.rows[0].owner_user_id);
  expect(sheetRow[1]).toBe("ผู้ใช้ทดสอบ A");
  const representative = (await db.query(`
    SELECT ST_Y(ST_Transform(ST_PointOnSurface(geom), 4326)) AS lat,
      ST_X(ST_Transform(ST_PointOnSurface(geom), 4326)) AS lng
    FROM app.parcels WHERE id = $1
  `, [parcel.id])).rows[0];
  expect(sheetRow[7]).toBe(`${representative.lat.toFixed(6)}, ${representative.lng.toFixed(6)}`);
  const sheetGeometry = JSON.parse(sheetRow[8]);
  expect(sheetGeometry.type).toMatch(/Polygon/);
  const firstVertex = sheetGeometry.type === "MultiPolygon"
    ? sheetGeometry.coordinates[0][0][0] : sheetGeometry.coordinates[0][0];
  expect(sheetRow[7]).not.toBe(`${firstVertex[1].toFixed(6)}, ${firstVertex[0].toFixed(6)}`);
  expect(JSON.parse(sheetRow[11])).toHaveLength(2);
  expect(JSON.parse(sheetRow[12])).toHaveLength(2);
  expect(JSON.parse(sheetRow[11])).toEqual(google.files.map((file) => file.fileName));
  expect(JSON.parse(sheetRow[12])).toEqual(google.files.map((file) =>
    `https://drive.google.com/uc?export=view&id=${file.id}`));
  expect(sheetRow[13]).toBe("");
  expect(google.files).toHaveLength(2);
  const denied = await request.post(`${backendUrl}/api/parcels/${parcel.id}/images`, {
    headers: { Authorization: "Bearer e2e-line-token-user-b" },
    multipart: { image: { name: "test.png", mimeType: "image/png", buffer: readFileSync(fixture) } },
  });
  expect(denied.status()).toBe(404);
  const imagePayload = { name: "test.png", mimeType: "image/png", buffer: readFileSync(fixture) };
  expect((await request.post(`${backendUrl}/api/parcels/${parcel.id}/images`, {
    multipart: { image: imagePayload },
  })).status()).toBe(401);
  expect((await request.post(`${backendUrl}/api/parcels/${parcel.id}/images`, {
    headers: { Authorization: "Bearer invalid-token" }, multipart: { image: imagePayload },
  })).status()).toBe(401);
  expect((await request.post(`${backendUrl}/api/parcels/${parcel.id}/images`, {
    headers: auth, multipart: { image: { name: "wrong.png", mimeType: "image/png", buffer: Buffer.from("not an image") } },
  })).status()).toBe(415);
  expect((await request.post(`${backendUrl}/api/parcels/${parcel.id}/images`, {
    headers: auth, multipart: { image: { name: "large.png", mimeType: "image/png", buffer: Buffer.alloc(12 * 1024 * 1024 + 1) } },
  })).status()).toBe(413);
  expect((await request.get(`${backendUrl}/api/parcels/${parcel.id}/images/${(await detail.json()).parcel.images[0].id}/content`, {
    headers: { Authorization: "Bearer e2e-line-token-user-b" },
  })).status()).toBe(404);
  expect((await request.get(`${backendUrl}/api/parcels/${parcel.id}/images/${google.files[1].id}/content`, {
    headers: auth,
  })).status()).toBe(404);

  await page.reload();
  await expect.poll(() => page.evaluate(() => window.MapLiffMode.isReady())).toBe(true);
  await page.locator("#saved-parcels-control-button").click();
  const card = page.locator(".saved-parcel-card").filter({ hasText: "PHOTO-E2E" });
  await card.locator(".saved-parcel-header").click();
  await card.getByRole("button", { name: "ดูแปลง" }).click();
  await expect(page.locator("#result-panel-content")).toContainText("PHOTO-E2E");
  await expect(page.locator("#result-panel-content .parcel-photo-section img")).toHaveCount(2);
  const firstSavedPhoto = page.locator("#result-panel-content .parcel-photo-item").first();
  await firstSavedPhoto.scrollIntoViewIfNeeded();
  await expect.poll(() => driveRequests.length).toBe(2);
  expect(imageProxyRequests).toBe(0);
  await expect(firstSavedPhoto.locator("img")).toHaveAttribute("src", JSON.parse(sheetRow[12])[0]);
  await firstSavedPhoto.click();
  await expect(page.locator(".parcel-photo-viewer")).toBeVisible();
  await expect(page.locator(".parcel-photo-viewer img")).toHaveAttribute("src", JSON.parse(sheetRow[12])[0]);
  await page.locator(".parcel-photo-viewer img").click();
  await expect(page.locator(".parcel-photo-viewer")).toBeVisible();
  await page.locator(".parcel-photo-viewer").click({ position: { x: 5, y: 5 } });
  await expect(page.locator(".parcel-photo-viewer")).toBeHidden();
  await firstSavedPhoto.click();
  await page.keyboard.press("Escape");
  await expect(page.locator(".parcel-photo-viewer")).toBeHidden();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  await expect(page.locator("#result-panel-content")).toContainText(`พิกัดแปลง${sheetRow[7]}`);
  const updated = await request.patch(`${backendUrl}/api/parcels/${parcel.id}`, {
    headers: auth, data: { parcelName: "PHOTO-E2E-EDITED" },
  });
  expect(updated.status()).toBe(200);
  const afterUpdate = (await (await request.get(`${backendUrl}/__e2e__/google`)).json());
  const updatedRow = afterUpdate.parcels.find((row) => row[2] === parcel.parcelCode);
  expect(updatedRow[3]).toBe("PHOTO-E2E-EDITED");
  expect(updatedRow[7]).toBe(sheetRow[7]);
  expect(JSON.parse(updatedRow[11])).toHaveLength(2);
  expect(JSON.parse(updatedRow[12])).toHaveLength(2);
  expect((await request.delete(`${backendUrl}/api/parcels/${parcel.id}`, { headers: auth })).status()).toBe(200);
  const afterDelete = (await (await request.get(`${backendUrl}/__e2e__/google`)).json());
  expect(afterDelete.files).toHaveLength(0);
  expect(afterDelete.parcels.find((row) => row[2] === parcel.parcelCode)).toBeUndefined();
  expect((await db.query("SELECT to_regclass('app.parcel_images') AS image_table")).rows[0].image_table).toBeNull();
  expect(forbidden).toEqual([]);
  expect(errors).toEqual([]);
});

test("parcel without photos still analyzes, saves, and mirrors empty arrays", async ({ page, context, request }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium");
  test.setTimeout(120000);
  const forbidden = await prepareContext(context, { token });
  const errors = watchPageErrors(page);
  await openMap(page, true);
  await expect.poll(() => page.evaluate(() => window.MapLiffMode.isReady())).toBe(true);
  await drawMobileParcel(page, "NO-PHOTO-E2E");
  await expect(page.locator("#result-panel-content .parcel-photo-empty")).toHaveText("ยังไม่มีรูปภาพแปลง");
  await page.locator("#mobile-parcel-save-button").click();
  const created = page.waitForResponse((response) => response.url().endsWith("/api/parcels") && response.request().method() === "POST");
  await page.locator('#parcel-save-sheet button[type="submit"]').click();
  const parcel = (await (await created).json()).parcel;
  await expect(page.locator("#parcel-save-sheet")).toHaveCount(0);
  const google = (await (await request.get(`${backendUrl}/__e2e__/google`)).json());
  const row = google.parcels.find((item) => item[2] === parcel.parcelCode);
  expect(row).toHaveLength(16);
  expect(row[7]).toMatch(/^-?\d+\.\d{6}, -?\d+\.\d{6}$/);
  expect(row[11]).toBe("[]");
  expect(row[12]).toBe("[]");
  expect(forbidden).toEqual([]);
  expect(errors).toEqual([]);
  expect((await request.delete(`${backendUrl}/api/parcels/${parcel.id}`, { headers: auth })).status()).toBe(200);
});

test("failed photo upload keeps saved parcel and retries without duplicate creation", async ({ page, context, request }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium");
  test.setTimeout(120000);
  const forbidden = await prepareContext(context, { token });
  const errors = watchPageErrors(page);
  await openMap(page, true);
  await expect.poll(() => page.evaluate(() => window.MapLiffMode.isReady())).toBe(true);
  await page.locator(".parcel-draw-button").click();
  const hud = page.locator("#mobile-parcel-draw-hud");
  await hud.locator(".mobile-parcel-draw-add").click();
  await panMap(page, 90, 0);
  await hud.locator(".mobile-parcel-draw-add").click();
  await panMap(page, 0, 90);
  await hud.locator(".mobile-parcel-draw-add").click();
  await hud.locator(".mobile-parcel-draw-finish").click();
  const modal = page.locator(".parcel-modal");
  await modal.locator('input[type="file"][multiple]').setInputFiles(fixture);
  await modal.locator('input[type="text"]').fill("PHOTO-RETRY-E2E");
  const analyze = page.waitForResponse((response) => response.url().includes("/api/area-analysis/polygon"));
  await modal.getByRole("button", { name: "เริ่มวิเคราะห์" }).click();
  expect((await analyze).status()).toBe(200);
  await page.locator(".leaflet-popup").getByRole("button", { name: "เปิดรายละเอียด" }).click();
  expect((await request.post(`${backendUrl}/__e2e__/google/fail-next-upload`)).status()).toBe(200);
  await page.locator("#mobile-parcel-save-button").click();
  const sheet = page.locator("#parcel-save-sheet");
  const createResponse = page.waitForResponse((response) => response.url().endsWith("/api/parcels") && response.request().method() === "POST");
  await sheet.locator('button[type="submit"]').click();
  const parcel = (await (await createResponse).json()).parcel;
  await expect(sheet.locator("#parcel-save-status")).toContainText("บันทึกแปลงแล้ว แต่มีรูปภาพ 1 รูปอัปโหลดไม่สำเร็จ");
  const beforeRetry = await db.query("SELECT COUNT(*)::int AS count FROM app.parcels WHERE id = $1", [parcel.id]);
  expect(beforeRetry.rows[0].count).toBe(1);
  const failedGoogle = await (await request.get(`${backendUrl}/__e2e__/google`)).json();
  expect(failedGoogle.files).toHaveLength(0);
  const failedRow = failedGoogle.parcels.find((row) => row[2] === parcel.parcelCode);
  expect(failedRow[11]).toBe("[]");
  expect(failedRow[12]).toBe("[]");
  let createAttempts = 0;
  page.on("request", (item) => {
    if (item.url().endsWith("/api/parcels") && item.method() === "POST") createAttempts += 1;
  });
  await sheet.locator('button[type="submit"]').click();
  await expect(sheet).toHaveCount(0);
  expect(createAttempts).toBe(0);
  expect((await (await request.get(`${backendUrl}/__e2e__/google`)).json()).files).toHaveLength(1);
  const detail = await request.get(`${backendUrl}/api/parcels/${parcel.id}`, { headers: auth });
  expect((await detail.json()).parcel.images).toHaveLength(1);
  expect(forbidden).toEqual([]);
  expect(errors).toEqual([
    "Failed to load resource: the server responded with a status of 500 (Internal Server Error)",
  ]);
  expect((await request.delete(`${backendUrl}/api/parcels/${parcel.id}`, { headers: auth })).status()).toBe(200);
});
