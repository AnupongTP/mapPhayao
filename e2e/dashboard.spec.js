const { randomUUID } = require("node:crypto");
const { test, expect } = require("@playwright/test");
const db = require("../backend/src/config/database");
const { backendUrl, prepareContext } = require("./support");

const owner = { Authorization: "Bearer e2e-line-token-user-a" };
const geometry = { type: "Polygon", coordinates: [[
  [99.889, 19.028], [99.890, 19.028], [99.890, 19.029], [99.889, 19.028],
]] };

function priorBangkokDay() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok",
    year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(new Date(Date.now() - 86_400_000)).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

async function createParcel(request, crop) {
  const response = await request.post(`${backendUrl}/api/parcels`, { headers: owner,
    data: { parcelName: `Dashboard ${crop}`, cropType: crop, riceVariety: "KDML105",
      plantingDate: "2026-09-27", note: "private-dashboard-note", geometry } });
  expect(response.status()).toBe(201);
  const parcel = (await response.json()).parcel;
  expect((await request.post(`${backendUrl}/__e2e__/dashboard/invalidate`)).status()).toBe(200);
  return parcel;
}

test.beforeAll(() => {
  if (process.env.DB_HOST !== "127.0.0.1" || process.env.DB_PORT !== "55432" ||
    process.env.DB_NAME !== "mapphayao_e2e") throw new Error("Refusing non-local dashboard database");
});

test.beforeEach(async ({ request }) => {
  expect((await request.post(`${backendUrl}/__e2e__/dashboard/prune`)).status()).toBe(200);
});

test("public dashboard API classifies, filters and exposes only safe data", async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium");
  const crop = `dashboard-${randomUUID()}`;
  const parcel = await createParcel(request, crop);
  try {
    const query = `crop=${encodeURIComponent(crop)}&tambon=E2E`;
    const summaryResponse = await request.get(`${backendUrl}/api/public/dashboard/summary?${query}&days=7`);
    expect(summaryResponse.status()).toBe(200);
    const summary = await summaryResponse.json();
    expect(summary.summary.total).toBe(1);
    expect(summary.crops).toEqual([{ name: crop, count: 1 }]);
    expect(summary.daily).toHaveLength(7);
    expect(summary.daily.reduce((sum, item) => sum + item.count, 0)).toBe(1);
    expect(summary.filters.tambons).toContainEqual({ code: "E2E", name: "เวียง" });
    const pointsResponse = await request.get(`${backendUrl}/api/public/dashboard/points?${query}`);
    expect(pointsResponse.status()).toBe(200);
    const points = (await pointsResponse.json()).parcels;
    expect(points).toHaveLength(1);
    expect(points[0]).toMatchObject({ parcelId: parcel.parcelCode, crop, tambonCode: "E2E" });
    expect(points[0].lat).toBeGreaterThan(18);
    expect(points[0].lng).toBeGreaterThan(99);
    expect(JSON.stringify(points)).not.toMatch(/owner_user_id|private-dashboard-note|driveFileId|geometry/);
    const geometriesResponse = await request.get(`${backendUrl}/api/public/dashboard/geometries?${query}&bbox=99.88,19.02,99.90,19.04`);
    expect(geometriesResponse.status()).toBe(200);
    const features = (await geometriesResponse.json()).data.features;
    expect(features).toHaveLength(1);
    expect(features[0].geometry.type).toBe("MultiPolygon");
    expect(JSON.stringify(features)).not.toMatch(/owner_user_id|private-dashboard-note|driveFileId/);
    expect((await request.get(`${backendUrl}/api/public/dashboard/geometries?bbox=bad`)).status()).toBe(400);
    expect((await request.get(`${backendUrl}/api/public/dashboard/summary?days=9`)).status()).toBe(400);
    expect((await request.post(`${backendUrl}/api/public/dashboard/points`)).status()).toBe(404);
    expect((await request.get(`${backendUrl}/api/parcels/mine`)).status()).not.toBe(200);
  } finally {
    await request.delete(`${backendUrl}/api/parcels/${parcel.id}`, { headers: owner });
  }
});

test("Sheet collection date, unclassified tambon and filter synchronization use cached Sheet rows", async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium");
  const crop = `dashboard-${randomUUID()}`;
  const today = await createParcel(request, crop);
  const yesterday = await createParcel(request, crop);
  try {
    await db.query(`UPDATE app.parcels SET created_at = created_at - interval '1 day' WHERE id = $1`, [yesterday.id]);
    const beforeSheetChange = await (await request.get(`${backendUrl}/api/public/dashboard/summary?crop=${encodeURIComponent(crop)}`)).json();
    expect(beforeSheetChange.summary.today).toBe(2);
    expect((await request.post(`${backendUrl}/__e2e__/dashboard/parcel-cells`, { data: {
      code: yesterday.parcelCode, createdAt: `${priorBangkokDay()} 12:00:00`,
      coordinate: "19.090500, 99.950500",
      geometry: JSON.stringify({ type: "MultiPolygon", coordinates: [[[
        [99.95, 19.09], [99.951, 19.09], [99.951, 19.091], [99.95, 19.09],
      ]]] }),
    } })).status()).toBe(200);
    const filter = `crop=${encodeURIComponent(crop)}`;
    const summary = await (await request.get(`${backendUrl}/api/public/dashboard/summary?${filter}&days=7`)).json();
    expect(summary.summary).toMatchObject({ total: 2, today: 1, yesterday: 1, difference: 0, percentChange: 0 });
    expect(summary.daily.at(-1).count).toBe(1);
    expect(summary.daily.at(-2).count).toBe(1);
    expect(summary.filters.tambons).toContainEqual({ code: "__unclassified__", name: "ไม่ทราบตำบล" });
    const points = (await (await request.get(`${backendUrl}/api/public/dashboard/points?${filter}`)).json()).parcels;
    expect(points).toHaveLength(2);
    expect(points.find((point) => point.parcelId === yesterday.parcelCode).tambonCode).toBe("__unclassified__");
    for (const days of [14, 30]) {
      const result = await (await request.get(`${backendUrl}/api/public/dashboard/summary?${filter}&days=${days}`)).json();
      expect(result.daily).toHaveLength(days);
    }
    const unclassified = `${filter}&tambon=__unclassified__`;
    const onlyOne = await (await request.get(`${backendUrl}/api/public/dashboard/summary?${unclassified}`)).json();
    expect(onlyOne.summary).toMatchObject({ total: 1, today: 0, yesterday: 1 });
    expect(onlyOne.crops).toEqual([{ name: crop, count: 1 }]);
    expect((await (await request.get(`${backendUrl}/api/public/dashboard/points?${unclassified}`)).json()).parcels)
      .toHaveLength(1);
    const geo = await (await request.get(`${backendUrl}/api/public/dashboard/geometries?${unclassified}&bbox=99.94,19.08,99.96,19.10`)).json();
    expect(geo.data.features).toHaveLength(1);
    expect(geo.data.features[0].id).toBe(yesterday.parcelCode);
    const noGeo = await (await request.get(`${backendUrl}/api/public/dashboard/geometries?${unclassified}&bbox=99.88,19.02,99.90,19.04`)).json();
    expect(noGeo.data.features).toHaveLength(0);
  } finally {
    await request.delete(`${backendUrl}/api/parcels/${today.id}`, { headers: owner });
    await request.delete(`${backendUrl}/api/parcels/${yesterday.id}`, { headers: owner });
  }
});

test("public dashboard desktop and mobile layout, filters, refresh and lazy geometry", async ({ page, context, request }, testInfo) => {
  const crop = `dashboard-${randomUUID()}`;
  const parcel = await createParcel(request, crop);
  const forbidden = await prepareContext(context, { loggedIn: false });
  try {
    await page.goto("/dashboard.html");
    await expect(page.locator("#total-value")).not.toContainText("กำลังโหลด");
    await page.locator("#crop-filter").selectOption(crop);
    await expect(page.locator("#total-value")).toContainText("1");
    await expect(page.locator("#map-count")).toContainText("1");
    await expect(page.locator("#crop-legend")).toContainText(crop);
    await page.locator("[data-days='14']").click();
    await expect(page.locator("[data-days='14']")).toHaveAttribute("aria-pressed", "true");
    await page.locator("#refresh").click();
    await expect(page.locator("#updated-time")).toContainText("อัปเดตข้อมูลล่าสุด");
    await page.evaluate(() => window.MapDashboard.map.setView([19.0285, 99.8895], 15));
    await expect.poll(async () => page.locator(".leaflet-interactive").count()).toBeGreaterThan(0);
    await expect.poll(async () => page.evaluate(() => window.MapDashboard.map.getZoom())).toBe(15);
    await expect(page.locator(".parcel-pin")).toHaveCount(1);
    await page.locator(".parcel-pin").click();
    await expect(page.locator(".leaflet-popup-content")).toContainText(`Dashboard ${crop}`);
    await expect(page.locator(".leaflet-popup-content")).not.toContainText("private-dashboard-note");
    const metrics = await page.evaluate(() => ({ width: document.documentElement.scrollWidth,
      viewport: window.innerWidth, kpiTop: [...document.querySelectorAll(".kpi")].map((item) => Math.round(item.getBoundingClientRect().top)),
      mapWidth: document.getElementById("dashboard-map").getBoundingClientRect().width,
      overflow: [...document.querySelectorAll("body *")].map((node) => ({
        name: node.tagName, className: typeof node.className === "string" ? node.className : "",
        right: Math.round(node.getBoundingClientRect().right),
      })).filter((item) => item.right > window.innerWidth + 2).slice(0, 12) }));
    expect(metrics.width, JSON.stringify(metrics.overflow)).toBeLessThanOrEqual(metrics.viewport + 1);
    expect(metrics.mapWidth).toBeLessThanOrEqual(metrics.viewport);
    if (testInfo.project.name === "desktop-chromium") expect(new Set(metrics.kpiTop).size).toBe(1);
    else expect(new Set(metrics.kpiTop).size).toBe(3);
    expect(forbidden).toEqual([]);
  } finally {
    await request.delete(`${backendUrl}/api/parcels/${parcel.id}`, { headers: owner });
  }
});

test("rice and maize labels, crop icons, focused marker and Buddhist daily tooltip", async ({ page, context, request }, testInfo) => {
  const baseline = await (await request.get(`${backendUrl}/api/public/dashboard/summary?days=7`)).json();
  const rice = await createParcel(request, "rice");
  const maize = await createParcel(request, "maize");
  const forbidden = await prepareContext(context, { loggedIn: false });
  try {
    expect((await request.post(`${backendUrl}/__e2e__/dashboard/photo`, { data: {
      code: rice.parcelCode,
    } })).status()).toBe(200);
    expect((await request.post(`${backendUrl}/__e2e__/dashboard/parcel-cells`, { data: {
      code: maize.parcelCode, createdAt: `${priorBangkokDay()} 12:00:00`,
    } })).status()).toBe(200);
    const summary = await (await request.get(`${backendUrl}/api/public/dashboard/summary?days=7`)).json();
    const today = summary.daily.at(-1);
    const yesterday = summary.daily.at(-2);
    const riceCount = today.crops.find(({ name }) => name === "rice")?.count || 0;
    const maizeCount = yesterday.crops.find(({ name }) => name === "maize")?.count || 0;
    expect(riceCount).toBe((baseline.daily.at(-1).crops.find(({ name }) => name === "rice")?.count || 0) + 1);
    expect(maizeCount).toBe((baseline.daily.at(-2).crops.find(({ name }) => name === "maize")?.count || 0) + 1);
    expect(today.crops.reduce((total, item) => total + item.count, 0)).toBe(today.count);
    expect(yesterday.crops.reduce((total, item) => total + item.count, 0)).toBe(yesterday.count);
    await page.goto("/dashboard.html");
    await expect(page.locator(".dashboard-header h1")).toHaveText("FarmTeach Dashboard");
    await expect(page.locator(".dashboard-header")).not.toContainText("MAP PHAYAO");
    await expect(page.locator(".dashboard-header")).not.toContainText("แดชบอร์ดการลงพื้นที่");
    await expect(page.locator("#crop-filter option[value='rice']")).toHaveText("ข้าว");
    await expect(page.locator("#crop-filter option[value='maize']")).toHaveText("ข้าวโพด");
    await expect(page.locator("#crop-legend")).toContainText("ข้าว");
    await expect(page.locator("#crop-legend")).toContainText("ข้าวโพด");
    const chart = await page.evaluate(() => ({
      labels: window.MapDashboard.state.cropChart.data.labels,
      colors: window.MapDashboard.state.cropChart.data.datasets[0].backgroundColor,
    }));
    expect(chart.colors[chart.labels.indexOf("ข้าว")]).toBe("#14866d");
    expect(chart.colors[chart.labels.indexOf("ข้าวโพด")]).toBe("#e5a82a");
    await page.evaluate(() => {
      const bar = window.MapDashboard.state.dailyChart;
      const index = bar.data.labels.length - 1;
      bar.tooltip.setActiveElements([{ datasetIndex: 0, index }], { x: bar.width / 2, y: 75 });
      bar.update();
    });
    const dateParts = today.date.split("-").map(Number);
    const buddhistDate = `${String(dateParts[2]).padStart(2, "0")}/${String(dateParts[1]).padStart(2, "0")}/${dateParts[0] + 543}`;
    await expect(page.locator("#daily-tooltip")).toBeVisible();
    await expect(page.locator("#daily-tooltip")).toContainText(buddhistDate);
    await expect(page.locator("#daily-tooltip")).toContainText("ข้าว");
    await expect(page.locator("#daily-tooltip")).toContainText("ข้าวโพด");
    const tooltipRows = await page.locator("#daily-tooltip .daily-tooltip-row:not(.daily-tooltip-total)").evaluateAll((rows) => rows.map((row) => ({
      label: row.children[1].textContent,
      count: row.children[2].textContent,
      color: row.querySelector(".swatch").style.backgroundColor,
    })));
    expect(tooltipRows).toEqual(expect.arrayContaining([
      { label: "ข้าว", count: `${riceCount} แปลง`, color: "rgb(20, 134, 109)" },
    ]));
    await expect(page.locator("#daily-tooltip .daily-tooltip-total")).toContainText(`${today.count} แปลง`);
    await page.evaluate(() => {
      const bar = window.MapDashboard.state.dailyChart;
      bar.tooltip.setActiveElements([{ datasetIndex: 0, index: bar.data.labels.length - 2 }], { x: bar.width / 2, y: 75 });
      bar.update();
    });
    const yesterdayParts = yesterday.date.split("-").map(Number);
    await expect(page.locator("#daily-tooltip")).toContainText(`${String(yesterdayParts[2]).padStart(2, "0")}/${String(yesterdayParts[1]).padStart(2, "0")}/${yesterdayParts[0] + 543}`);
    await expect(page.locator("#daily-tooltip")).toContainText(`ข้าวโพด`);
    await expect(page.locator("#daily-tooltip .daily-tooltip-total")).toContainText(`${yesterday.count} แปลง`);
    const tooltip = await page.locator("#daily-tooltip").boundingBox();
    const viewport = page.viewportSize();
    expect(tooltip.x).toBeGreaterThanOrEqual(0);
    expect(tooltip.x + tooltip.width).toBeLessThanOrEqual(viewport.width + 1);
    await page.locator("#crop-filter").selectOption("rice");
    const riceTotal = summary.crops.find(({ name }) => name === "rice").count;
    await expect(page.locator("#total-value")).toContainText(String(riceTotal));
    const ricePoints = await (await request.get(`${backendUrl}/api/public/dashboard/points?crop=rice`)).json();
    await expect(page.locator("#map-count")).toContainText(String(ricePoints.parcels.length));
    const markerIcon = (code) => page.evaluate((parcelCode) => {
      let iconUrl = null;
      window.MapDashboard.map.eachLayer((layer) => {
        const markers = typeof layer.getLayers === "function" ? layer.getLayers()
          : typeof layer.getAllChildMarkers === "function" ? layer.getAllChildMarkers() : [];
        const target = markers.find((marker) => marker.options.title?.includes(parcelCode));
        if (target) iconUrl = target.options.icon.options.iconUrl;
      });
      return iconUrl;
    }, code);
    expect(await markerIcon("Dashboard rice")).toMatch(/assets\/dashboard\/rice\.svg$/);
    const search = page.locator("#parcel-search");
    await search.fill("Dashboard rice");
    await expect(page.locator("#parcel-search-results [role=option]")).toHaveCount(1);
    await page.locator("#parcel-search-results [role=option]").click();
    await expect.poll(async () => page.evaluate(() => window.MapDashboard.map.getZoom())).toBeGreaterThanOrEqual(16);
    await expect.poll(async () => page.evaluate(() => window.MapDashboard.state.selectedParcelId)).toBe(rice.parcelCode);
    await expect.poll(async () => page.evaluate(() => {
      const map = window.MapDashboard.map;
      const selected = window.MapDashboard.state.points.find((point) => point.parcelCode === window.MapDashboard.state.selectedParcelId);
      if (!selected) return false;
      const pixel = map.latLngToContainerPoint([selected.lat, selected.lng]);
      const size = map.getSize();
      return pixel.x >= 0 && pixel.x <= size.x && pixel.y >= 0 && pixel.y <= size.y;
    })).toBe(true);
    await expect(page.locator(".leaflet-popup-content")).toContainText("ข้าว");
    await expect(page.locator(".leaflet-popup-content")).not.toContainText("รหัส");
    await expect(page.locator(".leaflet-popup-content")).toContainText("27/09/2569");
    await expect(page.locator(".parcel-popup-photo img")).toBeVisible();
    await expect(page.locator(".parcel-popup-gallery-controls")).toHaveCount(0);
    expect(await page.locator(".parcel-popup-photo img").evaluate((image) => image.complete && image.naturalWidth > 0)).toBe(true);
    expect(await page.locator(".parcel-popup-photo img").getAttribute("src")).toMatch(/^blob:/);
    expect(await page.locator(".parcel-popup-photo img").getAttribute("src")).not.toMatch(/drive\.google|drive\.usercontent/);
    const coordinate = page.locator(".coordinate-link");
    await expect(coordinate).toBeVisible();
    const navigation = await coordinate.evaluate((link) => {
      const point = window.MapDashboard.state.points.find((item) => item.parcelCode === window.MapDashboard.state.selectedParcelId);
      const isAndroid = /Android/i.test(navigator.userAgent);
      return { actual: link.href, expected: window.MapFormatters.coordinateMapHref(point, { isAndroid }),
        target: link.target, rel: link.rel, height: link.getBoundingClientRect().height,
        isAndroid };
    });
    expect(navigation.actual).toBe(navigation.expected);
    expect(navigation.height).toBeGreaterThanOrEqual(44);
    if (navigation.isAndroid) {
      expect(navigation.actual).toMatch(/^geo:/);
      expect(navigation.target).toBe("");
    } else {
      expect(navigation.actual).toMatch(/^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=/);
      expect(navigation.target).toBe("_blank");
      expect(navigation.rel).toContain("noopener");
    }
    await coordinate.evaluate((link) => link.addEventListener("click", (event) => {
      window.dashboardNavigationClick = { href: link.href, defaultPrevented: event.defaultPrevented };
      event.preventDefault();
    }, { once: true }));
    await coordinate.click();
    expect(await page.evaluate(() => window.dashboardNavigationClick)).toEqual({
      href: navigation.expected, defaultPrevented: false,
    });
    await expect(page.locator(".leaflet-popup-content")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await expect.poll(async () => page.locator(".leaflet-interactive").count()).toBeGreaterThan(0);
    await expect.poll(async () => page.locator(".leaflet-interactive[stroke='#07543f']").count()).toBeGreaterThan(0);
    const searchResults = page.locator("#parcel-search-results");
    for (const term of ["Dashboard rice", "KDML105", "ข้าว", rice.parcelCode]) {
      await search.fill("");
      await expect(searchResults).toBeHidden();
      await search.fill(term);
      await expect(searchResults).toBeVisible();
      await expect.poll(async () => page.evaluate((code) =>
        window.MapDashboard.state.searchResults.some((result) => result.parcelCode === code), rice.parcelCode)).toBe(true);
    }
    await search.press("ArrowDown");
    await search.press("Enter");
    await expect(searchResults).toBeHidden();
    await expect(page.locator(".leaflet-popup-content")).toHaveCount(1);
    await expect(page.locator(".leaflet-popup-content")).toContainText("Dashboard rice");
    await expect(page.locator(".parcel-popup-photo img")).toBeVisible();
    await page.locator("#crop-filter").selectOption("maize");
    const maizeTotal = summary.crops.find(({ name }) => name === "maize").count;
    await expect(page.locator("#total-value")).toContainText(String(maizeTotal));
    const maizePoints = await (await request.get(`${backendUrl}/api/public/dashboard/points?crop=maize`)).json();
    expect(maizePoints.parcels.find((item) => item.parcelCode === maize.parcelCode).photoCount).toBe(0);
    await expect(page.locator("#map-count")).toContainText(String(maizePoints.parcels.length));
    await expect.poll(() => markerIcon("Dashboard maize")).toMatch(/assets\/dashboard\/maize\.svg$/);
    await search.fill("Dashboard rice");
    await expect(page.locator("#parcel-search-results [role=option]")).toHaveCount(0);
    await search.fill("ข้าวโพด");
    await expect.poll(async () => page.evaluate((code) =>
      window.MapDashboard.state.searchResults.some((result) => result.parcelCode === code), maize.parcelCode)).toBe(true);
    await search.fill("Dashboard maize");
    await expect(page.locator("#parcel-search-results [role=option]")).toHaveCount(1);
    await page.locator("#parcel-search-results [role=option]").click();
    await expect(page.locator(".leaflet-popup-content")).toHaveCount(1);
    await expect(page.locator(".leaflet-popup-content")).toContainText("Dashboard maize");
    await expect(page.locator(".parcel-popup-photo")).toContainText("ไม่มีรูปภาพ");
    await expect(page.locator(".parcel-popup-gallery-controls")).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    expect(forbidden).toEqual([]);
  } finally {
    await request.delete(`${backendUrl}/api/parcels/${rice.id}`, { headers: owner });
    await request.delete(`${backendUrl}/api/parcels/${maize.id}`, { headers: owner });
  }
});

test("selected photo popup survives map movement and geometry refresh until manually closed", async ({ page, context, request }, testInfo) => {
  const parcel = await createParcel(request, `dashboard-${randomUUID()}`);
  const forbidden = await prepareContext(context, { loggedIn: false });
  try {
    expect((await request.post(`${backendUrl}/__e2e__/dashboard/photo`, { data: {
      code: parcel.parcelCode,
    } })).status()).toBe(200);
    await page.goto(`/dashboard.html?crop=${encodeURIComponent(parcel.cropType)}`);
    await expect(page.locator("#map-count")).toContainText("1 แปลง");
    await page.evaluate(() => window.MapDashboard.map.setView([19.0285, 99.8895], 15));
    await page.locator(".parcel-pin").click();
    const popup = page.locator(".leaflet-popup-content");
    await expect(popup).toHaveCount(1);
    await expect(popup).toContainText(parcel.parcelName);
    await expect(page.locator(".parcel-popup-photo img")).toBeVisible();
    expect(await page.locator(".parcel-popup-photo img").evaluate((image) => image.complete && image.naturalWidth > 0)).toBe(true);
    const movedGeometry = page.waitForResponse((response) => response.url().includes("/api/public/dashboard/geometries?") && response.ok());
    await page.evaluate(() => window.MapDashboard.map.panBy([70, 0], { animate: false }));
    await movedGeometry;
    await expect(popup).toContainText(parcel.parcelName);
    await expect.poll(async () => page.locator(".leaflet-interactive[stroke='#07543f']").count()).toBeGreaterThan(0);
    await page.evaluate(() => window.MapDashboard.map.eachLayer((layer) => {
      if (typeof layer.getAllChildMarkers !== "function" && typeof layer.getLayers === "function" &&
        typeof layer.addLayers === "function") {
        const markers = layer.getLayers();
        layer.clearLayers();
        layer.addLayers(markers);
      }
    }));
    await expect(popup).toContainText(parcel.parcelName);
    const search = page.locator("#parcel-search");
    await search.fill(parcel.parcelName);
    await expect(page.locator("#parcel-search-results [role=option]")).toHaveCount(1);
    await page.locator("#parcel-search-results [role=option]").click();
    await expect(popup).toHaveCount(1);
    await expect(popup).toContainText(parcel.parcelName);
    const movedAgain = page.waitForResponse((response) => response.url().includes("/api/public/dashboard/geometries?") && response.ok());
    await page.evaluate(() => window.MapDashboard.map.panBy([-55, 0], { animate: false }));
    await movedAgain;
    await expect(popup).toContainText(parcel.parcelName);
    if (testInfo.project.name !== "desktop-chromium") {
      const viewport = page.viewportSize();
      await expect.poll(async () => {
        const bounds = await page.locator(".leaflet-popup").boundingBox();
        return bounds.x >= -1 && bounds.x + bounds.width <= viewport.width + 1;
      }).toBe(true);
    }
    const closeButton = page.locator(".leaflet-popup-close-button");
    const closeHit = () => closeButton.evaluate((button) => {
      const box = button.getBoundingClientRect();
      const element = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      const popupBox = button.closest(".leaflet-popup").getBoundingClientRect();
      const mapBox = document.getElementById("dashboard-map").getBoundingClientRect();
      return { onButton: element?.closest(".leaflet-popup-close-button") === button,
        hitClass: String(element?.className || ""), searchOpen: document.querySelector(".map-search")?.classList.contains("is-open"),
        buttonY: Math.round(box.top), mapY: Math.round(mapBox.top), mapHeight: Math.round(mapBox.height),
        popupY: Math.round(popupBox.top), popupHeight: Math.round(popupBox.height) };
    });
    await expect.poll(async () => (await closeHit()).onButton, { timeout: 3000 }).toBe(true);
    await closeButton.click({ timeout: 5000 });
    await expect(popup).toHaveCount(0);
    const afterClose = page.waitForResponse((response) => response.url().includes("/api/public/dashboard/geometries?") && response.ok());
    await page.evaluate(() => window.MapDashboard.map.panBy([45, 0], { animate: false }));
    await afterClose;
    await expect(popup).toHaveCount(0);
    expect(forbidden).toEqual([]);
  } finally {
    await request.delete(`${backendUrl}/api/parcels/${parcel.id}`, { headers: owner });
  }
});

test("multi-photo popup preloads sequentially, caches successes, and isolates a failed image", async ({ page, context, request }, testInfo) => {
  const parcel = await createParcel(request, `gallery-${randomUUID()}`);
  const forbidden = await prepareContext(context, { loggedIn: false });
  const imageRequests = [];
  let releaseThird;
  const thirdGate = new Promise((resolve) => { releaseThird = resolve; });
  await page.route((url) => url.pathname.endsWith(`/api/public/dashboard/images/${parcel.parcelCode}/2`),
    async (route) => { await thirdGate; await route.continue(); });
  page.on("request", (item) => {
    if (item.url().includes(`/api/public/dashboard/images/${parcel.parcelCode}/`)) imageRequests.push(item.url());
  });
  const requestsFor = (index) => imageRequests.filter((url) => new URL(url).pathname.endsWith(`/${index}`)).length;
  try {
    expect((await request.post(`${backendUrl}/__e2e__/dashboard/photo`, { data: {
      code: parcel.parcelCode, count: 3, failIndex: 1,
    } })).status()).toBe(200);
    await page.goto(`/dashboard.html?crop=${encodeURIComponent(parcel.cropType)}`);
    await expect(page.locator("#map-count")).toContainText("1 แปลง");
    await page.evaluate(() => window.MapDashboard.map.setView([19.0285, 99.8895], 15));
    await page.locator(".parcel-pin").click();
    const popup = page.locator(".leaflet-popup-content");
    const photo = popup.locator(".parcel-popup-photo");
    const previous = popup.getByRole("button", { name: "รูปก่อนหน้า" });
    const next = popup.getByRole("button", { name: "รูปถัดไป" });
    const counter = popup.locator(".parcel-popup-gallery-counter");
    await expect(popup).toContainText(parcel.parcelName);
    await expect(counter).toHaveText("1 / 3");
    await expect(previous).toBeDisabled();
    await expect(photo.locator("img")).toBeVisible();
    expect(requestsFor(0)).toBe(1);
    await expect.poll(() => requestsFor(1)).toBe(3);
    await expect.poll(() => requestsFor(2)).toBe(1);
    const thirdPhotoRequest = imageRequests.findIndex((url) => new URL(url).pathname.endsWith("/2"));
    expect(thirdPhotoRequest).toBeGreaterThan(0);
    expect(imageRequests.slice(0, thirdPhotoRequest).filter((url) => new URL(url).pathname.endsWith("/1"))).toHaveLength(3);
    await next.click();
    await expect(counter).toHaveText("2 / 3");
    await expect(photo).toContainText("โหลดรูปไม่สำเร็จ");
    await next.click();
    await expect(counter).toHaveText("3 / 3");
    await expect(photo.locator(".parcel-popup-photo-spinner")).toBeVisible();
    await previous.click();
    await expect(counter).toHaveText("2 / 3");
    releaseThird();
    await expect(photo).toContainText("โหลดรูปไม่สำเร็จ");
    await next.click();
    await expect(next).toBeDisabled();
    await expect(photo.locator("img")).toBeVisible();
    await previous.click();
    await expect(photo).toContainText("โหลดรูปไม่สำเร็จ");
    await previous.click();
    await expect(photo.locator("img")).toBeVisible();
    expect([0, 1, 2].map(requestsFor)).toEqual([1, 3, 1]);
    await expect(previous.locator("i.fa-chevron-left")).toBeVisible();
    await expect(next.locator("i.fa-chevron-right")).toBeVisible();
    const nextStyle = await next.evaluate((button) => ({
      background: getComputedStyle(button).backgroundColor,
      borderWidth: getComputedStyle(button).borderTopWidth,
      width: button.getBoundingClientRect().width,
    }));
    expect(nextStyle).toMatchObject({ background: "rgba(0, 0, 0, 0)", borderWidth: "0px" });
    expect(nextStyle.width).toBeGreaterThanOrEqual(40);
    if (testInfo.project.name !== "desktop-chromium") {
      await page.evaluate(() => {
        const target = document.querySelector(".parcel-popup-photo");
        const touch = (type, x) => {
          const event = new Event(type, { bubbles: true });
          const point = { clientX: x, clientY: 200 };
          Object.defineProperties(event, {
            changedTouches: { value: [point] },
            touches: { value: type === "touchstart" ? [point] : [] },
          });
          target.dispatchEvent(event);
        };
        touch("touchstart", 190);
        touch("touchend", 80);
      });
      await expect(counter).toHaveText("2 / 3");
    }
    await next.click();
    await expect(counter).toHaveText(testInfo.project.name === "desktop-chromium" ? "2 / 3" : "3 / 3");
    if (testInfo.project.name === "desktop-chromium") await next.click();
    await expect(counter).toHaveText("3 / 3");
    const mapBefore = await page.evaluate(() => {
      const map = window.MapDashboard.map;
      return { zoom: map.getZoom(), center: map.getCenter() };
    });
    await previous.click();
    await next.click();
    const mapAfter = await page.evaluate(() => {
      const map = window.MapDashboard.map;
      return { zoom: map.getZoom(), center: map.getCenter() };
    });
    expect(mapAfter).toEqual(mapBefore);
    expect([0, 1, 2].map(requestsFor)).toEqual([1, 3, 1]);
    const moved = page.waitForResponse((response) => response.url().includes("/api/public/dashboard/geometries?") && response.ok());
    await page.evaluate(() => window.MapDashboard.map.panBy([70, 0], { animate: false }));
    await moved;
    await expect(counter).toHaveText("3 / 3");
    await expect(photo.locator("img")).toBeVisible();
    const search = page.locator("#parcel-search");
    await search.fill(parcel.parcelName);
    await expect(page.locator("#parcel-search-results [role=option]")).toHaveCount(1);
    await page.locator("#parcel-search-results [role=option]").click();
    await expect(popup).toHaveCount(1);
    await expect(counter).toHaveText("1 / 3");
    await expect(photo.locator("img")).toBeVisible();
    expect(requestsFor(0)).toBe(1);
    if (testInfo.project.name !== "desktop-chromium") {
      const viewport = page.viewportSize();
      await expect.poll(async () => {
        const bounds = await page.locator(".leaflet-popup").boundingBox();
        return bounds.x >= -1 && bounds.x + bounds.width <= viewport.width + 1;
      }).toBe(true);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await next.click();
    await expect(photo).toContainText("โหลดรูปไม่สำเร็จ");
    const beforeRetry = requestsFor(1);
    await photo.getByRole("button", { name: "ลองอีกครั้ง" }).click();
    await expect(photo).toContainText("โหลดรูปไม่สำเร็จ");
    await expect.poll(() => requestsFor(1)).toBe(beforeRetry + 3);
    await page.locator(".leaflet-popup-close-button").click();
    await expect(popup).toHaveCount(0);
    expect(forbidden).toEqual([]);
  } finally {
    releaseThird();
    await request.delete(`${backendUrl}/api/parcels/${parcel.id}`, { headers: owner });
  }
});

test("closing a popup during an image read prevents stale rendering on reopen", async ({ page, context, request }) => {
  const parcel = await createParcel(request, `gallery-close-${randomUUID()}`);
  await prepareContext(context, { loggedIn: false });
  const imagePath = `/api/public/dashboard/images/${parcel.parcelCode}/0`;
  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  let requests = 0;
  await page.route((url) => url.pathname.endsWith(imagePath), async (route) => {
    requests += 1;
    if (requests === 1) await firstGate;
    try { await route.continue(); } catch (error) {
      if (!/closed|aborted|disposed|canceled/i.test(error.message)) throw error;
    }
  });
  try {
    expect((await request.post(`${backendUrl}/__e2e__/dashboard/photo`, { data: {
      code: parcel.parcelCode, count: 1,
    } })).status()).toBe(200);
    await page.goto(`/dashboard.html?crop=${encodeURIComponent(parcel.cropType)}`);
    await expect(page.locator("#map-count")).toContainText("1 แปลง");
    await page.evaluate(() => window.MapDashboard.map.setView([19.0285, 99.8895], 15));
    await page.locator(".parcel-pin").click();
    await expect(page.locator(".parcel-popup-photo-spinner")).toBeVisible();
    await expect.poll(() => requests).toBe(1);
    await page.locator(".leaflet-popup-close-button").click();
    releaseFirst();
    await expect(page.locator(".leaflet-popup-content")).toHaveCount(0);
    await page.locator(".parcel-pin").click();
    await expect(page.locator(".parcel-popup-photo img")).toBeVisible();
    expect(requests).toBeLessThanOrEqual(2);
  } finally {
    releaseFirst();
    await request.delete(`${backendUrl}/api/parcels/${parcel.id}`, { headers: owner });
  }
});

test("gallery retries transient image reads twice without duplicate loads", async ({ page, context, request }) => {
  const parcel = await createParcel(request, `gallery-retry-${randomUUID()}`);
  await prepareContext(context, { loggedIn: false });
  let attempts = 0;
  await page.route((url) => url.pathname.endsWith(`/api/public/dashboard/images/${parcel.parcelCode}/0`),
    async (route) => {
      attempts += 1;
      if (attempts <= 2) {
        await route.fulfill({ status: 503, headers: {
          "access-control-allow-origin": new URL(page.url()).origin,
        }, body: "" });
      } else {
        await route.continue();
      }
    });
  try {
    expect((await request.post(`${backendUrl}/__e2e__/dashboard/photo`, { data: {
      code: parcel.parcelCode, count: 1,
    } })).status()).toBe(200);
    await page.goto(`/dashboard.html?crop=${encodeURIComponent(parcel.cropType)}`);
    await expect(page.locator("#map-count")).toContainText("1 แปลง");
    await page.evaluate(() => window.MapDashboard.map.setView([19.0285, 99.8895], 15));
    await page.locator(".parcel-pin").click();
    await expect(page.locator(".parcel-popup-photo-spinner")).toBeVisible();
    await expect(page.locator(".parcel-popup-photo img")).toBeVisible();
    expect(attempts).toBe(3);
    await page.locator(".leaflet-popup-close-button").click();
    await page.locator(".parcel-pin").click();
    await expect(page.locator(".parcel-popup-photo img")).toBeVisible();
    expect(attempts).toBe(3);
  } finally {
    await request.delete(`${backendUrl}/api/parcels/${parcel.id}`, { headers: owner });
  }
});

test("polygon popup survives its layer being refreshed after map movement", async ({ page, context, request }) => {
  const parcel = await createParcel(request, `dashboard-${randomUUID()}`);
  await prepareContext(context, { loggedIn: false });
  try {
    await page.goto(`/dashboard.html?crop=${encodeURIComponent(parcel.cropType)}`);
    await expect(page.locator("#map-count")).toContainText("1 แปลง");
    await page.evaluate(() => window.MapDashboard.map.setView([19.0285, 99.8895], 15));
    await expect.poll(async () => page.evaluate((code) => {
      let found = false;
      window.MapDashboard.map.eachLayer((group) => group.eachLayer?.((layer) => {
        if (layer.feature?.properties?.parcelCode === code) found = true;
      }));
      return found;
    }, parcel.parcelCode)).toBe(true);
    await page.evaluate((code) => {
      window.MapDashboard.map.eachLayer((group) => group.eachLayer?.((layer) => {
        if (layer.feature?.properties?.parcelCode === code) layer.fire("click");
      }));
    }, parcel.parcelCode);
    await expect(page.locator(".leaflet-popup-content")).toContainText(parcel.parcelName);
    const geometryUpdated = page.waitForResponse((response) => response.url().includes("/api/public/dashboard/geometries?") && response.ok());
    await page.evaluate(() => window.MapDashboard.map.panBy([70, 0], { animate: false }));
    await geometryUpdated;
    await expect(page.locator(".leaflet-popup-content")).toContainText(parcel.parcelName);
  } finally {
    await request.delete(`${backendUrl}/api/parcels/${parcel.id}`, { headers: owner });
  }
});

test("loading, stale filter response and failed refresh preserve the last successful view", async ({ page, context }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium");
  const forbidden = await prepareContext(context, { loggedIn: false });
  let fail = false;
  const summary = (crop) => ({ success: true, updatedAt: new Date().toISOString(),
    filters: { selected: { tambon: null, crop: crop || null, days: 7 }, tambons: [], crops: ["rice", "maize"] },
    summary: { total: crop === "maize" ? 3 : crop === "rice" ? 20 : 10,
      today: 0, yesterday: 0, difference: 0, percentChange: null },
    crops: crop ? [{ name: crop, count: crop === "maize" ? 3 : 20 }] : [{ name: "rice", count: 10 }],
    daily: Array.from({ length: 7 }, (_, index) => ({ date: `2026-09-${String(21 + index).padStart(2, "0")}`, count: 0 })) });
  await page.route("**/api/public/dashboard/**", async (route) => {
    const url = new URL(route.request().url());
    const crop = url.searchParams.get("crop");
    if (fail) return route.fulfill({ status: 503, body: "unavailable" });
    if (crop === "rice") await new Promise((resolve) => setTimeout(resolve, 500));
    if (!crop && url.pathname.endsWith("/summary")) await new Promise((resolve) => setTimeout(resolve, 300));
    try {
      return await route.fulfill({ status: 200, contentType: "application/json",
        body: JSON.stringify(url.pathname.endsWith("/points") ? { success: true, parcels: [] } : summary(crop)) });
    } catch (error) {
      if (!/closed|aborted|disposed/i.test(error.message)) throw error;
    }
  });
  await page.goto("/dashboard.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#total-value")).toContainText("กำลังโหลด");
  await expect(page.locator("#total-value")).toContainText("10");
  await page.locator("#crop-filter").selectOption("rice");
  await page.locator("#crop-filter").selectOption("maize");
  await expect(page.locator("#total-value")).toContainText("3");
  await page.waitForTimeout(650);
  await expect(page.locator("#total-value")).toContainText("3");
  const timestamp = await page.locator("#updated-time").textContent();
  fail = true;
  await page.locator("#refresh").click();
  await expect(page.locator("#dashboard-error")).toBeVisible();
  await expect(page.locator("#total-value")).toContainText("3");
  expect(await page.locator("#updated-time").textContent()).toBe(timestamp);
  fail = false;
  await page.goto("/dashboard.html?crop=unlisted");
  await expect(page.locator("#crop-filter")).toHaveValue("unlisted");
  expect(forbidden).toEqual([]);
});

test("local dashboard query, payload and marker clusters on 121 disposable parcels", async ({ request, page, context }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium");
  const suffix = randomUUID().slice(0, 8);
  const crop = `dashboard-perf-${suffix}`;
  const base = await createParcel(request, crop);
  try {
    expect((await request.post(`${backendUrl}/__e2e__/dashboard/seed`, { data: {
      suffix, crop, count: 120,
    } })).status()).toBe(200);
    const results = {};
    for (const [name, query] of [
      ["summary", `summary?crop=${crop}&days=7`],
      ["points", `points?crop=${crop}`],
      ["geometries", `geometries?crop=${crop}&bbox=99.84,18.98,99.94,19.08`],
    ]) {
      const started = performance.now();
      const response = await request.get(`${backendUrl}/api/public/dashboard/${query}`);
      const body = await response.body();
      results[name] = { ms: Math.round(performance.now() - started), bytes: body.length };
      expect(response.status()).toBe(200);
      const data = JSON.parse(body.toString("utf8"));
      if (name === "summary") expect(data.summary.total).toBe(121);
      if (name === "points") expect(data.parcels).toHaveLength(121);
      if (name === "geometries") expect(data.data.features).toHaveLength(121);
    }
    console.log("dashboard-disposable-local-measurement", results);
    const forbidden = await prepareContext(context, { loggedIn: false });
    await page.goto("/dashboard.html");
    await page.locator("#crop-filter").selectOption(crop);
    await expect(page.locator("#map-count")).toContainText("121");
    await expect(page.locator(".parcel-cluster").first()).toBeVisible();
    expect(forbidden).toEqual([]);
  } finally {
    await request.delete(`${backendUrl}/api/parcels/${base.id}`, { headers: owner });
  }
});
