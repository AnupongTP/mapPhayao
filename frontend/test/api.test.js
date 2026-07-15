const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const pointState = require("../js/point-state");

function createApiHarness(responseBody = { ok: true, status: "SENT" }) {
  const calls = [];
  const context = {
    URLSearchParams,
    JSON,
    Error,
    TypeError,
    window: {
      AppConfig: {
        apiBaseUrl: "https://backend.example.test/api",
      },
      MapPointState: pointState,
    },
    fetch: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        json: async () => responseBody,
      };
    },
  };
  const apiCode = fs.readFileSync(path.join(__dirname, "../js/api.js"), "utf8");
  vm.createContext(context);
  vm.runInContext(apiCode, context);
  return {
    calls,
    MapApi: context.window.MapApi,
  };
}

test("sendLineLocationSummary posts map-click coordinates to the summary endpoint", async () => {
  const { calls, MapApi } = createApiHarness();

  const result = await MapApi.sendLineLocationSummary({
    idToken: "test-id-token",
    lat: 19.123456,
    lng: 99.123456,
  });

  assert.deepEqual(result, { ok: true, status: "SENT" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://backend.example.test/api/line/location-summary");
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.headers["Content-Type"], "application/json");
});

test("sendLineLocationSummary posts GPS coordinates unchanged", async () => {
  const { calls, MapApi } = createApiHarness();

  await MapApi.sendLineLocationSummary({
    idToken: "test-id-token",
    lat: 19.039564,
    lng: 99.888847,
  });

  assert.deepEqual(JSON.parse(calls[0].options.body), {
    idToken: "test-id-token",
    lat: 19.039564,
    lng: 99.888847,
  });
});

test("sendLineLocationSummary payload contains only idToken, lat, and lng", async () => {
  const { calls, MapApi } = createApiHarness();

  await MapApi.sendLineLocationSummary({
    idToken: "test-id-token",
    lat: 19.25,
    lng: 99.75,
    userId: "ignored",
    analysis: { ignored: true },
    flexMessage: { ignored: true },
    detailUrl: "https://example.com/ignored",
  });

  const body = JSON.parse(calls[0].options.body);
  assert.deepEqual(Object.keys(body).sort(), ["idToken", "lat", "lng"]);
  assert.equal(body.source, undefined);
});

test("sendLineLocationSummary rejects missing coordinates before fetch", async () => {
  const { calls, MapApi } = createApiHarness();

  await assert.rejects(
    () => MapApi.sendLineLocationSummary({ idToken: "test-id-token", lng: 99 }),
    /lat and lng/,
  );
  await assert.rejects(
    () => MapApi.sendLineLocationSummary({ idToken: "test-id-token", lat: 19 }),
    /lat and lng/,
  );
  await assert.rejects(
    () => MapApi.sendLineLocationSummary({ idToken: "test-id-token", lat: undefined, lng: 99 }),
    /lat and lng/,
  );
  assert.equal(calls.length, 0);
});

test("sendLineLocationSummary rejects unexpected success bodies", async () => {
  const { MapApi } = createApiHarness({ ok: true, status: "QUEUED" });

  await assert.rejects(
    () =>
      MapApi.sendLineLocationSummary({
        idToken: "test-id-token",
        lat: 19,
        lng: 99,
      }),
    /SENT/,
  );
});
