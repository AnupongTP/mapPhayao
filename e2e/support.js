const { expect } = require("@playwright/test");

const frontendUrl = "http://127.0.0.1:4173";
const backendUrl = "http://127.0.0.1:3100";
const blankTile = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4////fwAJ+wP+ZQmR7wAAAABJRU5ErkJggg==",
  "base64",
);

async function expectVisualSnapshot(locator, name) {
  if (process.env.E2E_HEADED_MODE !== "1") {
    await expect(locator).toHaveScreenshot(name);
  }
}

async function prepareContext(context, { token, loggedIn = true, initFails = false } = {}) {
  const forbiddenRequests = [];
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (["data:", "blob:"].includes(url.protocol)) return route.continue();
    if (["mt1.google.com", "tile.openstreetmap.org"].includes(url.hostname)) {
      return route.fulfill({ status: 200, contentType: "image/png", body: blankTile });
    }
    if (url.protocol === "http:" && url.hostname === "127.0.0.1" && ["4173", "3100"].includes(url.port)) {
      return route.continue();
    }
    forbiddenRequests.push(url.href);
    return route.abort();
  });
  await context.addInitScript(({ tokenValue, isLoggedIn, shouldFail }) => {
    window.__MAP_PHAYAO_E2E_CONFIG__ = { apiBaseUrl: "http://127.0.0.1:3100/api" };
    if (tokenValue !== undefined) {
      window.liff = {
        init: async () => {
          if (shouldFail) throw new Error("Synthetic LIFF init failure");
        },
        isLoggedIn: () => isLoggedIn,
        isInClient: () => true,
        getIDToken: () => isLoggedIn ? tokenValue : null,
        closeWindow: () => {},
      };
    }
  }, { tokenValue: token, isLoggedIn: loggedIn, shouldFail: initFails });
  return forbiddenRequests;
}

function watchPageErrors(page) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

async function openMap(page, liff = false) {
  await page.goto(liff ? "/?liff=1" : "/");
  await expect(page.locator("#map")).toBeVisible();
  await page.waitForFunction(() => Boolean(window.appMap && window.appMap._loaded));
}

async function panMap(page, deltaX, deltaY) {
  const box = await page.locator("#map").boundingBox();
  const x = box.x + box.width * 0.5;
  const y = box.y + box.height * 0.5;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + deltaX, y + deltaY, { steps: 12 });
  await page.mouse.up();
}

async function drawMobileParcel(page, name) {
  await page.locator(".parcel-draw-button").click();
  const hud = page.locator("#mobile-parcel-draw-hud");
  await expect(hud).toBeVisible();
  await expect(hud.locator(".mobile-parcel-draw-finish")).toBeDisabled();
  await hud.locator(".mobile-parcel-draw-add").click();
  await panMap(page, 90, 0);
  await hud.locator(".mobile-parcel-draw-add").click();
  await panMap(page, 0, 90);
  await hud.locator(".mobile-parcel-draw-add").click();
  await expect(hud.locator(".mobile-parcel-draw-finish")).toBeEnabled();
  await hud.locator(".mobile-parcel-draw-finish").click();
  const modal = page.locator(".parcel-modal");
  await expect(modal).toBeVisible();
  await modal.locator('input[type="text"]').fill(name);
  const analysis = page.waitForResponse((response) => response.url().includes("/api/area-analysis/polygon"));
  await modal.getByRole("button", { name: "เริ่มวิเคราะห์" }).click();
  expect((await analysis).status()).toBe(200);
  await page.locator(".leaflet-popup").getByRole("button", { name: "เปิดรายละเอียด" }).click();
  await expect(page.locator("#mobile-parcel-save-button")).toBeVisible();
}

module.exports = {
  backendUrl,
  frontendUrl,
  prepareContext,
  watchPageErrors,
  openMap,
  panMap,
  drawMobileParcel,
  expectVisualSnapshot,
};
