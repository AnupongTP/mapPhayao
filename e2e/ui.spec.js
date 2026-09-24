const { test, expect } = require("@playwright/test");
const { prepareContext, watchPageErrors, openMap, panMap, expectVisualSnapshot } = require("./support");

test("responsive location and semantic Close controls", async ({ page, context }, testInfo) => {
  const mobile = testInfo.project.name.startsWith("mobile");
  const forbidden = await prepareContext(context, { token: "e2e-line-token-user-a" });
  const errors = watchPageErrors(page);
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 19.17, longitude: 99.9 });
  await page.goto("/?liff=1&sandbox-user=a");
  await expect(page.locator("#map")).toBeVisible();
  await page.waitForFunction(() => Boolean(window.appMap && window.appMap._loaded));
  await expect.poll(() => page.evaluate(() => window.MapLiffMode.isReady())).toBe(true);

  const location = page.locator("#mobile-location-launcher");
  await expect(location).toHaveCount(1);
  await expect(location).toHaveAttribute("aria-label", "ตำแหน่งของฉัน");
  await expect(location).toHaveAttribute("title", "ตำแหน่งของฉัน");
  await expect(location.locator("i.fa-location-crosshairs")).toBeVisible();
  if (mobile) {
    await expect(location.locator(".mobile-location-launcher-text")).toBeHidden();
  } else {
    await expect(location.locator(".mobile-location-launcher-text")).toHaveText("ตำแหน่งของฉัน");
    await expect(location.locator(".mobile-location-launcher-text")).toBeVisible();
  }
  const locationLayout = await location.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const badge = document.getElementById("local-sandbox-badge")?.getBoundingClientRect();
    return {
      width: bounds.width,
      height: bounds.height,
      badgeOverlap: badge && bounds.left < badge.right && badge.left < bounds.right &&
        bounds.top < badge.bottom && badge.top < bounds.bottom,
      overflow: document.documentElement.scrollWidth - innerWidth,
    };
  });
  expect(locationLayout.width).toBeGreaterThanOrEqual(44);
  expect(locationLayout.height).toBeGreaterThanOrEqual(44);
  expect(locationLayout.badgeOverlap).toBeFalsy();
  expect(locationLayout.overflow).toBeLessThanOrEqual(2);
  await location.click();
  await expect(page.locator("#location-status")).toContainText("พบตำแหน่งปัจจุบัน");
  if (!mobile) {
    await page.setViewportSize({ width: 360, height: 560 });
    await expect(location.locator(".mobile-location-launcher-text")).toBeHidden();
    await expect.poll(() => location.evaluate((element) => element.parentElement === document.body)).toBe(true);
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(location.locator(".mobile-location-launcher-text")).toBeVisible();
    await expect.poll(() => location.evaluate((element) => element.parentElement.classList.contains("location-actions"))).toBe(true);
    await expect(location).toHaveCount(1);
  }

  async function expectClose(button) {
    await expect(button).toBeVisible();
    await expect(button.locator("i.fa-xmark")).toBeVisible();
    await expect(button).toHaveText("");
    const appearance = await button.evaluate((element) => {
      const style = getComputedStyle(element);
      const bounds = element.getBoundingClientRect();
      return {
        width: bounds.width,
        height: bounds.height,
        background: style.backgroundColor,
        border: style.borderWidth,
        shadow: style.boxShadow,
        color: style.color,
      };
    });
    expect(appearance.width).toBeGreaterThanOrEqual(44);
    expect(appearance.height).toBeGreaterThanOrEqual(44);
    expect(appearance.background).toBe("rgba(0, 0, 0, 0)");
    expect(appearance.border).toBe("0px");
    expect(appearance.shadow).toBe("none");
    expect(appearance.color).toBe("rgb(220, 38, 38)");
  }

  if (mobile) {
    await page.evaluate(() => window.MapUi.showApiError());
    const locationClose = page.getByRole("button", { name: "ปิดหน้าต่างเลือกตำแหน่ง" });
    await expectClose(locationClose);
    await locationClose.click();
    await expect(page.locator("#location-panel")).not.toHaveClass(/is-mobile-open/);
    await page.getByRole("button", { name: "เปิดรายการชั้นข้อมูลแผนที่" }).click();
    const drawerClose = page.getByRole("button", { name: "ปิดรายการชั้นข้อมูลแผนที่" });
    await expectClose(drawerClose);
    await drawerClose.click();
    await expect(page.locator(".leaflet-control-layers.is-mobile-drawer-open")).toHaveCount(0);
  }

  await page.evaluate(() => window.MapParcelManagement.openMyParcelsSheet());
  const sheet = page.locator("#my-parcels-sheet");
  const sheetClose = sheet.getByRole("button", { name: "ปิด" });
  await expectClose(sheetClose);
  await sheetClose.click();
  await expect(sheet).toHaveCount(0);

  await page.evaluate(() => window.MapUi.renderSavedParcelDetail({ parcelName: "E2E UI" }));
  const resultClose = page.getByRole("button", { name: "ปิดหน้าต่างผลการตรวจสอบ" });
  await expectClose(resultClose);
  await resultClose.click();
  await expect(page.locator("#result-panel")).toBeHidden();
  expect(forbidden).toEqual([]);
  expect(errors).toEqual([]);
});

test("local map loads with satellite basemap and no initial GeoJSON overlay", async ({ page, context }) => {
  const forbidden = await prepareContext(context);
  const errors = watchPageErrors(page);
  const requests = [];
  page.on("request", (request) => requests.push(request.url()));
  await openMap(page);
  expect(await page.evaluate(() => window.AppConfig.apiBaseUrl)).toBe("http://127.0.0.1:3100/api");
  expect(await page.evaluate(() => {
    let satelliteActive = false;
    window.appMap.eachLayer((layer) => {
      if (layer._url && layer._url.includes("mt1.google.com/vt/lyrs=s")) satelliteActive = true;
    });
    return satelliteActive;
  })).toBe(true);
  expect(requests.filter((url) => url.endsWith(".geojson"))).toHaveLength(0);
  expect(forbidden).toEqual([]);
  expect(errors).toEqual([]);
});

test("mobile layer drawer fits, toggles, and closes", async ({ page, context }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith("mobile"));
  const forbidden = await prepareContext(context);
  const errors = watchPageErrors(page);
  await openMap(page);
  await page.locator('[aria-label="เปิดรายการชั้นข้อมูลแผนที่"]').click();
  const drawer = page.locator(".leaflet-control-layers.is-mobile-drawer-open");
  await expect(drawer).toBeVisible();
  await expect(page.locator(".mobile-layer-drawer-scrim")).toBeVisible();
  const box = await drawer.boundingBox();
  const viewport = page.viewportSize();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
  await expectVisualSnapshot(drawer, "mobile-layer-drawer.png");
  await page.getByRole("button", { name: "ปิดรายการชั้นข้อมูลแผนที่" }).click();
  await expect(drawer).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2)).toBe(true);
  expect(forbidden).toEqual([]);
  expect(errors).toEqual([]);
});

test("mobile drawer loads a GeoJSON overlay only when enabled and clears it when disabled", async ({ page, context }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith("mobile"));
  const forbidden = await prepareContext(context);
  const errors = watchPageErrors(page);
  const overlayRequests = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/data/layers/tambon.geojson")) overlayRequests.push(request.url());
  });
  await openMap(page);
  expect(overlayRequests).toHaveLength(0);
  await page.locator('[aria-label="เปิดรายการชั้นข้อมูลแผนที่"]').click();
  const checkbox = page.locator(".leaflet-control-layers-overlays label")
    .filter({ hasText: "ขอบเขตตำบล" }).locator("input");
  await checkbox.check();
  await expect.poll(() => page.locator(".leaflet-overlay-pane path").count()).toBeGreaterThan(0);
  const featureCount = await page.locator(".leaflet-overlay-pane path").count();
  expect(overlayRequests).toHaveLength(1);
  await checkbox.uncheck();
  await expect.poll(() => page.locator(".leaflet-overlay-pane path").count()).toBe(0);
  await checkbox.check();
  await expect.poll(() => page.locator(".leaflet-overlay-pane path").count()).toBe(featureCount);
  expect(overlayRequests).toHaveLength(2);
  expect(forbidden).toEqual([]);
  expect(errors).toEqual([]);
});

test("mobile drawing HUD supports add, undo, cancellation, and centered reticle", async ({ page, context }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith("mobile"));
  const forbidden = await prepareContext(context);
  const errors = watchPageErrors(page);
  await openMap(page);
  await page.locator(".parcel-draw-button").click();
  const hud = page.locator("#mobile-parcel-draw-hud");
  await expect(hud).toBeVisible();
  const reticle = hud.locator(".mobile-parcel-draw-reticle");
  await expectVisualSnapshot(hud, "mobile-draw-empty.png");
  const before = await reticle.boundingBox();
  const viewport = page.viewportSize();
  expect(Math.abs(before.x + before.width / 2 - viewport.width / 2)).toBeLessThan(4);
  expect(Math.abs(before.y + before.height / 2 - viewport.height / 2)).toBeLessThan(4);
  await expect(hud.locator(".mobile-parcel-draw-undo")).toBeDisabled();
  await expect(hud.locator(".mobile-parcel-draw-finish")).toBeDisabled();
  await hud.locator(".mobile-parcel-draw-add").click();
  await expect(hud.locator(".mobile-parcel-draw-undo")).toBeEnabled();
  await panMap(page, 80, 0);
  const after = await reticle.boundingBox();
  expect(Math.abs(after.x - before.x)).toBeLessThan(2);
  expect(Math.abs(after.y - before.y)).toBeLessThan(2);
  await hud.locator(".mobile-parcel-draw-undo").click();
  await expect(hud.locator(".mobile-parcel-draw-undo")).toBeDisabled();
  await hud.locator(".mobile-parcel-draw-cancel").click();
  await expect(hud).toBeHidden();
  await page.locator(".parcel-draw-button").click();
  await expect(hud).toBeVisible();
  await hud.locator(".mobile-parcel-draw-cancel").click();
  expect(forbidden).toEqual([]);
  expect(errors).toEqual([]);
});

test("LIFF failure states do not expose authenticated controls", async ({ page, context }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith("mobile"));
  const forbidden = await prepareContext(context, { token: "", loggedIn: false });
  const errors = watchPageErrors(page);
  await openMap(page, true);
  await expect.poll(() => page.evaluate(() => window.MapLiffMode.getState())).toBe("ready-in-client-unauthenticated");
  await expect(page.locator("#saved-parcels-control-button")).toBeHidden();
  await expect(page.locator("#mobile-line-summary-button")).toBeHidden();
  expect(forbidden).toEqual([]);
  expect(errors).toEqual([]);
});
