const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const frontendRoot = path.resolve(__dirname, "..");
const indexSource = fs.readFileSync(path.join(frontendRoot, "index.html"), "utf8");
const managementSource = fs.readFileSync(path.join(frontendRoot, "js/parcel-management.js"), "utf8");
const mapSource = fs.readFileSync(path.join(frontendRoot, "js/map.js"), "utf8");
const uiSource = fs.readFileSync(path.join(frontendRoot, "js/ui.js"), "utf8");
const cssSource = fs.readFileSync(path.join(frontendRoot, "css/map.css"), "utf8");

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function createManagementHarness(options = {}) {
  const listCalls = [];
  const visibility = [];
  const loadedParcels = [];
  const state = {
    parcels: options.parcels || [],
    deferred: options.deferred || null,
  };
  const window = {
    MapFormatters: {
      getCropTypeLabel: (value) => value || "—",
      formatAreaRaiCompact: (value) => String(value ?? "—"),
      formatThaiDateOnly: (value) => value || "—",
      formatThaiDateTime: (value) => value || "—",
    },
    MapLiffMode: {
      isEnabled: () => true,
    },
    MapParcelState: {
      shouldAcceptListResponse: () => true,
    },
    MapApi: {
      listMyParcels: async () => {
        listCalls.push("listMyParcels");
        if (state.deferred) {
          return state.deferred.promise;
        }
        return { success: true, parcels: state.parcels };
      },
    },
    setTimeout,
    clearTimeout,
  };
  const document = {
    getElementById: () => null,
    createElement: () => ({
      append() {},
      appendChild() {},
      setAttribute() {},
      addEventListener() {},
      focus() {},
      remove() {},
      classList: { toggle() {} },
    }),
    body: {
      appendChild() {},
    },
    activeElement: null,
  };
  const context = {
    window,
    document,
    Promise,
    setTimeout,
    clearTimeout,
  };

  vm.createContext(context);
  vm.runInContext(managementSource, context);
  window.MapParcelManagement.init({
    onSavedParcelAvailabilityChange(value) {
      visibility.push(Boolean(value));
    },
    onParcelsLoaded(parcels) {
      loadedParcels.push(parcels);
      return { rendered: parcels.length, skipped: 0 };
    },
  });

  return {
    api: window.MapParcelManagement,
    listCalls,
    visibility,
    loadedParcels,
    setParcels(parcels) {
      state.parcels = parcels;
    },
    setDeferred(deferred) {
      state.deferred = deferred;
    },
  };
}

test("mobile LIFF parcel controls and sheets use stable IDs and active script order", () => {
  assert.match(indexSource, /css\/map\.css\?v=20260716-parcel-name-bottom-sheet/);
  assert.match(indexSource, /js\/parcel-state\.js\?v=20260716-liff-my-parcels/);
  assert.match(indexSource, /js\/formatters\.js\?v=20260716-my-parcels-display-fix/);
  assert.match(indexSource, /js\/api\.js\?v=20260716-saved-parcel-interaction-menu/);
  assert.match(indexSource, /js\/ui\.js\?v=20260716-parcel-button-state-separation/);
  assert.match(indexSource, /js\/parcel-management\.js\?v=20260716-parcel-button-state-separation/);
  assert.match(indexSource, /js\/map\.js\?v=20260717-flood-background-prefetch/);
  assert.ok(indexSource.indexOf("js/parcel-state.js") < indexSource.indexOf("js/parcel-management.js"));
  assert.ok(indexSource.indexOf("js/parcel-management.js") < indexSource.indexOf("js/map.js"));
  assert.match(managementSource, /mobile-parcel-save-button/);
  assert.match(managementSource, /parcel-save-sheet/);
  assert.match(managementSource, /my-parcels-sheet/);
  assert.match(managementSource, /idPrefix: "parcel-edit"/);
  assert.match(managementSource, /parcel-delete-dialog/);
});

test("save button is hidden before analysis and shown from successful parcel result wiring", () => {
  assert.match(mapSource, /parcel\.analysisStatus === "success"/);
  assert.match(mapSource, /renderTemporaryParcelSaveAction\(parcel\)/);
  assert.match(managementSource, /button\.disabled[\s\S]*canSaveAnalyzedParcel/);
  assert.match(managementSource, /id = "mobile-parcel-save-button"/);
});

test("my parcels button is visible only after authenticated LIFF readiness", () => {
  assert.match(managementSource, /Array\.isArray\(cachedParcels\) && cachedParcels\.length > 0/);
  assert.match(managementSource, /refreshSavedParcelsState\(\)/);
  assert.match(managementSource, /activeListRequest/);
  assert.match(mapSource, /MapLiffMode && window\.MapLiffMode\.isReady\(\)/);
  assert.match(mapSource, /MapParcelManagement\.setLiffReady\(liffReady\)/);
  assert.match(mapSource, /MapParcelManagement\.setLiffReady\(false\)/);
});

test("saved parcel control visibility follows owner-scoped list count", async () => {
  const harness = createManagementHarness({ parcels: [] });

  harness.api.setLiffReady(true);
  await harness.api.refreshSavedParcelsState();
  assert.equal(harness.listCalls.length, 1);
  assert.equal(harness.visibility.at(-1), false);

  harness.setParcels([{ id: "owned-a", parcelName: "A" }]);
  await harness.api.refreshSavedParcelsState();
  assert.equal(harness.listCalls.length, 2);
  assert.equal(harness.visibility.at(-1), true);

  harness.setParcels([]);
  await harness.api.refreshSavedParcelsState();
  assert.equal(harness.visibility.at(-1), false);
});

test("saved parcel list loading reuses a simultaneous authenticated request", async () => {
  const deferred = createDeferred();
  const harness = createManagementHarness({ deferred });

  harness.api.setLiffReady(true);
  const first = harness.api.refreshSavedParcelsState();
  const second = harness.api.refreshSavedParcelsState();
  assert.equal(harness.listCalls.length, 1);

  deferred.resolve({ success: true, parcels: [{ id: "owned-a" }] });
  await Promise.all([first, second]);
  assert.equal(harness.visibility.at(-1), true);
  assert.equal(harness.loadedParcels.at(-1).length, 1);
});

test("saved and temporary parcel navigation buttons have distinct labels, IDs, and actions", () => {
  assert.match(uiSource, /id = "saved-parcels-control-button"/);
  assert.match(uiSource, /id = "mobile-temporary-parcels-button"/);
  assert.match(uiSource, /"แปลงของฉัน"/);
  assert.match(uiSource, /"แปลงชั่วคราว"/);
  assert.match(uiSource, /"เปิดรายการแปลงที่บันทึกไว้"/);
  assert.match(uiSource, /"เปิดรายการแปลงชั่วคราวที่ยังไม่ได้บันทึก"/);
  assert.match(uiSource, /handlers\.onOpenSavedParcels\?\.\(\)/);
  assert.match(uiSource, /temporaryParcelButton\.addEventListener\("click", toggleTemporaryParcelPanel\)/);
  assert.doesNotMatch(managementSource, /mobile-my-parcels-button/);
});

test("forms, statuses, and destructive actions are accessible mobile controls", () => {
  assert.match(managementSource, /nameInput\.required = true/);
  assert.match(managementSource, /cropSelect\.required = true/);
  assert.match(managementSource, /dateInput\.type = "date"/);
  assert.match(managementSource, /setAttribute\("aria-live", "polite"\)/);
  assert.match(managementSource, /role", "dialog"/);
  assert.match(managementSource, /เมื่อลบแล้วจะไม่สามารถเรียกคืนได้/);
  assert.match(managementSource, /ต้องการลบแปลง/);
  assert.match(managementSource, /กรุณาเปิดระบบผ่าน LINE ใหม่อีกครั้ง/);
});

test("parcel name dialog is reused and becomes a mobile bottom sheet only", () => {
  const desktopCss = cssSource.slice(0, cssSource.indexOf("@media (max-width: 700px)"));

  assert.equal((uiSource.match(/function promptParcelName/g) || []).length, 1);
  assert.match(uiSource, /createElement\("div", "parcel-modal-backdrop"\)/);
  assert.match(uiSource, /createElement\("div", "parcel-modal"\)/);
  assert.match(uiSource, /input\.type = "text"/);
  assert.match(uiSource, /const cancelButton = createElement\("button", "panel-button secondary", "ยกเลิก"\)/);
  assert.match(uiSource, /options\?\.confirmText \|\| "บันทึก"/);
  assert.match(uiSource, /error\.textContent = TEXT\.parcelNameRequired/);
  assert.match(uiSource, /cancelButton\.addEventListener\("click", \(\) => close\(null\)\)/);
  assert.match(uiSource, /confirmButton\.addEventListener\("click", submit\)/);
  assert.match(mapSource, /title: "ตั้งชื่อพื้นที่แปลง"/);
  assert.match(mapSource, /confirmText: "เริ่มวิเคราะห์"/);

  assert.match(desktopCss, /\.parcel-modal-backdrop \{[\s\S]*align-items: center;[\s\S]*justify-content: center;/);
  assert.match(desktopCss, /\.parcel-modal \{[\s\S]*width: min\(420px, calc\(100vw - 32px\)\);/);
  assert.doesNotMatch(desktopCss, /\.parcel-modal \{[\s\S]*position: fixed;/);

  assert.match(cssSource, /@media \(max-width: 700px\) \{[\s\S]*\.parcel-modal-backdrop \{[\s\S]*position: fixed;[\s\S]*inset: 0;[\s\S]*z-index: 1400;[\s\S]*align-items: flex-end;[\s\S]*padding: 0;/);
  assert.match(cssSource, /@media \(max-width: 700px\) \{[\s\S]*\.parcel-modal \{[\s\S]*position: fixed;[\s\S]*top: auto;[\s\S]*right: calc\(12px \+ env\(safe-area-inset-right\)\);[\s\S]*bottom: 0;[\s\S]*left: calc\(12px \+ env\(safe-area-inset-left\)\);/);
  assert.match(cssSource, /@media \(max-width: 700px\) \{[\s\S]*\.parcel-modal \{[\s\S]*z-index: 1410;[\s\S]*max-height: min\(78dvh, calc\(100dvh - 24px\)\);[\s\S]*padding: 16px 16px calc\(16px \+ env\(safe-area-inset-bottom\)\);[\s\S]*overflow-y: auto;[\s\S]*border-radius: 14px 14px 0 0;[\s\S]*transform: none;[\s\S]*overscroll-behavior: contain;/);
  assert.doesNotMatch(cssSource, /\.parcel-delete-dialog[\s\S]*bottom: 0;/);
});

test("saved parcel UI renders safe fields only and never renders owner or LINE IDs", () => {
  assert.match(managementSource, /parcelName/);
  assert.match(managementSource, /cropType/);
  assert.match(managementSource, /riceVariety/);
  assert.match(managementSource, /plantingDate/);
  assert.match(managementSource, /areaRai/);
  assert.doesNotMatch(managementSource, /\b(ownerId|owner_id|ownerUserId|owner_user_id|lineUserId|line_user_id|userId|user_id|appUserId|app_user_id)\b/);
});

test("saved parcel map layers keep owned collection separate from selected state", () => {
  assert.match(mapSource, /const savedParcelLayers = new L\.FeatureGroup\(\)/);
  assert.match(mapSource, /const savedParcelLayerById = new Map\(\)/);
  assert.match(mapSource, /const savedParcelRecordById = new Map\(\)/);
  assert.match(mapSource, /const savedBoundaryEditLayers = new L\.FeatureGroup\(\)/);
  assert.match(mapSource, /let selectedSavedParcelId = null/);
  assert.match(mapSource, /const SAVED_PARCEL_SELECTED_STYLE =/);
  assert.match(mapSource, /function renderOwnedParcelLayers\(parcels\)/);
  assert.match(mapSource, /onParcelsLoaded: renderOwnedParcelLayers/);
  assert.match(mapSource, /selectedSavedParcelId = parcel\.id/);
  assert.doesNotMatch(
    mapSource.match(/function selectSavedParcelLayer\(parcel\) \{[\s\S]*?\n  \}/)[0],
    /clearLayers\(\)/,
  );
});

test("saved parcel cards are accordions with separated metadata and boundary actions", () => {
  assert.match(managementSource, /let expandedSavedParcelId = null/);
  assert.match(managementSource, /aria-expanded/);
  assert.match(managementSource, /aria-controls/);
  assert.match(managementSource, /actions\.hidden = !isExpanded/);
  assert.match(managementSource, /expandedSavedParcelId = isExpanded \? null : parcel\.id/);
  assert.match(managementSource, /handlers\.onEditBoundary\?\.\(parcel\)/);
  assert.match(managementSource, /formatters\.formatAreaRaiCompact\(parcel\.areaRai\)/);
  assert.match(managementSource, /formatters\.formatThaiDateOnly\(parcel\.plantingDate\)/);
  assert.match(managementSource, /formatters\.formatThaiDateTime\(parcel\.updatedAt \|\| parcel\.createdAt\)/);
  assert.doesNotMatch(managementSource, /innerHTML/);
});

test("saved boundary edit mode uses a separate editable layer and existing authenticated patch", () => {
  assert.match(mapSource, /function startSavedBoundaryEdit\(parcel\)/);
  assert.match(mapSource, /function createSavedBoundaryEditLayers\(geometry, parcelId\)/);
  assert.match(mapSource, /editLayers\.forEach\(\(editLayer\) => savedBoundaryEditLayers\.addLayer\(editLayer\)\)/);
  assert.match(mapSource, /editLayers\.forEach\(enableSavedBoundaryEditing\)/);
  assert.match(mapSource, /savedBoundaryEditState = \{/);
  assert.match(mapSource, /clearPendingPointSelectionForParcelEdit\(\)/);
  assert.match(mapSource, /window\.MapApi\.updateMyParcel\(state\.parcelId, \{ geometry \}\)/);
  assert.match(mapSource, /handleSavedParcelUpdated\(updatedParcel\)/);
  assert.match(mapSource, /savedBoundaryEditLayers\.clearLayers\(\)/);
  assert.match(mapSource, /getParcelInteractionMode\(\) !== "normal"/);
  assert.match(uiSource, /saveBoundary: "บันทึกขอบเขต"/);
});

test("saved boundary edit toolbar hides conflicting controls and keeps handles visible", () => {
  const editHandleCss = cssSource.match(/\.leaflet-editing-icon \{[\s\S]*?\}/)[0];
  assert.match(uiSource, /hideDraw/);
  assert.match(uiSource, /hideParcelList/);
  assert.match(mapSource, /clearPendingPointSelectionForParcelEdit\(\)/);
  assert.match(editHandleCss, /background: #ffffff/);
  assert.match(editHandleCss, /border: 2px solid #0f172a/);
  assert.doesNotMatch(editHandleCss, /display:\s*none/);
});

test("temporary parcel navigation visibility is driven only by local completed temporary parcels", () => {
  assert.match(uiSource, /function syncTemporaryParcelsUI\(parcelCount\)/);
  assert.match(uiSource, /parcelControlState\.hasTemporaryParcels = parcelCount > 0/);
  assert.match(uiSource, /renderTemporaryParcelList\(parcels, handlers\)/);
  assert.match(uiSource, /syncTemporaryParcelsUI\(parcelCount\)/);
  assert.match(uiSource, /temporaryParcelButton\.hidden =[\s\S]*!parcelControlState\.hasTemporaryParcels/);
  assert.doesNotMatch(
    uiSource.match(/function syncTemporaryParcelsUI\(parcelCount\) \{[\s\S]*?\n  \}/)[0],
    /savedParcelLayers|savedBoundaryEditLayers|listMyParcels|locationMarker|accuracyCircle/,
  );
});

test("saved parcel create, update, delete, and empty list refresh only persisted layers", () => {
  assert.match(mapSource, /async function refreshOwnedParcelLayersFromApi\(\)/);
  assert.match(mapSource, /window\.MapApi\.listMyParcels\(\)/);
  assert.match(mapSource, /window\.MapParcelManagement\.refreshSavedParcelsState\(\)/);
  assert.match(mapSource, /upsertSavedParcelLayer\(parcel\)/);
  assert.match(mapSource, /removeSavedParcelLayer\(parcelId\)/);
  assert.match(mapSource, /renderOwnedParcelLayers\(result\?\.parcels\)/);
});

test("existing point and transient parcel controls remain present", () => {
  assert.match(uiSource, /mobile-point-actions/);
  assert.match(uiSource, /mobile-point-confirm/);
  assert.match(uiSource, /temporary-parcel-panel/);
  assert.match(uiSource, /renderTemporaryParcelList/);
  assert.match(mapSource, /window\.MapApi\.analyzePolygonArea/);
  assert.match(mapSource, /new L\.Draw\.Polygon/);
});

test("mobile CSS uses bottom sheets, safe areas, and no horizontal overflow pattern", () => {
  assert.match(cssSource, /\.parcel-sheet-backdrop/);
  assert.match(cssSource, /env\(safe-area-inset-bottom\)/);
  assert.match(cssSource, /max-height: min\(78dvh, 720px\)/);
  assert.match(cssSource, /\.mobile-temporary-parcels-button:not\(\[hidden\]\)/);
  assert.match(cssSource, /width: min\(430px, calc\(100vw - 24px\)\)/);
});
