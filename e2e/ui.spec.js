const { test, expect } = require("@playwright/test");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { prepareContext, watchPageErrors, openMap, panMap, expectVisualSnapshot } = require("./support");

const photoFixture = readFileSync(path.resolve(__dirname, "../geoserver/data_dir/styles/grass_fill.png"));

test("public privacy page works without LIFF and map has no floating privacy link", async ({ page, context }) => {
  const forbidden = await prepareContext(context, { loggedIn: false });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("link", { name: "นโยบายความเป็นส่วนตัว" })).toHaveCount(0);
  await page.goto("/privacy.html");
  await expect(page).toHaveURL(/\/privacy\.html$/);
  await expect(page.getByRole("heading", { name: "นโยบายความเป็นส่วนตัว" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  expect(forbidden).toEqual([]);
});

test("direct parcel photos fail independently and share one fullscreen viewer", async ({ page, context }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium");
  const forbidden = await prepareContext(context);
  await page.setViewportSize({ width: 390, height: 844 });
  let releaseGood;
  const goodGate = new Promise((resolve) => { releaseGood = resolve; });
  let proxyCalls = 0;
  await page.route("**/api/parcels/*/images/*/content", (route) => {
    proxyCalls += 1;
    return route.abort();
  });
  await page.route(/^https:\/\/drive\.usercontent\.google\.com\/download\?/, async (route) => {
    if (new URL(route.request().url()).searchParams.get("id") === "bad") {
      return route.fulfill({ status: 404, body: "" });
    }
    await goodGate;
    return route.fulfill({ status: 200, contentType: "image/png", body: photoFixture });
  });
  await openMap(page);
  const links = ["bad", "good"].map((id) => `https://drive.usercontent.google.com/download?id=${id}&export=view`);
  await page.evaluate((urls) => window.MapUi.renderSavedParcelDetail({
    id: "11111111-1111-4111-8111-111111111111", parcelName: "DIRECT-LINK-TEST",
    photos: urls.map((linkImage, index) => ({ id: `${index}.webp`, linkImage, previewUrl: linkImage })),
  }), links);
  const result = page.locator("#result-panel-content");
  await expect(result).toContainText("DIRECT-LINK-TEST");
  await result.locator(".parcel-photo-section").scrollIntoViewIfNeeded();
  await expect(result).toContainText("โหลดรูปภาพ 1 ไม่สำเร็จ");
  await expect(result.locator(".parcel-photo-item")).toHaveCount(1);
  releaseGood();
  const good = result.locator(".parcel-photo-item");
  await expect(good).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath("direct-photos-mobile.png") });
  await good.click();
  const viewer = page.locator(".parcel-photo-viewer");
  await expect(viewer).toBeVisible();
  await expect(viewer.locator("img")).toHaveAttribute("src", links[1]);
  await page.screenshot({ path: testInfo.outputPath("photo-viewer-mobile.png") });
  const layering = await page.evaluate(() => ({
    overlay: parseInt(getComputedStyle(document.querySelector(".parcel-photo-viewer")).zIndex, 10),
    result: parseInt(getComputedStyle(document.querySelector("#result-panel")).zIndex, 10),
    position: getComputedStyle(document.querySelector(".parcel-photo-viewer")).position,
  }));
  expect(layering.position).toBe("fixed");
  expect(layering.overlay).toBeGreaterThan(layering.result);
  await viewer.locator("img").click();
  await expect(viewer).toBeVisible();
  await page.getByRole("button", { name: "ปิดรูปภาพ" }).click();
  await expect(viewer).toBeHidden();
  await good.click();
  await viewer.click({ position: { x: 5, y: 5 } });
  await expect(viewer).toBeHidden();
  await good.click();
  await page.keyboard.press("Escape");
  await expect(viewer).toBeHidden();
  await expect(viewer).toHaveCount(1);
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  expect(proxyCalls).toBe(0);
  expect(forbidden).toEqual([]);
});

test("mobile parcel weather and empty photo cards retain readable available and unavailable states", async ({ page, context }) => {
  const forbidden = await prepareContext(context);
  await page.setViewportSize({ width: 390, height: 844 });
  await openMap(page);
  const base = { name: "Test parcel", analysisStatus: "success", photos: [], analysis: {
    name: "Test parcel", parcel: { areaSquareMeters: 1600 },
    representativePoint: { latitude: 19.048892, longitude: 99.952551 },
    weather: { status: "AVAILABLE", temperatureC: 28.5,
      nextHourPrecipitationProbabilityPercent: 82, source: "Open-Meteo" },
  } };
  await page.evaluate((parcel) => window.MapUi.renderParcelResult(parcel), base);
  const result = page.locator("#result-panel-content");
  await expect(result.locator(".agricultural-weather-card")).toContainText("28.5");
  await expect(result.locator(".agricultural-weather-card")).toContainText("82%");
  await expect(result.locator(".parcel-photo-section")).toContainText("ยังไม่มีรูปภาพแปลง");
  await expect(result.locator(".parcel-photo-section")).toHaveClass(/parcel-result-card/);
  await expect(result).toContainText("19.048892, 99.952551");
  expect(await result.evaluate((node) => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(0);
  await page.evaluate((parcel) => window.MapUi.renderParcelResult(parcel), {
    ...base, analysis: { ...base.analysis, weather: { status: "UNAVAILABLE", source: "Open-Meteo" } },
  });
  await expect(result.locator(".agricultural-weather-card")).toContainText("ไม่สามารถโหลดข้อมูลสภาพอากาศได้ในขณะนี้");
  expect(forbidden).toEqual([]);
});

test("mobile point and parcel coordinates open a generic map destination without changing the result", async ({ page, context }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith("mobile"));
  const forbidden = await prepareContext(context);
  const errors = watchPageErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await openMap(page);
  await page.evaluate(() => {
    window.__coordinateMapClicks = 0;
    window.appMap.on("click", () => { window.__coordinateMapClicks += 1; });
  });
  const point = { latitude: 19.037525, longitude: 99.941463 };
  const android = testInfo.project.name === "mobile-chromium";
  const expectedHref = android
    ? "geo:19.037525,99.941463?q=19.037525,99.941463"
    : "https://www.openstreetmap.org/?mlat=19.037525&mlon=99.941463#map=16/19.037525/99.941463";
  const result = page.locator("#result-panel-content");
  async function checkCoordinate(label) {
    const row = result.locator(".result-field").filter({ has: page.locator(".result-label", { hasText: label }) }).first();
    const link = row.getByRole("link", { name: "เปิดพิกัด 19.037525, 99.941463 ในแผนที่" });
    await expect(link).toHaveText("19.037525, 99.941463");
    await expect(link).toHaveAttribute("href", expectedHref);
    await expect(link).toHaveClass(/coordinate-map-link/);
    const metrics = await link.evaluate((node) => {
      const box = node.getBoundingClientRect();
      const rowBox = node.closest(".result-field").getBoundingClientRect();
      return { height: box.height, left: box.left, right: box.right,
        rowLeft: rowBox.left, rowRight: rowBox.right,
        color: getComputedStyle(node).color };
    });
    expect(metrics.height).toBeGreaterThanOrEqual(44);
    expect(metrics.left).toBeGreaterThanOrEqual(metrics.rowLeft);
    expect(metrics.right).toBeLessThanOrEqual(metrics.rowRight + 1);
    expect(metrics.color).toBe("rgb(15, 118, 110)");
    await link.evaluate((node) => node.addEventListener("click", (event) => event.preventDefault(), { once: true }));
    await link.click();
    await expect(page.locator("#result-panel")).toBeVisible();
    expect(await page.evaluate(() => window.__coordinateMapClicks)).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  }

  await page.evaluate((representativePoint) => window.MapUi.renderParcelResult({
    name: "Temporary", analysisStatus: "success", photos: [],
    analysis: { name: "Temporary", parcel: { areaSquareMeters: 1000 }, representativePoint },
  }), point);
  await checkCoordinate("พิกัดแปลง");
  await expect(result.locator(".result-field").filter({ hasText: "ชื่อแปลง" }).getByRole("link")).toHaveCount(0);

  await page.evaluate((representativePoint) => window.MapUi.renderSavedParcelDetail({
    parcelName: "Saved", representativePoint,
  }), point);
  await checkCoordinate("พิกัดแปลง");

  await page.evaluate((clickedPoint) => window.MapUi.renderResultPanel({ clickedPoint }), point);
  await checkCoordinate("พิกัด");

  await page.evaluate(() => window.MapUi.renderSavedParcelDetail({
    parcelName: "Invalid", representativePoint: { latitude: 91, longitude: 99 },
  }));
  const invalidRow = result.locator(".result-field").filter({ hasText: "พิกัดแปลง" });
  await expect(invalidRow).toContainText("ไม่มีข้อมูล");
  await expect(invalidRow.getByRole("link")).toHaveCount(0);
  expect(forbidden).toEqual([]);
  expect(errors).toEqual([]);
});

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
  await page.setViewportSize({ width: 390, height: 844 });
  const scrolledHeader = await page.evaluate(() => {
    const list = document.querySelector(".is-mobile-drawer-open .leaflet-control-layers-list");
    const header = list.querySelector(".mobile-layer-drawer-header");
    const selector = list.querySelector(".leaflet-control-layers-selector");
    const headerBox = header.getBoundingClientRect();
    const selectorBox = selector.getBoundingClientRect();
    list.scrollTop = (selectorBox.top + selectorBox.height / 2) - (headerBox.top + headerBox.height / 2);
    const scrolledHeaderBox = header.getBoundingClientRect();
    const scrolledSelectorBox = selector.getBoundingClientRect();
    const selectorX = scrolledSelectorBox.left + scrolledSelectorBox.width / 2;
    const selectorY = scrolledSelectorBox.top + scrolledSelectorBox.height / 2;
    return {
      scrollTop: list.scrollTop,
      headerTop: scrolledHeaderBox.top,
      headerBottom: scrolledHeaderBox.bottom,
      selectorY,
      headerOnTop: header.contains(document.elementFromPoint(selectorX, selectorY)),
      headerBackground: getComputedStyle(header).backgroundColor,
      headerZIndex: getComputedStyle(header).zIndex,
      selectorZIndex: getComputedStyle(selector).zIndex,
    };
  });
  expect(scrolledHeader.scrollTop).toBeGreaterThan(0);
  expect(scrolledHeader.selectorY).toBeGreaterThan(scrolledHeader.headerTop);
  expect(scrolledHeader.selectorY).toBeLessThan(scrolledHeader.headerBottom);
  expect(scrolledHeader.headerOnTop).toBe(true);
  expect(scrolledHeader.headerBackground).toBe("rgb(255, 255, 255)");
  expect(Number(scrolledHeader.headerZIndex)).toBeGreaterThan(Number(scrolledHeader.selectorZIndex) || 0);
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
