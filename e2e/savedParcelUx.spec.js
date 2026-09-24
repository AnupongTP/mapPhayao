const { test, expect } = require("@playwright/test");
const {
  backendUrl,
  prepareContext,
  watchPageErrors,
  openMap,
  drawMobileParcel,
} = require("./support");

const token = "e2e-line-token-user-a";
const headers = { Authorization: `Bearer ${token}` };

async function expectHeaderIconAction(page, selector, iconClass, label, checkHover = false) {
  const button = page.locator(selector);
  await expect(button).toHaveAttribute("aria-label", label);
  await expect(button.locator(`i.fa-solid.${iconClass}`)).toBeVisible();
  const layout = await button.evaluate((element) => {
    const style = getComputedStyle(element);
    const bounds = element.getBoundingClientRect();
    const title = element.parentElement.querySelector("h2").getBoundingClientRect();
    const close = element.parentElement.querySelector(".result-panel-close").getBoundingClientRect();
    return {
      width: bounds.width,
      height: bounds.height,
      background: style.backgroundColor,
      border: style.borderWidth,
      shadow: style.boxShadow,
      titleRight: title.right,
      left: bounds.left,
      right: bounds.right,
      closeLeft: close.left,
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: innerWidth,
    };
  });
  expect(layout.width).toBeGreaterThanOrEqual(44);
  expect(layout.height).toBeGreaterThanOrEqual(44);
  expect(layout.background).toBe("rgba(0, 0, 0, 0)");
  expect(layout.border).toBe("0px");
  expect(layout.shadow).toBe("none");
  expect(layout.titleRight).toBeLessThanOrEqual(layout.left);
  expect(layout.right).toBeLessThanOrEqual(layout.closeLeft);
  expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth + 2);
  if (checkHover) {
    await button.hover();
    await expect.poll(() => button.evaluate((element) => getComputedStyle(element).backgroundColor))
      .not.toBe("rgba(0, 0, 0, 0)");
  }
}

function parcelPayload(name, index) {
  const offset = index * 0.0002;
  return {
    parcelName: name,
    cropType: index === 2 ? "maize" : "rice",
    riceVariety: index === 3 ? "TEST-UNIQUE-VARIETY" : "TEST-RICE",
    plantingDate: "2026-01-15",
    geometry: {
      type: "Polygon",
      coordinates: [[
        [99.889 + offset, 19.028],
        [99.890 + offset, 19.028],
        [99.890 + offset, 19.029],
        [99.889 + offset, 19.028],
      ]],
    },
  };
}

test("saved parcels share a scrollable list, show stored details, and survive a delete race", async ({ page, context, request }, testInfo) => {
  test.setTimeout(120000);
  if (testInfo.project.name.startsWith("mobile")) {
    await page.setViewportSize({ width: 360, height: 560 });
  }
  const forbidden = await prepareContext(context, { token });
  const errors = watchPageErrors(page);
  const ids = [];
  const createdParcels = [];
  const prefix = `UX-${testInfo.project.name}`;
  try {
    for (let index = 0; index < 8; index += 1) {
      const response = await request.post(`${backendUrl}/api/parcels`, {
        headers,
        data: parcelPayload(`${prefix}-${index}`, index),
      });
      expect(response.status()).toBe(201);
      const createdParcel = (await response.json()).parcel;
      ids.push(createdParcel.id);
      createdParcels.push(createdParcel);
    }

    await openMap(page, true);
    await expect.poll(() => page.evaluate(() => window.MapLiffMode.isReady())).toBe(true);
    const fontState = await page.evaluate(async () => {
      await document.fonts.ready;
      return {
        body: getComputedStyle(document.body).fontFamily,
        map: getComputedStyle(document.querySelector("#map")).fontFamily,
        regularLoaded: document.fonts.check("400 14px Sarabun"),
      };
    });
    expect(fontState.body).toContain("Sarabun");
    expect(fontState.map).toContain("Sarabun");
    expect(fontState.regularLoaded).toBe(true);
    await page.locator("#saved-parcels-control-button").click();
    const sheet = page.locator("#my-parcels-sheet");
    const list = sheet.locator("#my-parcels-list");
    await expect(list.locator(".saved-parcel-card").filter({ hasText: prefix })).toHaveCount(8);
    const originalOrder = await list.locator(".saved-parcel-card").evaluateAll((cards) =>
      cards.map((card) => card.dataset.parcelId));
    const listLayout = await list.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const header = document.querySelector("#my-parcels-sheet .parcel-sheet-header").getBoundingClientRect();
      return {
        scrollHeight: element.scrollHeight,
        clientHeight: element.clientHeight,
        overflow: getComputedStyle(element).overflowY,
        left: rect.left,
        right: rect.right,
        bottom: rect.bottom,
        headerBottom: header.bottom,
        documentWidth: document.documentElement.scrollWidth,
      };
    });
    expect(listLayout.scrollHeight).toBeGreaterThan(listLayout.clientHeight);
    expect(listLayout.overflow).toBe("auto");
    expect(listLayout.headerBottom).toBeLessThanOrEqual(listLayout.bottom);
    expect(listLayout.right).toBeLessThanOrEqual(page.viewportSize().width + 1);
    expect(listLayout.documentWidth).toBeLessThanOrEqual(page.viewportSize().width + 2);
    await list.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    await expect(sheet.getByRole("button", { name: "ปิด" })).toBeVisible();

    const search = sheet.locator("#my-parcels-search");
    const clearSearch = sheet.getByRole("button", { name: "ล้างคำค้น" });
    const listRequests = [];
    page.on("request", (requestItem) => {
      if (requestItem.url().endsWith("/api/parcels/mine")) listRequests.push(requestItem.url());
    });
    await search.fill(`${prefix}-3`);
    await expect(list.locator(".saved-parcel-card")).toHaveCount(1);
    await expect(list).toContainText(`${prefix}-3`);
    await search.fill(createdParcels[4].parcelCode);
    await expect(list.locator(".saved-parcel-card")).toHaveCount(1);
    await expect(list).toContainText(`${prefix}-4`);
    await search.fill("ข้าวโพด");
    await expect(list.locator(".saved-parcel-card")).toHaveCount(1);
    await expect(list).toContainText(`${prefix}-2`);
    await search.fill("test-unique-variety");
    await expect(list.locator(".saved-parcel-card")).toHaveCount(1);
    await expect(list).toContainText(`${prefix}-3`);
    await search.fill("NO-SUCH-PARCEL");
    await expect(list).toContainText("ไม่พบแปลงที่ตรงกับคำค้น");
    await clearSearch.click();
    await expect(list.locator(".saved-parcel-card").filter({ hasText: prefix })).toHaveCount(8);
    expect(listRequests).toHaveLength(0);

    const detailCard = list.locator(".saved-parcel-card").filter({ hasText: `${prefix}-0` });
    await detailCard.locator(".saved-parcel-header").click();
    const analysisRequests = [];
    page.on("request", (requestItem) => {
      if (/\/api\/(area-analysis\/polygon|parcels\/[^/]+\/analyze)/.test(requestItem.url())) {
        analysisRequests.push(requestItem.url());
      }
    });
    const detailAnalysis = page.waitForResponse((response) =>
      response.url().endsWith(`/api/parcels/${ids[0]}/analyze`) && response.request().method() === "POST");
    await detailCard.getByRole("button", { name: "รายละเอียด" }).click();
    expect((await detailAnalysis).status()).toBe(200);
    await expect(sheet).toBeHidden();
    const detailPanel = page.locator("#result-panel");
    await expect(detailPanel).toBeVisible();
    await expect(detailPanel.locator(".panel-header h2")).toHaveText("ผลการตรวจสอบพื้นที่แปลง");
    await expect(detailPanel).toContainText("ข้อมูลพื้นที่แปลง");
    await expect(detailPanel).toContainText(`${prefix}-0`);
    await expect(detailPanel).not.toContainText("อัปเดตล่าสุด");
    expect(analysisRequests).toHaveLength(1);
    await page.getByRole("button", { name: "ปิดหน้าต่างผลการตรวจสอบ" }).click();

    await page.locator("#saved-parcels-control-button").click();
    const editCard = list.locator(".saved-parcel-card").filter({ hasText: `${prefix}-0` });
    if (await editCard.locator(".saved-parcel-header").getAttribute("aria-expanded") === "false") {
      await editCard.locator(".saved-parcel-header").click();
    }
    await editCard.getByRole("button", { name: "รายละเอียด" }).click();
    await expect(detailPanel).toContainText("ข้อมูลพื้นที่แปลง");
    expect(analysisRequests).toHaveLength(1);
    await page.getByRole("button", { name: "ปิดหน้าต่างผลการตรวจสอบ" }).click();
    await page.locator("#saved-parcels-control-button").click();
    const storedCard = list.locator(`.saved-parcel-card[data-parcel-id="${ids[0]}"]`);
    if (await storedCard.locator(".saved-parcel-header").getAttribute("aria-expanded") === "false") {
      await storedCard.locator(".saved-parcel-header").click();
    }
    await storedCard.getByRole("button", { name: "ดูแปลง" }).click();
    await expect(detailPanel.locator(".panel-header h2")).toHaveText("ข้อมูลแปลงที่บันทึกไว้");
    await expect(detailPanel.locator("#saved-parcel-open-details")).toBeVisible();
    await expect(detailPanel.locator("#result-panel-return-button")).toBeVisible();
    await expectHeaderIconAction(page, "#result-panel-return-button", "fa-map", "กลับไปแปลงของฉัน", testInfo.project.name === "desktop-chromium");
    await detailPanel.locator("#saved-parcel-open-details").click();
    await expect(detailPanel.locator(".panel-header h2")).toHaveText("ผลการตรวจสอบพื้นที่แปลง");
    expect(analysisRequests).toHaveLength(1);
    await page.getByRole("button", { name: "ปิดหน้าต่างผลการตรวจสอบ" }).click();
    await page.locator("#saved-parcels-control-button").click();
    if (await storedCard.locator(".saved-parcel-header").getAttribute("aria-expanded") === "false") {
      await storedCard.locator(".saved-parcel-header").click();
    }
    await storedCard.getByRole("button", { name: "ดูแปลง" }).click();
    await expect(detailPanel.locator("#saved-parcel-open-details")).toBeVisible();
    await page.evaluate(() => window.MapParcelManagement.openMyParcelsSheet());
    await expect(sheet).toBeVisible();
    await search.fill(`${prefix}-7`);
    await expect(list.locator(".saved-parcel-card")).toHaveCount(1);
    await sheet.getByRole("button", { name: "ปิด" }).click();
    await detailPanel.locator("#result-panel-return-button").click();
    await expect(sheet).toBeVisible();
    await expect(search).toHaveValue("");
    await expect(list.locator(".saved-parcel-card").first()).toHaveAttribute("data-parcel-id", ids[0]);
    await expect(list.locator(".saved-parcel-card").first()).toHaveClass(/is-expanded/);
    await expect(list.locator(".saved-parcel-card").first()).toHaveClass(/is-focused/);
    await expect(list.locator(".saved-parcel-card").filter({ hasText: prefix })).toHaveCount(8);
    await search.fill(`${prefix}-7`);
    await clearSearch.click();
    expect(await list.locator(".saved-parcel-card").evaluateAll((cards) =>
      cards.map((card) => card.dataset.parcelId))).toEqual(originalOrder);
    const refreshedAnalysis = page.waitForResponse((response) =>
      response.url().endsWith(`/api/parcels/${ids[0]}/analyze`) && response.request().method() === "POST");
    await editCard.getByRole("button", { name: "วิเคราะห์ใหม่" }).click();
    expect((await refreshedAnalysis).status()).toBe(200);
    expect(analysisRequests).toHaveLength(2);
    await page.getByRole("button", { name: "ปิดหน้าต่างผลการตรวจสอบ" }).click();
    await page.locator("#saved-parcels-control-button").click();
    if (await editCard.locator(".saved-parcel-header").getAttribute("aria-expanded") === "false") {
      await editCard.locator(".saved-parcel-header").click();
    }
    await editCard.getByRole("button", { name: "แก้ไขข้อมูล" }).click();
    const editSheet = page.locator("#parcel-edit-sheet");
    await expect(editSheet).toBeVisible();
    expect(await editSheet.locator("#parcel-edit-name").evaluate((element) =>
      getComputedStyle(element).fontFamily)).toContain("Sarabun");
    const formLayout = await editSheet.evaluate((element) => {
      const sheetRect = element.querySelector(".parcel-sheet").getBoundingClientRect();
      const fields = element.querySelector(".parcel-form-fields");
      const fieldsRect = fields.getBoundingClientRect();
      const buttonsRect = element.querySelector(".parcel-sheet-actions").getBoundingClientRect();
      const controls = [...element.querySelectorAll("input, select")];
      return {
        sheetBottom: sheetRect.bottom,
        fieldsRight: fieldsRect.right,
        fieldsScrollHeight: fields.scrollHeight,
        fieldsClientHeight: fields.clientHeight,
        buttonsBottom: buttonsRect.bottom,
        maxControlRight: Math.max(...controls.map((control) => control.getBoundingClientRect().right)),
      };
    });
    expect(formLayout.maxControlRight).toBeLessThanOrEqual(formLayout.fieldsRight + 1);
    expect(formLayout.buttonsBottom).toBeLessThanOrEqual(formLayout.sheetBottom + 1);
    expect(formLayout.sheetBottom).toBeLessThanOrEqual(page.viewportSize().height + 1);
    if (testInfo.project.name.startsWith("mobile")) {
      expect(formLayout.fieldsScrollHeight).toBeGreaterThan(formLayout.fieldsClientHeight);
    }
    await editSheet.locator("#parcel-edit-planting-date").scrollIntoViewIfNeeded();
    await expect(editSheet.getByRole("button", { name: "ยกเลิก" })).toBeVisible();
    await expect(editSheet.locator("button[type=submit]")).toBeVisible();
    await editSheet.locator("#parcel-edit-name").fill(`${prefix}-EDITED`);
    await editSheet.locator("button[type=submit]").click();
    await expect(list).toContainText(`${prefix}-EDITED`);
    await expect(editSheet).toBeHidden();

    const deleteCard = list.locator(".saved-parcel-card").filter({ hasText: `${prefix}-1` });
    await deleteCard.locator(".saved-parcel-header").click();
    const analyzeRoute = /\/api\/parcels\/[^/]+\/analyze$/;
    let releaseAnalysis;
    const heldAnalysis = new Promise((resolve) => { releaseAnalysis = resolve; });
    await page.route(analyzeRoute, async (route) => {
      releaseAnalysis(route);
    });
    await deleteCard.getByRole("button", { name: "วิเคราะห์ใหม่" }).click();
    const pendingAnalysis = await heldAnalysis;
    await page.locator("#saved-parcels-control-button").click();
    const reopenedCard = list.locator(".saved-parcel-card").filter({ hasText: `${prefix}-1` });
    if (await reopenedCard.locator(".saved-parcel-header").getAttribute("aria-expanded") === "false") {
      await reopenedCard.locator(".saved-parcel-header").click();
    }
    await reopenedCard.getByRole("button", { name: "ลบ", exact: true }).click();
    const deleteResponse = page.waitForResponse((response) =>
      response.url().endsWith(`/api/parcels/${ids[1]}`) && response.request().method() === "DELETE");
    const canceledAnalysis = page.waitForEvent("requestfailed", (requestItem) =>
      requestItem.url().endsWith(`/api/parcels/${ids[1]}/analyze`));
    await page.locator("#parcel-delete-dialog").getByRole("button", { name: "ลบแปลง" }).click();
    expect((await deleteResponse).status()).toBe(200);
    expect((await canceledAnalysis).failure()).toBeTruthy();
    await expect(page.locator("#parcel-delete-dialog")).toBeHidden();
    await expect(list).not.toContainText(`${prefix}-1`);
    expect(pendingAnalysis.request().url()).toContain(`/api/parcels/${ids[1]}/analyze`);
    await expect(detailPanel).toBeHidden();
    await expect(page.getByText("ไม่พบแปลงนี้หรือไม่มีสิทธิ์เข้าถึง")).toHaveCount(0);
    await page.reload();
    await expect.poll(() => page.evaluate(() => window.MapLiffMode.isReady())).toBe(true);
    await page.locator("#saved-parcels-control-button").click();
    await expect(page.locator("#my-parcels-list")).not.toContainText(`${prefix}-1`);
    await expect(page.locator("#my-parcels-list")).toContainText(`${prefix}-EDITED`);
    expect(forbidden).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    for (const id of ids) {
      await request.delete(`${backendUrl}/api/parcels/${id}`, { headers }).catch(() => {});
    }
  }
});

test("a UI-drawn saved parcel deletes once without stale follow-up requests", async ({ page, context, request }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium");
  test.setTimeout(120000);
  const forbidden = await prepareContext(context, { token });
  const errors = watchPageErrors(page);
  await openMap(page, true);
  await expect.poll(() => page.evaluate(() => window.MapLiffMode.isReady())).toBe(true);

  const name = "E2E-UI-DELETE";
  await drawMobileParcel(page, name);
  await page.locator("#mobile-parcel-save-button").click();
  const saveSheet = page.locator("#parcel-save-sheet");
  await saveSheet.locator("#parcel-save-name").fill(name);
  const createdResponse = page.waitForResponse((response) =>
    response.url().endsWith("/api/parcels") && response.request().method() === "POST");
  await saveSheet.locator("button[type=submit]").click();
  const created = await createdResponse;
  expect(created.status()).toBe(201);
  const id = (await created.json()).parcel.id;
  await expect(saveSheet).toBeHidden();

  const requestsForParcel = [];
  page.on("request", (requestItem) => {
    if (requestItem.url().includes(`/api/parcels/${id}`)) {
      requestsForParcel.push(`${requestItem.method()} ${requestItem.url()}`);
    }
  });
  await page.locator("#saved-parcels-control-button").click();
  const list = page.locator("#my-parcels-list");
  const card = list.locator(".saved-parcel-card").filter({ hasText: name });
  await expect(card).toBeVisible();
  await card.locator(".saved-parcel-header").click();
  await card.getByRole("button", { name: "ลบ", exact: true }).click();
  const dialog = page.locator("#parcel-delete-dialog");
  await expect(dialog).toBeVisible();
  const deletedResponse = page.waitForResponse((response) =>
    response.url().endsWith(`/api/parcels/${id}`) && response.request().method() === "DELETE");
  await dialog.getByRole("button", { name: "ลบแปลง" }).click();
  expect((await deletedResponse).status()).toBe(200);
  await expect(dialog).toBeHidden();
  await expect(card).toHaveCount(0);
  await expect(page.locator("#result-panel")).toBeHidden();
  await expect(page.getByText("ไม่พบแปลงนี้หรือไม่มีสิทธิ์เข้าถึง")).toHaveCount(0);
  await page.waitForTimeout(500);
  expect(requestsForParcel).toEqual([`DELETE ${backendUrl}/api/parcels/${id}`]);
  await page.reload();
  await expect.poll(() => page.evaluate(() => window.MapLiffMode.isReady())).toBe(true);
  await expect(page.locator("#saved-parcels-control-button")).toBeHidden();
  const remaining = await request.get(`${backendUrl}/api/parcels/mine`, { headers });
  expect((await remaining.json()).parcels.map((item) => item.id)).not.toContain(id);
  expect(forbidden).toEqual([]);
  expect(errors).toEqual([]);
});

test("short mobile save sheet keeps controls reachable after drawing", async ({ page, context }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium");
  await page.setViewportSize({ width: 360, height: 560 });
  const forbidden = await prepareContext(context, { token });
  const errors = watchPageErrors(page);
  await openMap(page, true);
  await expect.poll(() => page.evaluate(() => window.MapLiffMode.isReady())).toBe(true);
  await drawMobileParcel(page, "UX-SAVE-FORM");
  await expect(page.locator("#result-panel .panel-header #mobile-parcel-save-button")).toBeVisible();
  await expectHeaderIconAction(page, "#mobile-parcel-save-button", "fa-floppy-disk", "บันทึกแปลง");
  await expect(page.locator("#result-panel-content #mobile-parcel-save-button")).toHaveCount(0);
  await expect(page.locator("#mobile-temporary-parcels-button")).toBeVisible();
  await page.locator("#mobile-parcel-save-button").click();
  const sheet = page.locator("#parcel-save-sheet");
  await expect(sheet).toBeVisible();
  const layout = await sheet.evaluate((element) => {
    const sheetRect = element.querySelector(".parcel-sheet").getBoundingClientRect();
    const fields = element.querySelector(".parcel-form-fields");
    const fieldRect = fields.getBoundingClientRect();
    const controls = [...element.querySelectorAll("input, select")];
    const actions = element.querySelector(".parcel-sheet-actions").getBoundingClientRect();
    return {
      sheetBottom: sheetRect.bottom,
      fieldsRight: fieldRect.right,
      controlsRight: Math.max(...controls.map((control) => control.getBoundingClientRect().right)),
      actionsBottom: actions.bottom,
      scrollHeight: fields.scrollHeight,
      clientHeight: fields.clientHeight,
    };
  });
  expect(layout.controlsRight).toBeLessThanOrEqual(layout.fieldsRight + 1);
  expect(layout.actionsBottom).toBeLessThanOrEqual(layout.sheetBottom + 1);
  expect(layout.sheetBottom).toBeLessThanOrEqual(page.viewportSize().height + 1);
  expect(layout.scrollHeight).toBeGreaterThan(layout.clientHeight);
  await sheet.getByRole("button", { name: "ยกเลิก" }).click();
  await expect(sheet).toBeHidden();
  expect(forbidden).toEqual([]);
  expect(errors).toEqual([]);
});
