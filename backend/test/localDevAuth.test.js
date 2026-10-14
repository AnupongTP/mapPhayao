const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { Readable } = require("node:stream");
const { createLineAuthMiddleware, _private } = require("../src/middleware/lineAuthMiddleware");
const appUserService = require("../src/services/appUserService");
const parcelRoutes = require("../src/routes/parcelRoutes");
const parcelService = require("../src/services/parcelService");
const parcelImageService = require("../src/services/parcelImageService");
const parcelPhotoEditService = require("../src/services/parcelPhotoEditService");
const parcelMirrorService = require("../src/services/parcelMirrorService");

const APP_USER_ID = "77777777-7777-4777-8777-777777777777";
const LINE_SUBJECT = "U-local-fixture";
const DEV_MARKER = "Bearer map-phayao-local-dev";

async function request(app, path, { authorization, origin = "http://localhost", extraHeaders = {},
  method = "GET", body } = {}) {
  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise((resolve) => server.once("listening", resolve));
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method,
      headers: { Origin: origin, ...(authorization ? { Authorization: authorization } : {}),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...extraHeaders },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: response.headers.get("content-type")?.startsWith("image/")
      ? await response.text() : await response.json() };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function harness(overrides = {}) {
  const lookups = [];
  const verified = [];
  const env = { NODE_ENV: "development", LOCAL_DEV_AUTH_ENABLED: "true",
    LOCAL_DEV_APP_USER_ID: APP_USER_ID, ...overrides.env };
  const auth = createLineAuthMiddleware({
    localDevAuthEnv: env,
    findLocalDevUser: async (id) => {
      lookups.push(id);
      return overrides.user === undefined ? { id: APP_USER_ID, lineUserId: LINE_SUBJECT } : overrides.user;
    },
    lineTokenService: { async verifyIdToken(token) {
      verified.push(token);
      if (token !== "valid-line-token") throw new Error("Invalid token");
      return { sub: "U-verified-line" };
    } },
  });
  const app = express();
  app.get("/dev-auth", auth.localDevStatus);
  app.use(auth);
  app.get("/identity", (req, res) => res.json(req.lineIdentity));
  return { app, env, lookups, verified };
}

test("local marker is rejected in production and when the switch is disabled", async () => {
  for (const env of [{ NODE_ENV: "production" }, { LOCAL_DEV_AUTH_ENABLED: "false" },
    { NODE_ENV: "test" }, { RENDER: "true" }]) {
    const h = harness({ env });
    assert.equal((await request(h.app, "/identity", { authorization: DEV_MARKER })).status, 401);
    assert.deepEqual(h.lookups, []);
    assert.deepEqual((await request(h.app, "/dev-auth")).body, { enabled: false });
  }
});

test("local marker requires loopback host/socket, localhost Origin and no proxy headers", async () => {
  const h = harness();
  assert.equal((await request(h.app, "/identity", { authorization: DEV_MARKER })).status, 200);
  assert.equal((await request(h.app, "/identity", { authorization: DEV_MARKER,
    origin: "https://mapphayaoliff.netlify.app" })).status, 401);
  assert.equal((await request(h.app, "/identity", { authorization: DEV_MARKER,
    extraHeaders: { "X-Forwarded-For": "127.0.0.1" } })).status, 401);
  assert.equal(_private.isLocalDevRequest({ get(name) {
    return { host: "mapphayao-backend.onrender.com", origin: "http://localhost" }[name];
  }, socket: { remoteAddress: "127.0.0.1", localAddress: "127.0.0.1" } }, h.env), false);
});

test("the backend selector fixes identity regardless of browser-supplied values", async () => {
  const h = harness();
  const response = await request(h.app, "/identity?lineUserId=U-attacker&owner_user_id=attacker", {
    authorization: DEV_MARKER, extraHeaders: { "X-User-Id": "U-attacker" },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { lineUserId: LINE_SUBJECT, displayName: "" });
  assert.deepEqual(h.lookups, [APP_USER_ID]);
  assert.deepEqual(h.verified, []);
});

test("missing configured user fails closed; normal LINE verification is unchanged", async () => {
  const h = harness({ user: null });
  assert.equal((await request(h.app, "/identity", { authorization: DEV_MARKER })).status, 401);
  assert.deepEqual((await request(h.app, "/dev-auth")).body, { enabled: false });
  const line = await request(h.app, "/identity", { authorization: "Bearer valid-line-token" });
  assert.equal(line.status, 200);
  assert.equal(line.body.lineUserId, "U-verified-line");
  assert.deepEqual(h.verified, ["valid-line-token"]);
});

test("existing app user lookup uses internal UUID only as a selector and never inserts", async () => {
  const calls = [];
  const database = { async query(sql, values) {
    calls.push({ sql, values });
    return { rows: [{ id: APP_USER_ID, line_user_id: LINE_SUBJECT }] };
  } };
  assert.deepEqual(await appUserService.findExistingLocalDevUser(APP_USER_ID, { database }),
    { id: APP_USER_ID, lineUserId: LINE_SUBJECT });
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /WHERE id = \$1/);
  assert.doesNotMatch(calls[0].sql, /INSERT|UPDATE/i);
  assert.deepEqual(calls[0].values, [APP_USER_ID]);
  assert.equal(await appUserService.findExistingLocalDevUser("not-a-uuid", { database }), null);
  assert.equal(calls.length, 1);
  assert.equal(await appUserService.findExistingLocalDevUser(APP_USER_ID, { database: {
    async query() { return { rows: [{ id: APP_USER_ID, line_user_id: APP_USER_ID }] }; },
  } }), null);
});

test("local marker uses the existing owner chain for create, list, read, update, delete and photo read", async () => {
  const originals = {
    findOrCreateLineUser: appUserService.findOrCreateLineUser,
    createParcel: parcelService.createParcel,
    listOwnedParcels: parcelService.listOwnedParcels,
    getOwnedParcelById: parcelService.getOwnedParcelById,
    updateOwnedParcel: parcelService.updateOwnedParcel,
    deleteOwnedParcel: parcelService.deleteOwnedParcel,
    withParcelMutationLock: parcelService.withParcelMutationLock,
    listOwnedImages: parcelImageService.listOwnedImages,
    getOwnedImageFileId: parcelImageService.getOwnedImageFileId,
    getOwnedImageFiles: parcelImageService.getOwnedImageFiles,
    assertNoSavedEdit: parcelPhotoEditService.assertNoSavedEdit,
    bestEffortMirror: parcelMirrorService.bestEffortMirror,
  };
  const calls = [];
  const parcelId = "99999999-9999-4999-8999-999999999999";
  try {
    appUserService.findOrCreateLineUser = async (lineUserId) => {
      calls.push(["user-lookup", lineUserId]);
      assert.equal(lineUserId, LINE_SUBJECT);
      return { id: APP_USER_ID };
    };
    parcelService.createParcel = async (body, options) => {
      calls.push(["create", options.lineUserId]);
      return { id: parcelId, parcelCode: "PY-TEST" };
    };
    parcelService.listOwnedParcels = async (ownerId) => {
      calls.push(["list", ownerId]);
      return [];
    };
    parcelService.getOwnedParcelById = async (id, ownerId) => {
      calls.push(["read", ownerId]);
      if (id !== parcelId || ownerId !== APP_USER_ID) {
        throw Object.assign(new Error("Parcel not found"), { statusCode: 404 });
      }
      return { id: parcelId, parcelCode: "PY-TEST" };
    };
    parcelService.updateOwnedParcel = async (id, body, ownerId) => {
      calls.push(["update", ownerId]);
      return { id };
    };
    parcelService.deleteOwnedParcel = async (id, ownerId) => {
      calls.push(["delete", ownerId]);
      return "job-fixture";
    };
    parcelService.withParcelMutationLock = async (id, work) => work({ query: async () => ({ rows: [] }) });
    parcelImageService.listOwnedImages = async () => [];
    parcelImageService.getOwnedImageFileId = async (id, imageId, ownerId) => {
      calls.push(["photo", ownerId]);
      if (id !== parcelId || ownerId !== APP_USER_ID) {
        throw Object.assign(new Error("Photo not found"), { statusCode: 404 });
      }
      return "trusted-file-id";
    };
    parcelImageService.getOwnedImageFiles = async () => ({ fileIds: [] });
    parcelPhotoEditService.assertNoSavedEdit = async () => {};
    parcelMirrorService.bestEffortMirror = async () => {};
    const googleIntegration = { enabled: true,
      async getImage() { return Readable.from(Buffer.from("webp")); } };
    const routes = parcelRoutes.createParcelRoutes({ googleIntegration,
      localDevAuthEnv: { NODE_ENV: "development", LOCAL_DEV_AUTH_ENABLED: "true",
        LOCAL_DEV_APP_USER_ID: APP_USER_ID },
      findLocalDevUser: async () => ({ id: APP_USER_ID, lineUserId: LINE_SUBJECT }),
      lineTokenService: { async verifyIdToken() { throw new Error("LINE must not be called"); } },
    });
    const app = express();
    app.use(express.json());
    app.use("/api/parcels", routes);
    app.use((error, req, res, next) => res.status(error.statusCode || 500).json({ error: "failed" }));
    assert.equal((await request(app, "/api/parcels", { authorization: DEV_MARKER, method: "POST",
      body: { owner_user_id: "attacker", lineUserId: "U-attacker" } })).status, 201);
    assert.equal((await request(app, "/api/parcels/mine", { authorization: DEV_MARKER })).status, 200);
    assert.equal((await request(app, `/api/parcels/${parcelId}`, { authorization: DEV_MARKER })).status, 200);
    assert.equal((await request(app, `/api/parcels/${parcelId}`, { authorization: DEV_MARKER,
      method: "PATCH", body: { parcelName: "Updated" } })).status, 200);
    assert.equal((await request(app, `/api/parcels/${parcelId}/images/a.webp/content`,
      { authorization: DEV_MARKER })).status, 200);
    assert.equal((await request(app, "/api/parcels/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/images/a.webp/content",
      { authorization: DEV_MARKER })).status, 404);
    assert.equal((await request(app, `/api/parcels/${parcelId}`, { authorization: DEV_MARKER,
      method: "DELETE" })).status, 200);
    assert.deepEqual(calls.filter(([kind]) => kind === "create"), [["create", LINE_SUBJECT]]);
    for (const kind of ["list", "read", "update", "delete", "photo"]) {
      assert.ok(calls.some(([name, id]) => name === kind && id === APP_USER_ID), kind);
    }
  } finally {
    appUserService.findOrCreateLineUser = originals.findOrCreateLineUser;
    Object.assign(parcelService, Object.fromEntries(Object.entries(originals)
      .filter(([name]) => name in parcelService)));
    parcelImageService.listOwnedImages = originals.listOwnedImages;
    parcelImageService.getOwnedImageFileId = originals.getOwnedImageFileId;
    parcelImageService.getOwnedImageFiles = originals.getOwnedImageFiles;
    parcelPhotoEditService.assertNoSavedEdit = originals.assertNoSavedEdit;
    parcelMirrorService.bestEffortMirror = originals.bestEffortMirror;
  }
});
