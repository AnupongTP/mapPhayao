const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const pointState = require("../js/point-state");

function createApiHarness(responseBody = { ok: true, status: "SENT" }, harnessOptions = {}) {
  const calls = [];
  const tokenCalls = [];
  const context = {
    URLSearchParams,
    FormData,
    JSON,
    Error,
    TypeError,
    window: {
      AppConfig: {
        apiBaseUrl: harnessOptions.apiBaseUrl || "https://backend.example.test/api",
      },
      MapPointState: pointState,
      MapLiffMode: {
        getCurrentIdToken: async () => {
          tokenCalls.push("getCurrentIdToken");
          return harnessOptions.idToken || "test-id-token";
        },
      },
    },
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (responseBody instanceof Error) {
        throw responseBody;
      }
      return {
        ok: harnessOptions?.ok ?? true,
        status: harnessOptions?.status || 200,
        headers: { get: () => harnessOptions?.contentType || "image/webp" },
        json: async () => {
          if (harnessOptions?.nonJson) {
            throw new Error("not json");
          }
          return responseBody;
        },
        blob: async () => new Blob(["webp"], { type: "image/webp" }),
      };
    },
  };
  const apiCode = fs.readFileSync(path.join(__dirname, "../js/api.js"), "utf8");
  vm.createContext(context);
  vm.runInContext(apiCode, context);
  return {
    calls,
    tokenCalls,
    MapApi: context.window.MapApi,
  };
}

test("parcel photo upload uses authenticated multipart without client owner fields", async () => {
  const { calls, MapApi } = createApiHarness({ image: { id: "image-id" } });
  const parcelId = "11111111-1111-4111-8111-111111111111";
  const file = new Blob(["fixture"], { type: "image/png" });
  const clientPhotoId = "11111111-1111-4111-8111-111111111111";
  const result = await MapApi.uploadParcelImage(parcelId, file, clientPhotoId, { attempt: 2 });
  assert.equal(result.id, "image-id");
  assert.equal(calls[0].url, `https://backend.example.test/api/parcels/${parcelId}/images`);
  assert.equal(calls[0].options.headers.Authorization, "Bearer test-id-token");
  assert.equal(calls[0].options.headers["X-Photo-Attempt"], "2");
  assert.equal(calls[0].options.headers["Content-Type"], undefined);
  assert.deepEqual([...calls[0].options.body.keys()], ["image", "clientPhotoId"]);
  assert.equal(calls[0].options.body.get("clientPhotoId"), clientPhotoId);
});

test("photo API exposes only explicit retry classification and treats lost responses as ambiguous", async () => {
  const parcelId = "11111111-1111-4111-8111-111111111111";
  const file = new Blob(["fixture"], { type: "image/png" });
  const photoId = "11111111-1111-4111-8111-111111111111";
  const transient = createApiHarness({ error: "Temporary", retryable: true }, { ok: false, status: 503 });
  await assert.rejects(() => transient.MapApi.uploadParcelImage(parcelId, file, photoId),
    (error) => error.statusCode === 503 && error.retryable === true && !error.ambiguous);
  const unclassified = createApiHarness({ error: "Unknown" }, { ok: false, status: 500 });
  await assert.rejects(() => unclassified.MapApi.uploadParcelImage(parcelId, file, photoId),
    (error) => error.statusCode === 500 && !error.retryable && !error.ambiguous);
  const ambiguous = createApiHarness(new TypeError("network failed"));
  await assert.rejects(() => ambiguous.MapApi.uploadParcelImage(parcelId, file, photoId),
    (error) => error.ambiguous === true);
  const aborted = createApiHarness(Object.assign(new Error("aborted"), { name: "AbortError" }));
  await assert.rejects(() => aborted.MapApi.uploadParcelImage(parcelId, file, photoId),
    (error) => error.name === "AbortError" && !error.ambiguous);
});

test("saved photo content uses the owned backend route and existing LINE token provider", async () => {
  const { MapApi, calls, tokenCalls } = createApiHarness();
  const parcelId = "11111111-1111-4111-8111-111111111111";
  const controller = new AbortController();
  const blob = await MapApi.getParcelImageBlob(parcelId, "photo_1.webp", { signal: controller.signal });
  assert.equal(blob.type, "image/webp");
  assert.deepEqual(tokenCalls, ["getCurrentIdToken"]);
  assert.equal(calls[0].url,
    `https://backend.example.test/api/parcels/${parcelId}/images/photo_1.webp/content`);
  assert.equal(calls[0].options.headers.Authorization, "Bearer test-id-token");
  assert.equal(calls[0].options.signal, controller.signal);
  assert.equal(calls[0].options.method, "GET");
  assert.equal(Object.keys(calls[0].options.headers).length, 1);
});

test("saved photo content rejects unsafe image ids and non-WebP responses", async () => {
  const { MapApi, calls, tokenCalls } = createApiHarness();
  const parcelId = "11111111-1111-4111-8111-111111111111";
  await assert.rejects(() => MapApi.getParcelImageBlob(parcelId, "../secret"), TypeError);
  assert.equal(calls.length, 0);
  assert.equal(tokenCalls.length, 0);
  const invalid = createApiHarness({}, { contentType: "text/html" });
  await assert.rejects(() => invalid.MapApi.getParcelImageBlob(parcelId, "photo.webp"),
    /Invalid parcel image response/);
});

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

const PARCEL_ID = "11111111-1111-4111-8111-111111111111";
const sampleGeometry = {
  type: "Polygon",
  coordinates: [[[99, 19], [100, 19], [100, 20], [99, 20], [99, 19]]],
};

test("createParcel uses Authorization bearer token and strips owner and user fields", async () => {
  const { calls, tokenCalls, MapApi } = createApiHarness({ success: true, parcel: { id: PARCEL_ID } });

  await MapApi.createParcel({
    parcelName: " Parcel A ",
    cropType: " rice ",
    riceVariety: " KDML105 ",
    plantingDate: "2026-07-16",
    note: " field note ",
    geometry: sampleGeometry,
    userId: "client-user",
    user_id: "client-user",
    lineUserId: "line-user",
    line_user_id: "line-user",
    ownerId: "owner",
    owner_id: "owner",
    ownerUserId: "owner",
    owner_user_id: "owner",
    appUserId: "app-user",
    app_user_id: "app-user",
    idToken: "body-token",
  });

  assert.deepEqual(tokenCalls, ["getCurrentIdToken"]);
  assert.equal(calls[0].url, "https://backend.example.test/api/parcels");
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.headers.Authorization, "Bearer test-id-token");
  assert.equal(calls[0].options.headers["Content-Type"], "application/json");
  assert.equal(calls[0].url.includes("test-id-token"), false);

  const body = JSON.parse(calls[0].options.body);
  assert.deepEqual(Object.keys(body).sort(), [
    "cropType",
    "geometry",
    "note",
    "parcelName",
    "plantingDate",
    "riceVariety",
  ]);
  assert.equal(JSON.stringify(body).includes("test-id-token"), false);
  assert.equal(JSON.stringify(body).includes("body-token"), false);
  assert.equal(JSON.stringify(body).includes("client-user"), false);
  assert.equal(JSON.stringify(body).includes("owner"), false);
  assert.equal(body.note, "field note");
});

test("parcel list, detail, update, delete, and re-analysis use the Phase 4 paths and methods", async () => {
  const { calls, MapApi } = createApiHarness({ success: true, parcels: [] });

  await MapApi.listMyParcels();
  await MapApi.getMyParcel(PARCEL_ID);
  await MapApi.updateMyParcel(PARCEL_ID, {
    parcelName: "New name",
    cropType: "rice",
    riceVariety: "RD",
    plantingDate: "2026-07-16",
    note: "",
    geometry: sampleGeometry,
    owner_user_id: "ignored",
  });
  await MapApi.deleteMyParcel(PARCEL_ID);
  await MapApi.analyzeMyParcel(PARCEL_ID);

  assert.equal(calls[0].url, "https://backend.example.test/api/parcels/mine");
  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[0].options.headers["Content-Type"], undefined);
  assert.equal(calls[1].url, `https://backend.example.test/api/parcels/${PARCEL_ID}`);
  assert.equal(calls[1].options.method, "GET");
  assert.equal(calls[2].options.method, "PATCH");
  assert.deepEqual(Object.keys(JSON.parse(calls[2].options.body)).sort(), [
    "cropType",
    "geometry",
    "note",
    "parcelName",
    "plantingDate",
    "riceVariety",
  ]);
  assert.deepEqual(JSON.parse(calls[2].options.body).geometry, sampleGeometry);
  assert.equal(JSON.parse(calls[2].options.body).note, "");
  assert.equal(calls[3].options.method, "DELETE");
  assert.equal(calls[3].options.body, undefined);
  assert.equal(calls[4].url, `https://backend.example.test/api/parcels/${PARCEL_ID}/analyze`);
  assert.equal(calls[4].options.method, "POST");
  assert.equal(calls[4].options.body, undefined);
});

test("parcel API rejects invalid IDs before fetch and handles non-JSON errors safely", async () => {
  const { calls, MapApi } = createApiHarness({ error: "ignored" });
  assert.throws(() => MapApi.getMyParcel("bad/id"), /parcelId is invalid/);
  assert.equal(calls.length, 0);

  const failing = createApiHarness(null, { ok: false, status: 503, nonJson: true });
  await assert.rejects(
    () => failing.MapApi.listMyParcels(),
    (error) => error.statusCode === 503 && /API request failed: 503/.test(error.message),
  );
});

test("parcel API base keeps one /api and current routing for localhost and production frontend", async () => {
  const local = createApiHarness({ success: true }, { apiBaseUrl: "http://localhost:3000/api" });
  await local.MapApi.listMyParcels();
  assert.equal(local.calls[0].url, "http://localhost:3000/api/parcels/mine");
  assert.equal((local.calls[0].url.match(/\/api/g) || []).length, 1);

  const cloudflare = createApiHarness(
    { success: true },
    { apiBaseUrl: "https://mapphayao-backend.onrender.com/api" },
  );
  await cloudflare.MapApi.listMyParcels();
  assert.equal(cloudflare.calls[0].url, "https://mapphayao-backend.onrender.com/api/parcels/mine");
  assert.equal((cloudflare.calls[0].url.match(/\/api/g) || []).length, 1);
});
