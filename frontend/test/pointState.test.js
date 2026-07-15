const assert = require("node:assert/strict");
const test = require("node:test");

const pointState = require("../js/point-state");

const GPS_A = { lat: 19.039564, lng: 99.888847, source: "gps", accuracy: 12 };
const MAP_B = { lat: 19.123456, lng: 99.123456, source: "map" };
const DRAG_B = { lat: 19.25, lng: 99.75, source: "drag" };

function createStateHarness() {
  return {
    selectedPoint: null,
    lastConfirmedPoint: null,
    select(point) {
      this.selectedPoint = pointState.normalizePoint(point);
      this.lastConfirmedPoint = null;
      return this.selectedPoint;
    },
    captureConfirmRequest() {
      return pointState.createConfirmedPoint(this.selectedPoint);
    },
    acceptConfirmResponse(requestedPoint) {
      if (!pointState.shouldAcceptPointAnalysisResponse(requestedPoint, this.selectedPoint)) {
        return false;
      }
      this.lastConfirmedPoint = pointState.createConfirmedPoint(requestedPoint);
      return true;
    },
    createSummaryPayload(idToken) {
      return pointState.createLineSummaryPayload({
        idToken,
        point: this.lastConfirmedPoint,
      });
    },
  };
}

test("normalizes GPS and map-click coordinates to the same point contract", () => {
  assert.deepEqual(pointState.normalizePoint(GPS_A), GPS_A);
  assert.deepEqual(pointState.normalizePoint(MAP_B), MAP_B);
  assert.deepEqual(pointState.normalizePoint("19.5", "99.75", { source: "map" }), {
    lat: 19.5,
    lng: 99.75,
    source: "map",
  });
});

test("accepts finite numeric coordinates including zero", () => {
  assert.deepEqual(pointState.normalizePoint({ lat: 0, lng: 0, source: "map" }), {
    lat: 0,
    lng: 0,
    source: "map",
  });
});

test("accepts latitude and longitude aliases from generic coordinate objects", () => {
  assert.deepEqual(
    pointState.normalizePoint({ latitude: "19.1", longitude: "99.2", source: "map" }),
    {
      lat: 19.1,
      lng: 99.2,
      source: "map",
    },
  );
});

test("rejects missing, null, NaN, and out-of-range coordinates", () => {
  const invalidInputs = [
    { lng: 99 },
    { lat: 19 },
    { lat: null, lng: 99 },
    { lat: 19, lng: null },
    { lat: NaN, lng: 99 },
    { lat: 91, lng: 99 },
    { lat: 19, lng: 181 },
    { lat: "", lng: 99 },
    { lat: 19, lng: "" },
  ];

  invalidInputs.forEach((input) => {
    assert.equal(pointState.normalizePoint(input), null);
    assert.equal(pointState.isValidPoint(input), false);
  });
});

test("point keys are deterministic and compare coordinates safely", () => {
  assert.equal(pointState.createPointKey(GPS_A), "19.0395640,99.8888470");
  assert.equal(pointState.areSamePoints(GPS_A, { lat: 19.039564, lng: 99.888847 }), true);
  assert.equal(pointState.areSamePoints(GPS_A, MAP_B), false);
  assert.equal(pointState.areSamePoints(null, MAP_B), false);
});

test("confirmed point is a copied lat/lng-only value", () => {
  const selected = { ...MAP_B };
  const confirmed = pointState.createConfirmedPoint(selected);

  selected.lat = 18;
  selected.lng = 98;
  selected.source = "changed";

  assert.deepEqual(confirmed, { lat: 19.123456, lng: 99.123456 });
});

test("GPS A then map-click B uses B as current selected point", () => {
  let selected = pointState.normalizePoint(GPS_A);
  assert.equal(pointState.areSamePoints(selected, GPS_A), true);

  selected = pointState.normalizePoint(MAP_B);
  assert.equal(pointState.areSamePoints(selected, MAP_B), true);
  assert.equal(pointState.areSamePoints(selected, GPS_A), false);
});

test("stale response A is rejected after selecting B", () => {
  const requestedA = pointState.createConfirmedPoint(GPS_A);
  const currentB = pointState.normalizePoint(MAP_B);

  assert.equal(pointState.shouldAcceptPointAnalysisResponse(requestedA, currentB), false);
  assert.equal(pointState.shouldAcceptPointAnalysisResponse(currentB, currentB), true);
});

test("marker drag B invalidates confirmed A by coordinate comparison", () => {
  const confirmedA = pointState.createConfirmedPoint(MAP_B);
  const draggedB = pointState.normalizePoint(DRAG_B);

  assert.equal(pointState.areSamePoints(confirmedA, draggedB), false);
});

test("summary payload contains only idToken, lat, and lng", () => {
  const payload = pointState.createLineSummaryPayload({
    idToken: "test-id-token",
    point: MAP_B,
    userId: "ignored",
    analysis: { ignored: true },
    flexMessage: { ignored: true },
    detailUrl: "https://example.com/ignored",
  });

  assert.deepEqual(payload, {
    idToken: "test-id-token",
    lat: 19.123456,
    lng: 99.123456,
  });
  assert.deepEqual(Object.keys(payload).sort(), ["idToken", "lat", "lng"]);
});

test("summary payload rejects missing token or coordinates before fetch", () => {
  assert.throws(
    () => pointState.createLineSummaryPayload({ lat: 19, lng: 99 }),
    /idToken is required/,
  );
  assert.throws(
    () => pointState.createLineSummaryPayload({ idToken: "token", lng: 99 }),
    /lat and lng/,
  );
  assert.throws(
    () => pointState.createLineSummaryPayload({ idToken: "token", lat: 19 }),
    /lat and lng/,
  );
});

test("GPS confirmation flow captures GPS coordinates for summary", () => {
  const state = createStateHarness();
  state.select(GPS_A);
  const request = state.captureConfirmRequest();

  assert.equal(state.acceptConfirmResponse(request), true);
  assert.deepEqual(state.lastConfirmedPoint, { lat: GPS_A.lat, lng: GPS_A.lng });
  assert.deepEqual(state.createSummaryPayload("test-id-token"), {
    idToken: "test-id-token",
    lat: GPS_A.lat,
    lng: GPS_A.lng,
  });
});

test("map-click confirmation flow captures clicked coordinates for summary", () => {
  const state = createStateHarness();
  state.select(MAP_B);
  const request = state.captureConfirmRequest();

  assert.equal(state.acceptConfirmResponse(request), true);
  assert.deepEqual(state.createSummaryPayload("test-id-token"), {
    idToken: "test-id-token",
    lat: MAP_B.lat,
    lng: MAP_B.lng,
  });
});

test("GPS A then map-click B clears A and confirms B", () => {
  const state = createStateHarness();
  state.select(GPS_A);
  assert.equal(state.acceptConfirmResponse(state.captureConfirmRequest()), true);

  state.select(MAP_B);
  assert.equal(state.lastConfirmedPoint, null);
  assert.equal(state.acceptConfirmResponse(state.captureConfirmRequest()), true);
  assert.deepEqual(state.createSummaryPayload("test-id-token"), {
    idToken: "test-id-token",
    lat: MAP_B.lat,
    lng: MAP_B.lng,
  });
});

test("dragging from A to B clears A and confirms dragged coordinates", () => {
  const state = createStateHarness();
  state.select(MAP_B);
  assert.equal(state.acceptConfirmResponse(state.captureConfirmRequest()), true);

  state.select(DRAG_B);
  assert.equal(state.lastConfirmedPoint, null);
  assert.equal(state.acceptConfirmResponse(state.captureConfirmRequest()), true);
  assert.deepEqual(state.createSummaryPayload("test-id-token"), {
    idToken: "test-id-token",
    lat: DRAG_B.lat,
    lng: DRAG_B.lng,
  });
});

test("late response for A cannot confirm after selecting B", () => {
  const state = createStateHarness();
  state.select(GPS_A);
  const requestA = state.captureConfirmRequest();
  state.select(MAP_B);

  assert.equal(state.acceptConfirmResponse(requestA), false);
  assert.equal(state.lastConfirmedPoint, null);
});
