const assert = require("node:assert/strict");
const test = require("node:test");

const parcelState = require("../js/parcel-state");

const PARCEL_ID = "11111111-1111-4111-8111-111111111111";
const geometryA = {
  type: "Polygon",
  coordinates: [[[99, 19], [100, 19], [100, 20], [99, 20], [99, 19]]],
};
const geometryB = {
  type: "Polygon",
  coordinates: [[[99.1, 19.1], [100, 19.1], [100, 20], [99.1, 20], [99.1, 19.1]]],
};

function createParcel() {
  return {
    id: "tmp-1",
    name: "Temporary parcel",
    geometry: geometryA,
    analysisStatus: "idle",
  };
}

test("save is disabled until the current geometry has successful analysis", () => {
  const parcel = createParcel();
  parcelState.ensurePersistenceState(parcel);

  assert.equal(parcelState.canSaveAnalyzedParcel(parcel), false);

  const token = parcelState.markAnalysisStarted(parcel);
  parcel.analysisStatus = "success";
  assert.equal(parcelState.markAnalysisSucceeded(parcel, token, parcel.geometry), true);
  assert.equal(parcelState.canSaveAnalyzedParcel(parcel), true);
});

test("geometry change or deletion disables save and clears saved state", () => {
  const parcel = createParcel();
  const token = parcelState.markAnalysisStarted(parcel);
  parcel.analysisStatus = "success";
  parcelState.markAnalysisSucceeded(parcel, token, parcel.geometry);
  const snapshot = parcelState.captureSaveSnapshot(parcel);
  parcelState.markSaveSucceeded(parcel, snapshot, { id: PARCEL_ID, parcelName: "Saved" });

  assert.equal(parcelState.ensurePersistenceState(parcel).savedParcelId, PARCEL_ID);

  parcel.geometry = geometryB;
  parcelState.markGeometryChanged(parcel);

  assert.equal(parcelState.canSaveAnalyzedParcel(parcel), false);
  assert.equal(parcelState.ensurePersistenceState(parcel).savedParcelId, null);
});

test("stale analysis cannot enable save", () => {
  const parcel = createParcel();
  const staleToken = parcelState.markAnalysisStarted(parcel);
  parcelState.markGeometryChanged(parcel);
  parcel.analysisStatus = "success";

  assert.equal(parcelState.markAnalysisSucceeded(parcel, staleToken, geometryA), false);
  assert.equal(parcelState.canSaveAnalyzedParcel(parcel), false);
});

test("save captures an immutable geometry snapshot and blocks double save", () => {
  const parcel = createParcel();
  const token = parcelState.markAnalysisStarted(parcel);
  parcel.analysisStatus = "success";
  parcelState.markAnalysisSucceeded(parcel, token, parcel.geometry);

  const snapshot = parcelState.captureSaveSnapshot(parcel);
  snapshot.geometry.coordinates[0][0][0] = 0;

  assert.notDeepEqual(snapshot.geometry, parcel.geometry);
  assert.equal(parcelState.canSaveAnalyzedParcel(parcel), false);
  assert.equal(parcelState.captureSaveSnapshot(parcel), null);
});

test("save success records safe parcel id and stale save success is rejected", () => {
  const parcel = createParcel();
  const token = parcelState.markAnalysisStarted(parcel);
  parcel.analysisStatus = "success";
  parcelState.markAnalysisSucceeded(parcel, token, parcel.geometry);
  const snapshot = parcelState.captureSaveSnapshot(parcel);

  assert.equal(
    parcelState.markSaveSucceeded(parcel, snapshot, { id: PARCEL_ID, parcelName: "Saved" }),
    true,
  );
  assert.equal(parcelState.ensurePersistenceState(parcel).savedParcelId, PARCEL_ID);

  const changed = createParcel();
  const changedToken = parcelState.markAnalysisStarted(changed);
  changed.analysisStatus = "success";
  parcelState.markAnalysisSucceeded(changed, changedToken, changed.geometry);
  const staleSnapshot = parcelState.captureSaveSnapshot(changed);
  parcelState.markGeometryChanged(changed);
  assert.equal(
    parcelState.markSaveSucceeded(changed, staleSnapshot, { id: PARCEL_ID }),
    false,
  );
});

test("opening saved parcel is non-editable and valid GeoJSON is checked", () => {
  const opened = parcelState.markSavedParcelOpened({
    id: PARCEL_ID,
    geometry: geometryA,
  });

  assert.deepEqual(opened, {
    openedSavedParcelId: PARCEL_ID,
    isEditable: false,
    geometry: geometryA,
  });
  assert.notEqual(opened.geometry, geometryA);
  assert.equal(parcelState.isValidGeoJsonGeometry(geometryA), true);
  assert.equal(parcelState.isValidGeoJsonGeometry({ type: "Point", coordinates: [99, 19] }), false);
});

test("stale list and detail responses are rejected", () => {
  assert.equal(parcelState.shouldAcceptListResponse(2, 2), true);
  assert.equal(parcelState.shouldAcceptListResponse(1, 2), false);
  assert.equal(parcelState.shouldAcceptDetailResponse(PARCEL_ID, PARCEL_ID, 3, 3), true);
  assert.equal(parcelState.shouldAcceptDetailResponse(PARCEL_ID, "22222222-2222-4222-8222-222222222222", 3, 3), false);
  assert.equal(parcelState.shouldAcceptDetailResponse(PARCEL_ID, PARCEL_ID, 2, 3), false);
});
