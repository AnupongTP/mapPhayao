const assert = require("node:assert/strict");
const test = require("node:test");
const express = require("express");
const { Readable } = require("node:stream");
const { createDashboardSheetService, normalizeRow, sheetGeometry, SNAPSHOT_TTL_MS } =
  require("../src/services/dashboardSheetService");
const { createDashboardRoutes } = require("../src/routes/dashboardRoutes");
const { imageLink } = require("../src/services/googleParcelIntegration");

const shape = { type: "MultiPolygon", coordinates: [[[[99.889, 19.028], [99.890, 19.028],
  [99.890, 19.029], [99.889, 19.028]]]] };

function row(code, crop, createdAt, options = {}) {
  const cells = Array(16).fill("");
  cells[0] = "private-owner";
  cells[1] = "private-display-name";
  cells[2] = code;
  cells[3] = options.name || `Parcel ${code}`;
  cells[4] = crop;
  cells[5] = options.variety || "น่าน 95";
  cells[6] = "2024-01-02";
  cells[7] = options.coordinate === undefined ? "19.028500, 99.889500" : options.coordinate;
  cells[8] = options.geometry === undefined ? JSON.stringify(shape) : options.geometry;
  cells[9] = "18656";
  cells[10] = "11.66";
  cells[11] = JSON.stringify(options.images || []);
  cells[12] = JSON.stringify((options.fileIds || []).map(imageLink));
  cells[13] = "private-note";
  cells[14] = createdAt;
  cells[15] = "2026-09-28 10:00:00";
  return cells;
}

function setup(rows) {
  let now = Date.parse("2026-09-28T03:00:00Z");
  let reads = 0;
  let queries = 0;
  let fails = false;
  const ids = [];
  const google = { enabled: true, async readDashboardRows() {
    reads += 1;
    if (fails) throw new Error("provider-secret-response");
    return rows.map((cells) => [...cells]);
  }, async getImage(fileId) { ids.push(fileId); return Readable.from(Buffer.from("webp-test")); } };
  const database = { async query(sql) {
    queries += 1;
    assert.match(sql, /gis\.tambon/);
    assert.doesNotMatch(sql, /app\.parcels/);
    return { rows: rows.map((cells) => ({ parcel_code: cells[2], sdist_code: "E2E", tambon: "เวียง" })) };
  } };
  return { google, database, service: createDashboardSheetService({ google, database, now: () => now }), ids,
    get reads() { return reads; }, get queries() { return queries; },
    advance(ms) { now += ms; }, fail(value) { fails = value; },
  };
}

test("Sheet A:P normalization excludes private fields and tolerates malformed map/photo cells", () => {
  const normalized = normalizeRow(row("PY-1", "rice", "2026-09-27 09:37:53", {
    coordinate: "invalid", geometry: "not-json", images: ["a.webp"], fileIds: [],
  }));
  assert.equal(normalized.point, null);
  assert.equal(normalized.geometry, null);
  assert.deepEqual(normalized.images, []);
  assert.equal(normalized.createdAt.toISOString(), "2026-09-27T02:37:53.000Z");
  assert.equal(Object.hasOwn(normalized, "ownerUserId"), false);
  assert.equal(sheetGeometry(JSON.stringify(shape)).shape.type, "MultiPolygon");
});

test("Sheet created_at, not planting_date, determines Bangkok daily counts", async () => {
  const harness = setup([
    row("PY-1", "rice", "2026-09-27 23:59:59"),
    row("PY-2", "maize", "2026-09-28 00:00:00"),
    row("PY-3", "rice", "2026-09-28 09:00:00", { coordinate: "invalid" }),
  ]);
  const summary = await harness.service.getSummary({ tambon: null, crop: null, days: 7 });
  assert.equal(summary.summary.total, 3);
  assert.equal(summary.summary.today, 2);
  assert.equal(summary.summary.yesterday, 1);
  assert.deepEqual(summary.daily.at(-1).crops, [{ name: "maize", count: 1 }, { name: "rice", count: 1 }]);
  assert.equal(summary.daily.at(-2).count, 1);
  const points = await harness.service.getPoints({ tambon: null, crop: null, snapshotVersion: summary.snapshotVersion });
  assert.equal(points.parcels.length, 2);
  assert.equal(points.parcels[0].plantingDate, "2024-01-02");
  assert.equal(harness.reads, 1);
  assert.equal(harness.queries, 1);
  assert.doesNotMatch(JSON.stringify({ summary, points }), /private-owner|private-display-name|private-note/);
});

test("summary, points, geometry and repeated pans reuse one snapshot; TTL and concurrent refresh are bounded", async () => {
  const harness = setup([row("PY-1", "rice", "2026-09-28 09:00:00")]);
  const [first, second] = await Promise.all([
    harness.service.getSummary({ days: 7 }), harness.service.getPoints({}),
  ]);
  assert.equal(first.snapshotVersion, second.snapshotVersion);
  const bbox = [99.88, 19.02, 99.90, 19.04];
  for (let index = 0; index < 3; index += 1) {
    const result = await harness.service.getGeometries({ bbox });
    assert.equal(result.data.features.length, 1);
    assert.equal(result.data.features[0].geometry.type, "MultiPolygon");
  }
  assert.equal(harness.reads, 1);
  assert.equal(harness.queries, 1);
  harness.advance(SNAPSHOT_TTL_MS + 1);
  await Promise.all([harness.service.getPoints({}), harness.service.getSummary({ days: 7 })]);
  assert.equal(harness.reads, 2);
  assert.equal(harness.queries, 2);
});

test("last-good snapshot survives a Sheet failure without leaking provider text", async () => {
  const harness = setup([row("PY-1", "rice", "2026-09-28 09:00:00")]);
  const first = await harness.service.getSummary({ days: 7 });
  harness.advance(SNAPSHOT_TTL_MS + 1);
  harness.fail(true);
  const previousWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args);
  try {
    const stale = await harness.service.getSummary({ days: 7 });
    assert.equal(stale.stale, true);
    assert.equal(stale.summary.total, 1);
    assert.equal(stale.updatedAt, first.updatedAt);
    await harness.service.getPoints({});
    assert.equal(harness.reads, 2);
    assert.doesNotMatch(JSON.stringify(warnings), /provider-secret-response/);
  } finally { console.warn = previousWarn; }
});

test("public photo routes resolve only indexed trusted Sheet references", async () => {
  const fileIds = ["trustedFirstId", "trustedSecondId", "trustedThirdId"];
  const harness = setup([row("PY-1", "rice", "2026-09-28 09:00:00", {
    images: ["first.webp", "second.webp", "third.webp"], fileIds,
  })]);
  const app = express();
  app.use("/api/public/dashboard", createDashboardRoutes({
    googleIntegration: harness.google, database: harness.database, now: () => Date.parse("2026-09-28T03:00:00Z"),
  }));
  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise((resolve) => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const index of [0, 1, 2]) {
      const result = await fetch(`${base}/api/public/dashboard/images/PY-1/${index}`);
      assert.equal(result.status, 200);
      assert.equal(result.headers.get("content-type"), "image/webp");
      assert.equal(await result.text(), "webp-test");
      assert.equal(harness.ids.at(-1), fileIds[index]);
    }
    assert.equal((await fetch(`${base}/api/public/dashboard/images/PY-1/first`)).status, 200);
    assert.equal(harness.ids.at(-1), fileIds[0]);
    const list = await (await fetch(`${base}/api/public/dashboard/points`)).json();
    assert.equal(list.parcels[0].photoCount, 3);
    assert.doesNotMatch(JSON.stringify(list), /trustedFirstId|trustedSecondId|trustedThirdId|drive\.usercontent|private-owner|first\.webp/);
    assert.equal((await fetch(`${base}/api/public/dashboard/images/trustedFirstId/0`)).status, 404);
    assert.equal((await fetch(`${base}/api/public/dashboard/images/PY-1/3`)).status, 404);
    for (const index of ["-1", "1.5", "abc", "01", "9007199254740992"]) {
      assert.equal((await fetch(`${base}/api/public/dashboard/images/PY-1/${index}`)).status, 400);
    }
    assert.deepEqual(harness.ids, [fileIds[0], fileIds[1], fileIds[2], fileIds[0]]);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test("public photo route reports no photo and sanitizes an unavailable read provider", async () => {
  const cells = [row("PY-EMPTY", "rice", "2026-09-28 09:00:00"),
    row("PY-IMAGE", "rice", "2026-09-28 09:00:00", {
      images: ["first.webp"], fileIds: ["trustedFileId"],
    })];
  const harness = setup(cells);
  harness.google.getImage = async () => {
    const error = new Error("private provider configuration detail");
    error.statusCode = 503;
    throw error;
  };
  const app = express();
  app.use("/api/public/dashboard", createDashboardRoutes({
    googleIntegration: harness.google, database: harness.database,
    now: () => Date.parse("2026-09-28T03:00:00Z"),
  }));
  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise((resolve) => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}/api/public/dashboard/images`;
    const empty = await fetch(`${base}/PY-EMPTY/0`);
    assert.equal(empty.status, 404);
    const unavailable = await fetch(`${base}/PY-IMAGE/0`);
    assert.equal(unavailable.status, 503);
    assert.doesNotMatch(await unavailable.text(), /private provider configuration detail|trustedFileId/);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
