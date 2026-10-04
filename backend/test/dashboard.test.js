const assert = require("node:assert/strict");
const test = require("node:test");
const { createApp } = require("../src/server");
const controller = require("../src/controllers/dashboardController");

test("dashboard filters, snapshot versions and bbox reject malformed input", () => {
  const { parseFilters, parseBbox, parseSnapshotVersion, parsePhotoIndex } = controller._private;
  assert.deepEqual(parseFilters({}), { tambon: null, crop: null, days: 7 });
  for (const days of ["0", "8", "30;DROP", ["7"]]) assert.throws(() => parseFilters({ days }));
  assert.throws(() => parseFilters({ tambon: "'; DROP TABLE app.parcels" }));
  assert.throws(() => parseFilters({ crop: "rice\n" }));
  for (const bbox of ["", "99,19,98,20", "99,19,101,20", "NaN,19,100,20", "99,19,100"]) {
    assert.throws(() => parseBbox(bbox));
  }
  assert.equal(parseSnapshotVersion("12"), "12");
  for (const version of ["0", "../secret", ["1"], "1.2"]) assert.throws(() => parseSnapshotVersion(version));
  assert.equal(parsePhotoIndex("0"), 0);
  assert.equal(parsePhotoIndex("2"), 2);
  for (const index of ["-1", "1.5", "abc", "01", "9007199254740992", ["1"]]) {
    assert.throws(() => parsePhotoIndex(index));
  }
});

test("public Dashboard routes are GET only and the existing parcel route remains protected", async () => {
  const app = createApp();
  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise((resolve) => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    assert.equal((await fetch(`${base}/api/public/dashboard/geometries`)).status, 400);
    assert.equal((await fetch(`${base}/api/public/dashboard/summary`, { method: "POST" })).status, 404);
    assert.equal((await fetch(`${base}/api/public/dashboard/images/INVALID/first`, { method: "POST" })).status, 404);
    assert.equal((await fetch(`${base}/api/public/dashboard/images/INVALID/0`, { method: "POST" })).status, 404);
    assert.notEqual((await fetch(`${base}/api/parcels/mine`)).status, 200);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
