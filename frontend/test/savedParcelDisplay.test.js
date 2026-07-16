const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const frontendRoot = path.resolve(__dirname, "..");
const formatterSource = fs.readFileSync(path.join(frontendRoot, "js/formatters.js"), "utf8");
const uiSource = fs.readFileSync(path.join(frontendRoot, "js/ui.js"), "utf8");
const managementSource = fs.readFileSync(
  path.join(frontendRoot, "js/parcel-management.js"),
  "utf8",
);

function createFormatters() {
  const context = { window: {}, Intl, Date, Number, String, JSON };
  vm.createContext(context);
  vm.runInContext(formatterSource, context);
  return context.window.MapFormatters;
}

test("saved parcel crop type labels are centralized and do not mutate API values", () => {
  const formatters = createFormatters();
  const parcel = {
    cropType: " rice ",
    plantingDate: "2026-07-16",
  };

  assert.equal(formatters.getCropTypeLabel("rice"), "ข้าว");
  assert.equal(formatters.getCropTypeLabel("RICE"), "ข้าว");
  assert.equal(formatters.getCropTypeLabel(" maize "), "ข้าวโพด");
  assert.equal(formatters.getCropTypeLabel("MAIZE"), "ข้าวโพด");
  assert.equal(formatters.getCropTypeLabel(null), "—");
  assert.equal(formatters.getCropTypeLabel(""), "—");
  assert.equal(formatters.getCropTypeLabel("cassava"), "cassava");
  assert.equal(parcel.cropType, " rice ");
  assert.equal(parcel.plantingDate, "2026-07-16");
});

test("saved parcel planting dates use timezone-safe Thai Buddhist date-only formatting", () => {
  const formatters = createFormatters();

  assert.equal(formatters.formatThaiDateOnly("2026-01-05"), "5 ม.ค. 2569");
  assert.equal(formatters.formatThaiDateOnly("2026-07-16"), "16 ก.ค. 2569");
  assert.equal(formatters.formatThaiDateOnly("2026-12-31"), "31 ธ.ค. 2569");
  assert.equal(formatters.formatThaiDateOnly("2026-02-31"), "—");
  assert.equal(formatters.formatThaiDateOnly("bad-date"), "—");
  assert.equal(formatters.formatThaiDateOnly(""), "—");
});

test("saved parcel updated timestamps use Asia Bangkok Buddhist datetime without raw ISO parts", () => {
  const formatters = createFormatters();

  assert.equal(formatters.formatThaiDateTime("2026-07-16T09:40:56.527Z"), "16 ก.ค. 2569 16:40");
  assert.equal(formatters.formatThaiDateTime("2026-07-16T09:41:26.085Z"), "16 ก.ค. 2569 16:41");
  assert.equal(formatters.formatThaiDateTime("bad timestamp"), "—");

  const formatted = formatters.formatThaiDateTime("2026-07-16T09:40:56.527Z");
  assert.equal(/\d{2}:\d{2}:\d{2}/.test(formatted), false);
  assert.equal(formatted.includes(".527"), false);
  assert.equal(formatted.includes("T"), false);
  assert.equal(formatted.includes("Z"), false);
});

test("saved parcel detail uses display formatters and generic variety label", () => {
  const start = uiSource.indexOf("function renderSavedParcelDetail(parcel, message)");
  const end = uiSource.indexOf("function addParcelDrawControl", start);
  const detailBlock = uiSource.slice(start, end);

  assert.match(detailBlock, /label: "ชนิดพืช"[\s\S]*formatter: formatters\.getCropTypeLabel/);
  assert.match(detailBlock, /label: "พันธุ์"/);
  assert.doesNotMatch(detailBlock, /พันธุ์ข้าว/);
  assert.match(detailBlock, /label: "วันที่ปลูก"[\s\S]*formatter: formatters\.formatThaiDateOnly/);
  assert.match(detailBlock, /label: "อัปเดตล่าสุด"[\s\S]*formatter: formatters\.formatThaiDateTime/);
});

test("My Parcels cards use formatted crop type and planting date while forms keep raw date values", () => {
  assert.match(managementSource, /summary\.push\(formatters\.getCropTypeLabel\(parcel\.cropType\)\)/);
  assert.match(managementSource, /summary\.push\(formatters\.formatThaiDateOnly\(parcel\.plantingDate\)\)/);
  assert.match(managementSource, /formatters\.formatThaiDateTime\(parcel\.updatedAt \|\| parcel\.createdAt\)/);
  assert.match(managementSource, /formatters\.formatAreaRaiCompact\(parcel\.areaRai\)/);
  assert.match(managementSource, /actions\.hidden = !isExpanded/);
  assert.match(managementSource, /handlers\.onEditBoundary\?\.\(parcel\)/);
  assert.match(managementSource, /dateInput\.value = parcel\?\.plantingDate \|\| ""/);
  assert.doesNotMatch(managementSource, /summary\.push\(parcel\.cropType\)/);
});
