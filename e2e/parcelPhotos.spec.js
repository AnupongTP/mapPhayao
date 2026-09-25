const path = require("node:path");
const { readFileSync } = require("node:fs");
const sharp = require("../backend/node_modules/sharp");
const { test, expect } = require("@playwright/test");
const db = require("../backend/src/config/database");
const { backendUrl, prepareContext, watchPageErrors, openMap, panMap, drawMobileParcel } = require("./support");

const fixture = path.resolve(__dirname, "../geoserver/data_dir/styles/grass_fill.png");
const token = "e2e-line-token-user-a";
const auth = { Authorization: `Bearer ${token}` };
const directPhotoId = "11111111-1111-4111-8111-111111111111";

test.beforeAll(() => {
  if (process.env.DB_HOST !== "127.0.0.1" || process.env.DB_NAME !== "mapphayao_e2e") {
    throw new Error("Refusing non-local parcel photo E2E database");
  }
});

test("mobile browser uploads prepared WebP bytes instead of the large camera original", async ({ page, context }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium");
  const forbidden = await prepareContext(context, { token });
  const original = await sharp({ create: { width: 3000, height: 1800, channels: 3,
    background: "green" } }).jpeg({ quality: 95 }).toBuffer();
  let posted;
  await page.route("**/api/parcels/*/images", (route) => {
    posted = route.request().postDataBuffer();
    return route.fulfill({ status: 201, contentType: "application/json",
      body: JSON.stringify({ image: { id: "prepared.webp" } }) });
  });
  await openMap(page, true);
  await expect.poll(() => page.evaluate(() => window.MapLiffMode.isReady())).toBe(true);
  const result = await page.evaluate(async (bytes) => {
    const file = new File([new Uint8Array(bytes)], "camera.jpg", { type: "image/jpeg" });
    const prepared = await window.MapParcelPhotoProcessing.prepareFile(file);
    const image = await createImageBitmap(prepared);
    await window.MapApi.uploadParcelImage("11111111-1111-4111-8111-111111111111", prepared,
      "11111111-1111-4111-8111-111111111111");
    return { inputBytes: file.size, uploadBytes: prepared.size, type: prepared.type,
      width: image.width, height: image.height };
  }, [...original]);
  expect(result.type).toBe("image/webp");
  expect(result.width).toBe(1600);
  expect(result.height).toBe(960);
  expect(result.uploadBytes).toBeLessThan(result.inputBytes);
  expect(posted.length).toBeLessThan(original.length);
  expect(posted.toString("utf8")).toContain("Content-Type: image/webp");
  expect(forbidden).toEqual([]);
});

test("temporary parcel details reopen with the existing planting date and note", async ({ page, context }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium");
  const forbidden = await prepareContext(context, { token });
  const errors = watchPageErrors(page);
  await openMap(page, true);
  await expect.poll(() => page.evaluate(() => window.MapLiffMode.isReady())).toBe(true);
  await drawMobileParcel(page, "DETAIL-REOPEN");
  await page.evaluate(() => {
    const prompt = window.MapUi.promptParcelName;
    window.__capturedPhotoIds = [];
    window.MapUi.promptParcelName = async function (...args) {
      const result = await prompt.apply(this, args);
      if (result) window.__capturedPhotoIds.push(result.photos.map((photo) => photo.clientPhotoId));
      return result;
    };
  });
  await page.getByRole("button", { name: "ปิดหน้าต่างผลการตรวจสอบ" }).click();
  await page.locator("#mobile-temporary-parcels-button").click();
  const item = page.locator("#temporary-parcel-list .parcel-item").first();
  await item.locator(".parcel-item-toggle").click();
  await item.getByRole("button", { name: "แก้ไขรายละเอียด" }).click();
  const details = page.locator(".parcel-modal");
  await details.locator('input[type="file"][multiple]').setInputFiles(fixture);
  await details.locator('input[name="plantingDate"]').fill("2026-01-15");
  await details.locator('textarea[name="note"]').fill("เก็บไว้ในแปลงชั่วคราว");
  await details.getByRole("button", { name: "บันทึกรายละเอียด" }).click();
  await item.getByRole("button", { name: "แก้ไขรายละเอียด" }).click();
  await expect(details.locator('input[name="plantingDate"]')).toHaveValue("2026-01-15");
  await expect(details.locator('textarea[name="note"]')).toHaveValue("เก็บไว้ในแปลงชั่วคราว");
  await expect(details.locator(".parcel-photo-item")).toHaveCount(1);
  await details.getByRole("button", { name: "บันทึกรายละเอียด" }).click();
  let captured = await page.evaluate(() => window.__capturedPhotoIds);
  expect(captured).toHaveLength(2);
  expect(captured[0][0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  expect(captured[1]).toEqual(captured[0]);
  await item.getByRole("button", { name: "แก้ไขรายละเอียด" }).click();
  await details.getByRole("button", { name: "ลบรูปภาพแปลง 1" }).click();
  await details.locator('input[type="file"][multiple]').setInputFiles(fixture);
  await details.getByRole("button", { name: "บันทึกรายละเอียด" }).click();
  captured = await page.evaluate(() => window.__capturedPhotoIds);
  expect(captured[2]).toHaveLength(1);
  expect(captured[2][0]).not.toBe(captured[0][0]);
  expect((await db.query("SELECT COUNT(*)::int AS count FROM app.parcels WHERE parcel_name = $1", ["DETAIL-REOPEN"])).rows[0].count).toBe(0);
  expect(forbidden).toEqual([]);
  expect(errors).toEqual([]);
});

test("mobile parcel photos stay local until save, then persist through fake Google", async ({ page, context, request }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium");
  test.setTimeout(120000);
  const forbidden = await prepareContext(context, { token });
  const errors = watchPageErrors(page);
  const driveRequests = [];
  const imageProxyRequests = [];
  page.on("request", (item) => {
    if (item.url().includes("drive.usercontent.google.com")) driveRequests.push(item.url());
    if (/\/api\/parcels\/[^/]+\/images\/[^/]+\/content$/.test(item.url())) {
      imageProxyRequests.push(item.url());
    }
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
  await expect(modal.locator('input[name="plantingDate"]')).toHaveValue(await page.evaluate(() => {
    const today = new Date();
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  }));
  await expect(modal).toContainText("รูปภาพแปลง");
  await expect(modal.getByRole("button", { name: "ถ่ายรูป" })).toBeVisible();
  await expect(modal.getByRole("button", { name: "เลือกรูป" })).toBeVisible();
  const gallery = modal.locator('input[type="file"][multiple]');
  const camera = modal.locator('input[type="file"][capture="environment"]');
  await gallery.setInputFiles([fixture, fixture]);
  await camera.setInputFiles(fixture);
  await expect(modal.locator(".parcel-photo-item")).toHaveCount(3);
  await expect(modal.locator(".parcel-photo-count")).toHaveText("รูปภาพ 3/5 รูป");
  await gallery.setInputFiles([fixture, fixture, fixture]);
  await expect(modal.locator(".parcel-photo-item")).toHaveCount(5);
  await expect(modal.locator(".parcel-photo-count")).toHaveText("รูปภาพ 5/5 รูป");
  await expect(modal.locator(".parcel-modal-error")).toHaveText("เลือกได้สูงสุด 5 รูป");
  await modal.getByRole("button", { name: "เลือกรูป" }).click();
  await expect(modal.locator(".parcel-modal-error")).toHaveText("เลือกได้สูงสุด 5 รูป");
  await modal.getByRole("button", { name: "ลบรูปภาพแปลง 5" }).click();
  await modal.getByRole("button", { name: "ลบรูปภาพแปลง 4" }).click();
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
  expect(await page.evaluate(() => window.__revokedPhotoUrls.length)).toBe(0);
  await modal.locator('input[name="parcelName"]').fill("PHOTO-E2E");
  await modal.locator('input[name="riceVariety"]').fill("KDML105");
  await modal.locator('textarea[name="note"]').fill("ทดสอบหมายเหตุแปลง");
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
  await expect(sheet).toContainText("ทดสอบหมายเหตุแปลง");
  await expect(sheet).toContainText("KDML105");
  await expect(sheet.locator("input, select, textarea")).toHaveCount(0);
  await sheet.getByRole("button", { name: "ยกเลิก" }).click();
  await expect(sheet).toBeHidden();
  expect((await db.query("SELECT COUNT(*)::int AS count FROM app.parcels WHERE parcel_name = $1", ["PHOTO-E2E"])).rows[0].count).toBe(0);
  await page.locator("#mobile-parcel-save-button").click();
  const uploadProgress = [];
  await page.route("**/api/parcels/*/images", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    uploadProgress.push(route.request().url());
    await new Promise((resolve) => setTimeout(resolve, 600));
    return route.continue();
  });
  const created = page.waitForResponse((response) => response.url().endsWith("/api/parcels") && response.request().method() === "POST");
  await sheet.getByRole("button", { name: "บันทึกแปลง" }).click();
  await expect(sheet.locator("#parcel-save-status")).toContainText("กำลังอัปโหลดรูป 1/2");
  await expect(sheet.locator("#parcel-save-status")).toContainText("กำลังอัปโหลดรูป 2/2");
  const parcel = (await (await created).json()).parcel;
  expect(parcel.note).toBe("ทดสอบหมายเหตุแปลง");
  expect(parcel.riceVariety).toBe("KDML105");
  expect(parcel.representativePoint).not.toBeNull();
  await expect(sheet).toHaveCount(0);
  expect(uploadProgress).toHaveLength(2);
  expect(await page.evaluate(() => window.__revokedPhotoUrls.length)).toBe(7);
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
    `https://drive.usercontent.google.com/download?id=${file.id}&export=view`));
  expect(sheetRow[13]).toBe("ทดสอบหมายเหตุแปลง");
  expect(sheetRow[14]).toMatch(/\+07:00$/);
  expect(sheetRow[15]).toMatch(/\+07:00$/);
  expect(google.files).toHaveLength(2);
  const denied = await request.post(`${backendUrl}/api/parcels/${parcel.id}/images`, {
    headers: { Authorization: "Bearer e2e-line-token-user-b" },
    multipart: { image: { name: "test.png", mimeType: "image/png", buffer: readFileSync(fixture) },
      clientPhotoId: directPhotoId },
  });
  expect(denied.status()).toBe(404);
  const imagePayload = { name: "test.png", mimeType: "image/png", buffer: readFileSync(fixture) };
  expect((await request.post(`${backendUrl}/api/parcels/${parcel.id}/images`, {
    multipart: { image: imagePayload, clientPhotoId: directPhotoId },
  })).status()).toBe(401);
  expect((await request.post(`${backendUrl}/api/parcels/${parcel.id}/images`, {
    headers: { Authorization: "Bearer invalid-token" }, multipart: { image: imagePayload,
      clientPhotoId: directPhotoId },
  })).status()).toBe(401);
  expect((await request.post(`${backendUrl}/api/parcels/${parcel.id}/images`, {
    headers: auth, multipart: { image: { name: "wrong.png", mimeType: "image/png", buffer: Buffer.from("not an image") },
      clientPhotoId: directPhotoId },
  })).status()).toBe(415);
  expect((await request.post(`${backendUrl}/api/parcels/${parcel.id}/images`, {
    headers: auth, multipart: { image: { name: "large.png", mimeType: "image/png", buffer: Buffer.alloc(12 * 1024 * 1024 + 1) },
      clientPhotoId: directPhotoId },
  })).status()).toBe(413);
  expect((await request.get(`${backendUrl}/api/parcels/${parcel.id}/images/${(await detail.json()).parcel.images[0].id}/content`, {
    headers: { Authorization: "Bearer e2e-line-token-user-b" },
  })).status()).toBe(404);
  expect((await request.get(`${backendUrl}/api/parcels/${parcel.id}/images/${google.files[1].id}/content`, {
    headers: auth,
  })).status()).toBe(404);
  const imageId = (await detail.json()).parcel.images[0].id;
  const ownedImage = await request.get(`${backendUrl}/api/parcels/${parcel.id}/images/${imageId}/content`, {
    headers: auth,
  });
  expect(ownedImage.status()).toBe(200);
  expect(ownedImage.headers()["content-type"]).toMatch(/^image\/webp/);
  expect(ownedImage.headers()["cache-control"]).toContain("private");
  expect((await ownedImage.body()).length).toBeGreaterThan(0);
  expect((await request.get(`${backendUrl}/api/parcels/${parcel.id}/images/${imageId}/content`)).status()).toBe(401);

  await page.reload();
  await expect.poll(() => page.evaluate(() => window.MapLiffMode.isReady())).toBe(true);
  await page.locator("#saved-parcels-control-button").click();
  const card = page.locator(".saved-parcel-card").filter({ hasText: "PHOTO-E2E" });
  await card.locator(".saved-parcel-header").click();
  await card.getByRole("button", { name: "ดูแปลง" }).click();
  await expect(page.locator("#result-panel-content")).toContainText("PHOTO-E2E");
  await expect(page.locator("#result-panel-content")).toContainText("ทดสอบหมายเหตุแปลง");
  await expect(page.locator("#result-panel-content .parcel-photo-section img")).toHaveCount(2);
  const firstSavedPhoto = page.locator("#result-panel-content .parcel-photo-item").first();
  await firstSavedPhoto.scrollIntoViewIfNeeded();
  await expect.poll(() => imageProxyRequests.length).toBe(2);
  expect(driveRequests).toEqual([]);
  await expect(firstSavedPhoto.locator("img")).toHaveAttribute("src", /^blob:/);
  const savedPhotoUrl = await firstSavedPhoto.locator("img").getAttribute("src");
  await firstSavedPhoto.click();
  await expect(page.locator(".parcel-photo-viewer")).toBeVisible();
  await expect(page.locator(".parcel-photo-viewer img")).toHaveAttribute("src", savedPhotoUrl);
  await page.locator(".parcel-photo-viewer img").click();
  await expect(page.locator(".parcel-photo-viewer")).toBeVisible();
  await page.locator(".parcel-photo-viewer").click({ position: { x: 5, y: 5 } });
  await expect(page.locator(".parcel-photo-viewer")).toBeHidden();
  await firstSavedPhoto.click();
  await page.keyboard.press("Escape");
  await expect(page.locator(".parcel-photo-viewer")).toBeHidden();
  expect(imageProxyRequests).toHaveLength(2);
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
  expect(updatedRow[13]).toBe("ทดสอบหมายเหตุแปลง");
  expect(JSON.parse(updatedRow[11])).toHaveLength(2);
  expect(JSON.parse(updatedRow[12])).toHaveLength(2);
  expect((await request.delete(`${backendUrl}/api/parcels/${parcel.id}`, { headers: auth })).status()).toBe(200);
  const queued = (await db.query(`SELECT status, remaining_file_ids, sheet_deleted
    FROM app.cleanup_jobs WHERE parcel_id = $1`, [parcel.id])).rows[0];
  expect(queued.status).toBe("pending");
  expect(queued.remaining_file_ids).toHaveLength(2);
  expect(queued.sheet_deleted).toBe(false);
  const beforeCleanup = (await (await request.get(`${backendUrl}/__e2e__/google`)).json());
  expect(beforeCleanup.files).toHaveLength(2);
  expect(beforeCleanup.parcels.some((row) => row[2] === parcel.parcelCode)).toBe(true);
  expect((await db.query("SELECT COUNT(*)::int AS count FROM app.parcels WHERE id = $1", [parcel.id])).rows[0].count).toBe(0);
  expect((await (await request.post(`${backendUrl}/__e2e__/cleanup/run`)).json()).processed).toBe(1);
  const afterDelete = (await (await request.get(`${backendUrl}/__e2e__/google`)).json());
  expect(afterDelete.files).toHaveLength(0);
  expect(afterDelete.parcels.find((row) => row[2] === parcel.parcelCode)).toBeUndefined();
  const completed = (await db.query(`SELECT status, remaining_file_ids, sheet_deleted, completed_at
    FROM app.cleanup_jobs WHERE parcel_id = $1`, [parcel.id])).rows[0];
  expect(completed.status).toBe("completed");
  expect(completed.remaining_file_ids).toEqual([]);
  expect(completed.sheet_deleted).toBe(true);
  expect(completed.completed_at).not.toBeNull();
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
  await page.locator("#parcel-save-sheet").getByRole("button", { name: "บันทึกแปลง" }).click();
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
  await modal.locator('input[type="file"][multiple]').setInputFiles([fixture, fixture]);
  await modal.locator('input[name="parcelName"]').fill("PHOTO-RETRY-E2E");
  const analyze = page.waitForResponse((response) => response.url().includes("/api/area-analysis/polygon"));
  await modal.getByRole("button", { name: "เริ่มวิเคราะห์" }).click();
  expect((await analyze).status()).toBe(200);
  await page.locator(".leaflet-popup").getByRole("button", { name: "เปิดรายละเอียด" }).click();
  expect((await request.post(`${backendUrl}/__e2e__/google/fail-next-upload`)).status()).toBe(200);
  await page.locator("#mobile-parcel-save-button").click();
  const sheet = page.locator("#parcel-save-sheet");
  let imageAttempts = 0;
  page.on("request", (item) => {
    if (/\/api\/parcels\/[^/]+\/images$/.test(item.url()) && item.method() === "POST") imageAttempts += 1;
  });
  const createResponse = page.waitForResponse((response) => response.url().endsWith("/api/parcels") && response.request().method() === "POST");
  await sheet.getByRole("button", { name: "บันทึกแปลง" }).click();
  const parcel = (await (await createResponse).json()).parcel;
  await expect(sheet.locator("#parcel-save-status")).toContainText("บันทึกแปลงแล้ว แต่มีรูปภาพ 1 รูปอัปโหลดไม่สำเร็จ");
  const beforeRetry = await db.query("SELECT COUNT(*)::int AS count FROM app.parcels WHERE id = $1", [parcel.id]);
  expect(beforeRetry.rows[0].count).toBe(1);
  const failedGoogle = await (await request.get(`${backendUrl}/__e2e__/google`)).json();
  expect(imageAttempts).toBe(2);
  expect(failedGoogle.files).toHaveLength(1);
  const failedRow = failedGoogle.parcels.find((row) => row[2] === parcel.parcelCode);
  expect(JSON.parse(failedRow[11])).toHaveLength(1);
  expect(JSON.parse(failedRow[12])).toHaveLength(1);
  let createAttempts = 0;
  page.on("request", (item) => {
    if (item.url().endsWith("/api/parcels") && item.method() === "POST") createAttempts += 1;
  });
  await sheet.getByRole("button", { name: "บันทึกแปลง" }).click();
  await expect(sheet).toHaveCount(0);
  expect(createAttempts).toBe(0);
  expect(imageAttempts).toBe(3);
  expect((await (await request.get(`${backendUrl}/__e2e__/google`)).json()).files).toHaveLength(2);
  const detail = await request.get(`${backendUrl}/api/parcels/${parcel.id}`, { headers: auth });
  expect((await detail.json()).parcel.images).toHaveLength(2);
  expect(forbidden).toEqual([]);
  expect(errors).toEqual([
    "Failed to load resource: the server responded with a status of 500 (Internal Server Error)",
  ]);
  expect((await request.delete(`${backendUrl}/api/parcels/${parcel.id}`, { headers: auth })).status()).toBe(200);
});

test("mobile save retries one safe transient photo with its original ID before the next photo", async ({ page, context, request }, testInfo) => {
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
  await modal.locator('input[type="file"][multiple]').setInputFiles([fixture, fixture]);
  await modal.locator('input[name="parcelName"]').fill("PHOTO-AUTO-RETRY-E2E");
  const analyze = page.waitForResponse((response) => response.url().includes("/api/area-analysis/polygon"));
  await modal.getByRole("button", { name: "เริ่มวิเคราะห์" }).click();
  expect((await analyze).status()).toBe(200);
  await page.locator(".leaflet-popup").getByRole("button", { name: "เปิดรายละเอียด" }).click();
  await page.locator("#mobile-parcel-save-button").click();

  const uploads = [];
  let first = true;
  await page.route("**/api/parcels/*/images", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const body = route.request().postDataBuffer().toString("utf8");
    const id = body.match(/name="clientPhotoId"\r?\n\r?\n([0-9a-f-]{36})/i)?.[1];
    uploads.push({ id, attempt: route.request().headers()["x-photo-attempt"] });
    if (first) {
      first = false;
      return route.fulfill({ status: 503, contentType: "application/json",
        body: JSON.stringify({ error: "Temporary", retryable: true }) });
    }
    return route.continue();
  });
  const createResponse = page.waitForResponse((response) => response.url().endsWith("/api/parcels") &&
    response.request().method() === "POST");
  await page.locator("#parcel-save-sheet").getByRole("button", { name: "บันทึกแปลง" }).click();
  const parcel = (await (await createResponse).json()).parcel;
  await expect(page.locator("#parcel-save-sheet #parcel-save-status"))
    .toContainText("กำลังลองอัปโหลดรูป 1/2 อีกครั้ง... (1/3)");
  await expect(page.locator("#parcel-save-sheet")).toHaveCount(0);
  expect(uploads).toHaveLength(3);
  expect(uploads.map((item) => item.attempt)).toEqual(["0", "1", "0"]);
  expect(uploads[0].id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  expect(uploads[0].id).toBe(uploads[1].id);
  expect(uploads[2].id).not.toBe(uploads[0].id);
  expect((await db.query("SELECT COUNT(*)::int AS count FROM app.parcels WHERE id = $1", [parcel.id])).rows[0].count).toBe(1);
  const detail = await request.get(`${backendUrl}/api/parcels/${parcel.id}`, { headers: auth });
  expect((await detail.json()).parcel.images).toHaveLength(2);
  const google = await (await request.get(`${backendUrl}/__e2e__/google`)).json();
  expect(google.files.filter((file) => file.fileName.startsWith(`${parcel.parcelCode}_`))).toHaveLength(2);
  expect(forbidden).toEqual([]);
  expect(errors).toEqual([
    "Failed to load resource: the server responded with a status of 503 (Service Unavailable)",
  ]);
  expect((await request.delete(`${backendUrl}/api/parcels/${parcel.id}`, { headers: auth })).status()).toBe(200);
});
