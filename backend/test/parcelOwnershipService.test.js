const test = require("node:test");
const assert = require("node:assert/strict");

const db = require("../src/config/database");
const parcelService = require("../src/services/parcelService");

const PARCEL_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_PARCEL_ID = "44444444-4444-4444-8444-444444444444";
const OWNER_USER_ID = "55555555-5555-4555-8555-555555555555";
const OTHER_OWNER_USER_ID = "66666666-6666-4666-8666-666666666666";

const sampleGeometry = {
  type: "Polygon",
  coordinates: [[
    [99.1, 19.1],
    [99.101, 19.1],
    [99.101, 19.101],
    [99.1, 19.101],
    [99.1, 19.1],
  ]],
};

const sampleRow = {
  id: PARCEL_ID,
  parcel_code: "PY-2026-0001",
  parcel_name: "Parcel A",
  crop_type: "rice",
  rice_variety: "KDML105",
  planting_date: "2026-07-16",
  area_sqm: "1600.25",
  area_rai: "1.00",
  geometry: sampleGeometry,
  created_at: "2026-07-16T00:00:00.000Z",
  updated_at: "2026-07-16T00:00:00.000Z",
  owner_user_id: OWNER_USER_ID,
};

const originalDbQuery = db.query;
const originalPoolConnect = db.pool.connect;

test.afterEach(() => {
  db.query = originalDbQuery;
  db.pool.connect = originalPoolConnect;
});

function createTransactionalClient(handler) {
  const calls = [];
  const client = {
    released: false,
    calls,
    async query(text, params = []) {
      calls.push({ text, params });
      if (text === "BEGIN" || text === "COMMIT" || text === "ROLLBACK") {
        return { rows: [] };
      }
      return handler(text, params);
    },
    release() {
      this.released = true;
    },
  };
  return client;
}

function installDbQuery(handler) {
  const calls = [];
  db.query = async (text, params = []) => {
    calls.push({ text, params });
    return handler(text, params);
  };
  return calls;
}

function assertNoOwnerLeak(parcel) {
  const serialized = JSON.stringify(parcel);
  assert.equal(serialized.includes("owner_user_id"), false);
  assert.equal(serialized.includes("ownerUserId"), false);
  assert.equal(serialized.includes(OWNER_USER_ID), false);
}

test("createParcel requires an authenticated LINE user before opening a transaction", async () => {
  db.pool.connect = async () => {
    throw new Error("database should not be touched");
  };

  await assert.rejects(
    () => parcelService.createParcel({
      parcelName: "Parcel A",
      cropType: "rice",
      geometry: sampleGeometry,
    }),
    { statusCode: 401 },
  );
});

test("createParcel writes owner_user_id from the resolved app user and ignores client owner fields", async () => {
  let findOrCreateInput = null;
  const client = createTransactionalClient(async (text, params) => {
    assert.match(text, /INSERT INTO app\.parcels/is);
    return { rows: [sampleRow] };
  });
  db.pool.connect = async () => client;

  const parcel = await parcelService.createParcel(
    {
      parcelName: "Parcel A",
      cropType: "rice",
      riceVariety: "KDML105",
      plantingDate: "2026-07-16",
      geometry: sampleGeometry,
      owner_user_id: OTHER_OWNER_USER_ID,
      ownerUserId: OTHER_OWNER_USER_ID,
      lineUserId: "client-supplied-line-user",
      userId: "client-supplied-user",
    },
    {
      lineUserId: " verified-line-user ",
      appUserService: {
        findOrCreateLineUser: async (lineUserId, options) => {
          findOrCreateInput = { lineUserId, client: options.client };
          return { id: OWNER_USER_ID, line_user_id: "should-not-leak" };
        },
      },
    },
  );

  const insertCall = client.calls.find((call) => /INSERT INTO app\.parcels/is.test(call.text));
  assert.deepEqual(findOrCreateInput, {
    lineUserId: "verified-line-user",
    client,
  });
  assert.match(insertCall.text, /owner_user_id/is);
  assert.equal(insertCall.params[6], OWNER_USER_ID);
  assert.equal(insertCall.params.includes(OTHER_OWNER_USER_ID), false);
  assert.equal(insertCall.params.includes("client-supplied-line-user"), false);
  assert.equal(client.calls.some((call) => call.text === "COMMIT"), true);
  assert.equal(client.released, true);
  assert.equal(parcel.id, PARCEL_ID);
  assertNoOwnerLeak(parcel);
});

test("createParcel rolls back and releases the client on insert failure", async () => {
  const client = createTransactionalClient(async () => {
    throw new Error("insert failed");
  });
  db.pool.connect = async () => client;

  await assert.rejects(
    () => parcelService.createParcel(
      {
        parcelName: "Parcel A",
        cropType: "rice",
        geometry: sampleGeometry,
      },
      {
        lineUserId: "verified-line-user",
        appUserService: {
          findOrCreateLineUser: async () => ({ id: OWNER_USER_ID }),
        },
      },
    ),
    /insert failed/,
  );

  assert.equal(client.calls.some((call) => call.text === "ROLLBACK"), true);
  assert.equal(client.calls.some((call) => call.text === "COMMIT"), false);
  assert.equal(client.released, true);
});

test("listOwnedParcels filters by owner and returns parcels without owner fields", async () => {
  const calls = installDbQuery(async () => ({ rows: [sampleRow] }));

  const parcels = await parcelService.listOwnedParcels(OWNER_USER_ID, { limit: "25" });

  assert.equal(parcels.length, 1);
  assert.match(calls[0].text, /FROM app\.parcels/i);
  assert.match(calls[0].text, /WHERE owner_user_id = \$1/i);
  assert.match(calls[0].text, /ORDER BY created_at DESC, id DESC/i);
  assert.match(calls[0].text, /LIMIT \$2/i);
  assert.deepEqual(calls[0].params, [OWNER_USER_ID, 25]);
  assertNoOwnerLeak(parcels[0]);
});

test("owned parcel read, update, delete, and analysis queries include id and owner predicates", async () => {
  const calls = installDbQuery(async (text) => {
    if (/DELETE FROM app\.parcels/is.test(text)) {
      return { rows: [{ id: PARCEL_ID }] };
    }
    if (/ST_AsGeoJSON\(ST_Transform\(geom, 4326\)\)::json AS geometry/is.test(text)) {
      return {
        rows: [{
          id: PARCEL_ID,
          analysis_name: "Parcel A",
          geometry: sampleGeometry,
        }],
      };
    }
    return { rows: [sampleRow] };
  });

  await parcelService.getOwnedParcelById(PARCEL_ID, OWNER_USER_ID);
  await parcelService.updateOwnedParcel(PARCEL_ID, { parcelName: "Parcel B" }, OWNER_USER_ID);
  await parcelService.deleteOwnedParcel(PARCEL_ID, OWNER_USER_ID);
  const analysisInput = await parcelService.getOwnedParcelAnalysisInput(PARCEL_ID, OWNER_USER_ID);

  for (const call of calls) {
    assert.match(call.text, /app\.parcels/i);
    assert.match(call.text, /id = \$1/i);
    assert.match(call.text, /owner_user_id = \$2|owner_user_id = \$10/i);
    assert.equal(call.params[0], PARCEL_ID);
    assert.equal(call.params.includes(OWNER_USER_ID), true);
  }
  assert.match(calls[1].text, /updated_at = now\(\)/i);
  assert.match(calls[2].text, /DELETE FROM app\.parcels/i);
  assert.doesNotMatch(calls[2].text, /app\.users|CASCADE/i);
  assert.deepEqual(analysisInput, {
    id: PARCEL_ID,
    name: "Parcel A",
    geometry: sampleGeometry,
  });
});

test("owned parcel operations use the same not-found response for missing and other-user parcels", async () => {
  installDbQuery(async () => ({ rows: [] }));

  await assert.rejects(
    () => parcelService.getOwnedParcelById(OTHER_PARCEL_ID, OWNER_USER_ID),
    { statusCode: 404, message: "Parcel not found" },
  );
  await assert.rejects(
    () => parcelService.updateOwnedParcel(OTHER_PARCEL_ID, { parcelName: "Denied" }, OWNER_USER_ID),
    { statusCode: 404, message: "Parcel not found" },
  );
  await assert.rejects(
    () => parcelService.deleteOwnedParcel(OTHER_PARCEL_ID, OWNER_USER_ID),
    { statusCode: 404, message: "Parcel not found" },
  );
  await assert.rejects(
    () => parcelService.getOwnedParcelAnalysisInput(OTHER_PARCEL_ID, OWNER_USER_ID),
    { statusCode: 404, message: "Parcel not found" },
  );
});

test("owned parcel operations reject invalid ids before SQL", async () => {
  const calls = installDbQuery(async () => {
    throw new Error("database should not be touched");
  });

  await assert.rejects(
    () => parcelService.getOwnedParcelById("not-a-uuid", OWNER_USER_ID),
    { statusCode: 400 },
  );
  await assert.rejects(
    () => parcelService.listOwnedParcels("not-a-uuid"),
    { statusCode: 400 },
  );
  assert.equal(calls.length, 0);
});

test("owned parcel geometry update is owner scoped and recalculates area from transformed geometry", async () => {
  const updatedGeometry = {
    type: "MultiPolygon",
    coordinates: [[sampleGeometry.coordinates[0]]],
  };
  const calls = installDbQuery(async () => ({
    rows: [{
      ...sampleRow,
      area_sqm: "3200.50",
      area_rai: "2.00",
      geometry: updatedGeometry,
      updated_at: "2026-07-16T01:00:00.000Z",
      was_empty: false,
      was_valid: true,
      checked_area_sqm: "3200.50",
      matched_count: 1,
    }],
  }));

  const parcel = await parcelService.updateOwnedParcel(
    PARCEL_ID,
    { geometry: updatedGeometry },
    OWNER_USER_ID,
  );

  assert.equal(calls.length, 1);
  assert.match(calls[0].text, /WITH matched AS/i);
  assert.match(calls[0].text, /ST_GeomFromGeoJSON\(\$10\)/i);
  assert.match(calls[0].text, /ST_Transform\([\s\S]*32647/i);
  assert.match(calls[0].text, /owner_user_id = \$11/i);
  assert.match(calls[0].text, /ST_Area\(app\.parcels\.geom\)/i);
  assert.equal(calls[0].params[0], PARCEL_ID);
  assert.equal(calls[0].params[9], JSON.stringify(updatedGeometry));
  assert.equal(calls[0].params[10], OWNER_USER_ID);
  assert.equal(parcel.areaSqm, 3200.5);
  assert.equal(parcel.areaRai, 2);
  assert.deepEqual(parcel.geometry, updatedGeometry);
  assertNoOwnerLeak(parcel);
});

test("owned parcel geometry update rejects invalid, missing, and other-user geometry safely", async () => {
  let calls = installDbQuery(async () => {
    throw new Error("database should not be touched");
  });

  await assert.rejects(
    () => parcelService.updateOwnedParcel(PARCEL_ID, { geometry: { type: "Point", coordinates: [99, 19] } }, OWNER_USER_ID),
    { statusCode: 400 },
  );
  await assert.rejects(
    () => parcelService.updateOwnedParcel(PARCEL_ID, { geometry: { type: "Polygon", coordinates: [] } }, OWNER_USER_ID),
    { statusCode: 400 },
  );
  assert.equal(calls.length, 0);

  calls = installDbQuery(async () => ({
    rows: [{
      was_empty: false,
      was_valid: true,
      checked_area_sqm: "1600",
      matched_count: 0,
    }],
  }));
  await assert.rejects(
    () => parcelService.updateOwnedParcel(PARCEL_ID, { geometry: sampleGeometry }, OWNER_USER_ID),
    { statusCode: 404, message: "Parcel not found" },
  );
  assert.equal(calls.length, 1);
});
