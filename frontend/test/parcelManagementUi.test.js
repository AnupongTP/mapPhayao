const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const frontendRoot = path.resolve(__dirname, "..");
const indexSource = fs.readFileSync(path.join(frontendRoot, "index.html"), "utf8");
const managementSource = fs.readFileSync(path.join(frontendRoot, "js/parcel-management.js"), "utf8");
const mapSource = fs.readFileSync(path.join(frontendRoot, "js/map.js"), "utf8");
const uiSource = fs.readFileSync(path.join(frontendRoot, "js/ui.js"), "utf8");
const cssSource = fs.readFileSync(path.join(frontendRoot, "css/map.css"), "utf8");

test("mobile LIFF parcel controls and sheets use stable IDs and active script order", () => {
  assert.match(indexSource, /js\/parcel-state\.js\?v=20260716-liff-my-parcels/);
  assert.match(indexSource, /js\/parcel-management\.js\?v=20260716-liff-my-parcels/);
  assert.ok(indexSource.indexOf("js/parcel-state.js") < indexSource.indexOf("js/parcel-management.js"));
  assert.ok(indexSource.indexOf("js/parcel-management.js") < indexSource.indexOf("js/map.js"));
  assert.match(managementSource, /mobile-my-parcels-button/);
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
  assert.match(managementSource, /button\.hidden = !\(isLiffEnabled\(\) && liffReady\)/);
  assert.match(mapSource, /MapParcelManagement\.setLiffReady\(true\)/);
  assert.match(mapSource, /MapParcelManagement\.setLiffReady\(false\)/);
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

test("saved parcel UI renders safe fields only and never renders owner or LINE IDs", () => {
  assert.match(managementSource, /parcelName/);
  assert.match(managementSource, /cropType/);
  assert.match(managementSource, /riceVariety/);
  assert.match(managementSource, /plantingDate/);
  assert.match(managementSource, /areaRai/);
  assert.doesNotMatch(managementSource, /\b(ownerId|owner_id|ownerUserId|owner_user_id|lineUserId|line_user_id|userId|user_id|appUserId|app_user_id)\b/);
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
  assert.match(cssSource, /\.mobile-my-parcels-button:not\(\[hidden\]\)/);
  assert.match(cssSource, /width: min\(430px, calc\(100vw - 24px\)\)/);
});
