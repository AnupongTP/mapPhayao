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
  assert.match(detailBlock, /label: "พิกัดแปลง"[^\n]*renderer: createCoordinateMapLink/);
});

test("representative point displays latitude first to six places or the normal empty value", () => {
  const formatters = createFormatters();
  assert.equal(formatters.formatRepresentativePoint({ latitude: 19.0488924, longitude: 99.9525506 }),
    "19.048892, 99.952551");
  assert.equal(formatters.formatRepresentativePoint(null), formatters.EMPTY_TEXT);
  assert.equal(formatters.formatRepresentativePoint({ latitude: null, longitude: 99.9 }), formatters.EMPTY_TEXT);
  const resultBlock = uiSource.slice(uiSource.indexOf("function renderParcelResult(parcelState)"),
    uiSource.indexOf("function renderSavedParcelDetail(parcel, message)"));
  assert.match(resultBlock, /label: "พิกัดแปลง"[^\n]*renderer: createCoordinateMapLink/);
});

test("coordinate destinations validate latitude-first values without provider lock-in", () => {
  const formatters = createFormatters();
  const point = { latitude: 19.037525, longitude: 99.941463 };
  assert.equal(formatters.coordinateMapHref(point, true),
    "geo:19.037525,99.941463?q=19.037525,99.941463");
  assert.equal(formatters.coordinateMapHref({ lat: 19.037525, lng: 99.941463 }, true),
    formatters.coordinateMapHref(point, true));
  assert.equal(formatters.coordinateMapHref(point, false),
    "https://www.openstreetmap.org/?mlat=19.037525&mlon=99.941463#map=16/19.037525/99.941463");
  assert.doesNotMatch(formatters.coordinateMapHref(point, true), /google\.com|package=/);
  for (const invalid of [null, {}, { latitude: null, longitude: 99 },
    { latitude: 91, longitude: 99 }, { latitude: 19, longitude: -181 },
    { latitude: "19", longitude: 99 }]) {
    assert.equal(formatters.coordinateMapHref(invalid, true), null);
  }
});

test("coordinate rows alone use the DOM renderer and themed keyboard-accessible links", () => {
  const css = fs.readFileSync(path.join(frontendRoot, "css/map.css"), "utf8");
  assert.match(uiSource, /function createCoordinateMapLink\(point\)/);
  assert.match(uiSource, /display\.appendChild\(renderer\(value\)\)/);
  assert.match(uiSource, /link\.setAttribute\("aria-label"/);
  assert.doesNotMatch(uiSource, /coordinateMapHref[\s\S]{0,300}innerHTML/);
  assert.match(uiSource, /label: "พิกัด"[^\n]*renderer: createCoordinateMapLink/g);
  assert.equal((uiSource.match(/label: "พิกัด"[^\n]*renderer: createCoordinateMapLink/g) || []).length, 2);
  assert.equal((uiSource.match(/label: "พิกัดแปลง"[^\n]*renderer: createCoordinateMapLink/g) || []).length, 2);
  assert.match(css, /\.coordinate-map-link \{[\s\S]*?color: #0f766e;/);
  assert.match(css, /\.coordinate-map-link:focus-visible \{/);
});

test("photo section shares the result card in analyzed and saved parcel views", () => {
  const photoBlock = uiSource.slice(uiSource.indexOf("function createParcelPhotoSection(photos, options = {})"),
    uiSource.indexOf("function renderParcelResult(parcelState)"));
  assert.match(photoBlock, /"parcel-result-card parcel-photo-section"/);
  assert.match(photoBlock, /ยังไม่มีรูปภาพแปลง/);
  assert.match(photoBlock, /parcel-photo-item parcel-photo-loading/);
  assert.match(photoBlock, /parcel-photo-spinner/);
  assert.match(photoBlock, /tile\.setAttribute\("role", "status"\)/);
  assert.match(photoBlock, /strip\.appendChild\(loadingTile\(\)\)/g);
  assert.equal((photoBlock.match(/strip\.appendChild\(loadingTile\(\)\)/g) || []).length, 2);
  assert.doesNotMatch(photoBlock, /กำลังโหลดรูปภาพ\.\.\./);
  assert.match(photoBlock, /photo\.loadError[\s\S]*parcel-photo-load-error/);
  const css = fs.readFileSync(path.join(frontendRoot, "css/map.css"), "utf8");
  assert.match(css, /\.parcel-photo-loading \{[\s\S]*?align-items: center;[\s\S]*?justify-content: center;/);
  assert.match(css, /\.parcel-photo-spinner \{[\s\S]*?animation: parcel-photo-spin/);
  assert.match(photoBlock, /image\.loading = "lazy"/);
  const resultBlock = uiSource.slice(uiSource.indexOf("function renderParcelResult(parcelState)"),
    uiSource.indexOf("function renderSavedParcelDetail(parcel, message)"));
  const savedBlock = uiSource.slice(uiSource.indexOf("function renderSavedParcelDetail(parcel, message)"),
    uiSource.indexOf("function addParcelDrawControl", uiSource.indexOf("function renderSavedParcelDetail(parcel, message)")));
  assert.match(resultBlock, /createParcelPhotoSection\(parcelState\.photos,/);
  assert.match(savedBlock, /createParcelPhotoSection\(parcel\?\.photos,/);
});

test("saved photo tiles independently replace spinners with images or per-image errors", () => {
  const source = uiSource.slice(uiSource.indexOf("function createParcelPhotoSection(photos, options = {})"),
    uiSource.indexOf("function renderParcelResult(parcelState)"));
  function element(tag) {
    return { tag, children: [], attributes: {}, className: "", setAttribute(name, value) {
      this.attributes[name] = value;
    }, appendChild(child) { this.children.push(child); }, addEventListener() {} };
  }
  const document = { createElement: element };
  const createElement = (tag, className, text) => Object.assign(element(tag), {
    className: className || "", textContent: text,
  });
  const render = vm.runInNewContext(`(${source.trim()})`, {
    document, createElement, openParcelPhotoViewer: () => {},
  });
  const photos = [{ loading: true }, { loading: true }];
  let strip = render(photos).children[1];
  assert.equal(strip.children.length, 2);
  for (const tile of strip.children) {
    assert.match(tile.className, /parcel-photo-loading/);
    assert.equal(tile.attributes.role, "status");
    assert.equal(tile.children[0].className, "parcel-photo-spinner");
  }
  photos[0] = { previewUrl: "blob:first" };
  strip = render(photos).children[1];
  assert.match(strip.children[0].className, /parcel-photo-open/);
  assert.equal(strip.children[0].children[0].src, "blob:first");
  assert.match(strip.children[1].className, /parcel-photo-loading/);
  photos[1] = { loadError: true };
  strip = render(photos).children[1];
  assert.match(strip.children[1].className, /parcel-photo-load-error/);
  assert.match(strip.children[1].textContent, /โหลดรูปภาพ 2 ไม่สำเร็จ/);
  assert.equal(strip.children.some((tile) => tile.className.includes("parcel-photo-loading")), false);
});

test("public privacy page remains available without a floating map link", () => {
  const index = fs.readFileSync(path.join(frontendRoot, "index.html"), "utf8");
  const privacy = fs.readFileSync(path.join(frontendRoot, "privacy.html"), "utf8");
  assert.doesNotMatch(index, /privacy-policy-link/);
  assert.match(privacy, /<html lang="th">/);
  assert.match(privacy, /href="index\.html"/);
  assert.doesNotMatch(privacy, /<script|liff\.init|Authorization|refresh_token|private_key/i);
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
