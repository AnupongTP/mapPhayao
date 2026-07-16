const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");

const parcelRoutes = require("../src/routes/parcelRoutes");
const lineTokenService = require("../src/services/lineTokenService");
const appUserService = require("../src/services/appUserService");
const parcelService = require("../src/services/parcelService");
const areaAnalysisService = require("../src/services/areaAnalysisService");

const LINE_USER_A = "U-line-user-a";
const LINE_USER_B = "U-line-user-b";
const APP_USER_A = "77777777-7777-4777-8777-777777777777";
const APP_USER_B = "88888888-8888-4888-8888-888888888888";
const PARCEL_A = "99999999-9999-4999-8999-999999999999";
const PARCEL_B = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const originalVerifyIdToken = lineTokenService.verifyIdToken;
const originalFindOrCreateLineUser = appUserService.findOrCreateLineUser;
const originalParcelService = {
  createParcel: parcelService.createParcel,
  getOwnedParcelById: parcelService.getOwnedParcelById,
  listOwnedParcels: parcelService.listOwnedParcels,
  updateOwnedParcel: parcelService.updateOwnedParcel,
  deleteOwnedParcel: parcelService.deleteOwnedParcel,
  getOwnedParcelAnalysisInput: parcelService.getOwnedParcelAnalysisInput,
};
const originalAnalyzePolygon = areaAnalysisService.analyzePolygon;

test.afterEach(() => {
  lineTokenService.verifyIdToken = originalVerifyIdToken;
  appUserService.findOrCreateLineUser = originalFindOrCreateLineUser;
  Object.assign(parcelService, originalParcelService);
  areaAnalysisService.analyzePolygon = originalAnalyzePolygon;
});

function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/parcels", parcelRoutes);
  app.use((err, req, res, next) => {
    res.status(err.statusCode || 500).json({
      success: false,
      error: err.message || "Server error",
    });
  });
  return app;
}

async function request(app, path, options = {}) {
  const server = await new Promise((resolve) => {
    const listeningServer = app.listen(0, () => resolve(listeningServer));
  });

  try {
    const address = server.address();
    const headers = {
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(options.authorization ? { Authorization: options.authorization } : {}),
    };
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
      method: options.method || "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const text = await response.text();
    return {
      status: response.status,
      body: text ? JSON.parse(text) : null,
    };
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function installAuthAndUsers() {
  const calls = {
    verifiedTokens: [],
    appUsers: [],
  };

  lineTokenService.verifyIdToken = async (idToken) => {
    calls.verifiedTokens.push(idToken);
    if (idToken === "token-a") {
      return { sub: LINE_USER_A, audience: "channel-id" };
    }
    if (idToken === "token-b") {
      return { sub: LINE_USER_B, audience: "channel-id" };
    }
    const error = new Error(`Invalid token ${idToken}`);
    error.statusCode = 401;
    error.rawResponse = "raw upstream body";
    throw error;
  };

  appUserService.findOrCreateLineUser = async (lineUserId) => {
    calls.appUsers.push(lineUserId);
    if (lineUserId === LINE_USER_A) {
      return { id: APP_USER_A };
    }
    if (lineUserId === LINE_USER_B) {
      return { id: APP_USER_B };
    }
    throw createHttpError(401, "LINE authentication required");
  };

  return calls;
}

function installParcelService(calls) {
  const storedGeometryA = {
    type: "Polygon",
    coordinates: [[
      [99.1, 19.1],
      [99.2, 19.1],
      [99.2, 19.2],
      [99.1, 19.2],
      [99.1, 19.1],
    ]],
  };
  const storedGeometryB = {
    type: "Polygon",
    coordinates: [[
      [99.3, 19.3],
      [99.4, 19.3],
      [99.4, 19.4],
      [99.3, 19.4],
      [99.3, 19.3],
    ]],
  };
  const parcels = [
    { id: PARCEL_A, parcelName: "Parcel A", ownerUserId: APP_USER_A, geometry: storedGeometryA },
    { id: PARCEL_B, parcelName: "Parcel B", ownerUserId: APP_USER_B, geometry: storedGeometryB },
  ];

  function toPublicParcel(parcel) {
    return {
      id: parcel.id,
      parcelName: parcel.parcelName,
      geometry: parcel.geometry,
    };
  }

  function findOwned(id, appUserId) {
    const parcel = parcels.find((item) => item.id === id && item.ownerUserId === appUserId);
    if (!parcel) {
      throw createHttpError(404, "Parcel not found");
    }
    return parcel;
  }

  parcelService.createParcel = async (payload, options) => {
    calls.createInputs.push({ payload, options });
    const ownerUserId = options.lineUserId === LINE_USER_A ? APP_USER_A : APP_USER_B;
    const id = ownerUserId === APP_USER_A ? PARCEL_A : PARCEL_B;
    const parcel = {
      id,
      parcelName: payload.parcelName,
      ownerUserId,
      geometry: payload.geometry,
    };
    parcels.push(parcel);
    return toPublicParcel(parcel);
  };
  parcelService.listOwnedParcels = async (appUserId) => {
    calls.listInputs.push(appUserId);
    return parcels
      .filter((parcel) => parcel.ownerUserId === appUserId)
      .map(toPublicParcel);
  };
  parcelService.getOwnedParcelById = async (id, appUserId) => {
    calls.getInputs.push({ id, appUserId });
    return toPublicParcel(findOwned(id, appUserId));
  };
  parcelService.updateOwnedParcel = async (id, payload, appUserId) => {
    calls.updateInputs.push({ id, payload, appUserId });
    const parcel = findOwned(id, appUserId);
    parcel.parcelName = payload.parcelName || parcel.parcelName;
    return toPublicParcel(parcel);
  };
  parcelService.deleteOwnedParcel = async (id, appUserId) => {
    calls.deleteInputs.push({ id, appUserId });
    findOwned(id, appUserId);
  };
  parcelService.getOwnedParcelAnalysisInput = async (id, appUserId) => {
    calls.analysisInputCalls.push({ id, appUserId });
    const parcel = findOwned(id, appUserId);
    return {
      id: parcel.id,
      name: parcel.parcelName,
      geometry: parcel.geometry,
    };
  };
}

function installAreaAnalysis(calls) {
  areaAnalysisService.analyzePolygon = async (input) => {
    calls.analysisCalls.push(input);
    return {
      success: true,
      analysisName: input.name,
      geometry: input.geometry,
    };
  };
}

function makeCalls() {
  return {
    createInputs: [],
    listInputs: [],
    getInputs: [],
    updateInputs: [],
    deleteInputs: [],
    analysisInputCalls: [],
    analysisCalls: [],
  };
}

test("parcel router requires bearer LINE auth and sanitizes token failures", async () => {
  const app = createApp();
  installAuthAndUsers();

  let response = await request(app, "/api/parcels/mine");
  assert.equal(response.status, 401);
  assert.deepEqual(response.body, {
    success: false,
    error: "LINE authentication required",
  });

  response = await request(app, "/api/parcels/mine", {
    authorization: "Bearer bad-token",
  });
  assert.equal(response.status, 401);
  assert.deepEqual(response.body, {
    success: false,
    error: "LINE authentication required",
  });
  assert.equal(JSON.stringify(response.body).includes("bad-token"), false);
  assert.equal(JSON.stringify(response.body).includes("raw upstream body"), false);
});

test("parcel routes create, list, read, update, delete, and analyze only the authenticated user's parcels", async () => {
  const app = createApp();
  installAuthAndUsers();
  const calls = makeCalls();
  installParcelService(calls);
  installAreaAnalysis(calls);

  let response = await request(app, "/api/parcels", {
    method: "POST",
    authorization: "Bearer token-a",
    body: {
      parcelName: "Created A",
      cropType: "rice",
      geometry: { type: "Polygon", coordinates: [[[99, 19], [100, 19], [100, 20], [99, 20], [99, 19]]] },
      owner_user_id: APP_USER_B,
      ownerUserId: APP_USER_B,
      lineUserId: LINE_USER_B,
      userId: "client-user",
    },
  });
  assert.equal(response.status, 201);
  assert.equal(response.body.parcel.id, PARCEL_A);
  assert.equal(JSON.stringify(response.body).includes(APP_USER_A), false);
  assert.equal(JSON.stringify(response.body).includes(APP_USER_B), false);
  assert.equal(calls.createInputs[0].options.lineUserId, LINE_USER_A);
  assert.equal(calls.createInputs[0].payload.owner_user_id, APP_USER_B);

  response = await request(app, "/api/parcels/mine?limit=100", {
    authorization: "Bearer token-a",
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.parcels.every((parcel) => parcel.id !== PARCEL_B), true);
  assert.deepEqual(calls.listInputs.at(-1), APP_USER_A);

  response = await request(app, "/api/parcels", {
    authorization: "Bearer token-b",
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.parcels.every((parcel) => parcel.id !== PARCEL_A), true);
  assert.deepEqual(calls.listInputs.at(-1), APP_USER_B);

  response = await request(app, `/api/parcels/${PARCEL_A}`, {
    authorization: "Bearer token-a",
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.parcel.id, PARCEL_A);

  response = await request(app, `/api/parcels/${PARCEL_A}`, {
    method: "PATCH",
    authorization: "Bearer token-a",
    body: { parcelName: "Updated A" },
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.parcel.parcelName, "Updated A");
  assert.deepEqual(calls.updateInputs.at(-1), {
    id: PARCEL_A,
    payload: { parcelName: "Updated A" },
    appUserId: APP_USER_A,
  });

  for (const [method, path, body] of [
    ["GET", `/api/parcels/${PARCEL_B}`, undefined],
    ["PATCH", `/api/parcels/${PARCEL_B}`, { parcelName: "Denied" }],
    ["DELETE", `/api/parcels/${PARCEL_B}`, undefined],
    ["POST", `/api/parcels/${PARCEL_B}/analyze`, { geometry: { type: "Polygon", coordinates: [] } }],
  ]) {
    response = await request(app, path, {
      method,
      authorization: "Bearer token-a",
      body,
    });
    assert.equal(response.status, 404);
    assert.deepEqual(response.body, {
      success: false,
      error: "Parcel not found",
    });
  }

  const attackerGeometry = {
    type: "Polygon",
    coordinates: [[[1, 1], [2, 1], [2, 2], [1, 2], [1, 1]]],
  };
  response = await request(app, `/api/parcels/${PARCEL_B}/analyze`, {
    method: "POST",
    authorization: "Bearer token-b",
    body: {
      geometry: attackerGeometry,
      name: "client name ignored",
    },
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.analysisName, "Parcel B");
  assert.deepEqual(calls.analysisCalls.at(-1), {
    name: "Parcel B",
    geometry: response.body.geometry,
  });
  assert.notDeepEqual(calls.analysisCalls.at(-1).geometry, attackerGeometry);
  assert.equal(calls.analysisCalls.at(-1).geometry.coordinates[0][0][0], 99.3);
  assert.deepEqual(calls.analysisInputCalls.at(-1), {
    id: PARCEL_B,
    appUserId: APP_USER_B,
  });

  response = await request(app, `/api/parcels/${PARCEL_A}`, {
    method: "DELETE",
    authorization: "Bearer token-a",
  });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { success: true });
  assert.deepEqual(calls.deleteInputs.at(-1), {
    id: PARCEL_A,
    appUserId: APP_USER_A,
  });
});

test("parcel controller converts unexpected backend failures to sanitized server errors", async () => {
  const app = createApp();
  installAuthAndUsers();
  parcelService.listOwnedParcels = async () => {
    throw new Error("database password and stack should not leak");
  };

  const response = await request(app, "/api/parcels/mine", {
    authorization: "Bearer token-a",
  });

  assert.equal(response.status, 500);
  assert.deepEqual(response.body, {
    success: false,
    error: "Server error",
  });
});
