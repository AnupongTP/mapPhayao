const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const frontendRoot = path.resolve(__dirname, "..");
const mapSource = fs.readFileSync(path.join(frontendRoot, "js/map.js"), "utf8");
const uiSource = fs.readFileSync(path.join(frontendRoot, "js/ui.js"), "utf8");
const managementSource = fs.readFileSync(
  path.join(frontendRoot, "js/parcel-management.js"),
  "utf8",
);
const cssSource = fs.readFileSync(path.join(frontendRoot, "css/map.css"), "utf8");
const pointState = require("../js/point-state");

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function nextTick() {
  return Promise.resolve();
}

function createEventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, handler) {
      const handlers = listeners.get(type) || [];
      handlers.push(handler);
      listeners.set(type, handlers);
    },
    removeEventListener(type, handler) {
      const handlers = listeners.get(type) || [];
      listeners.set(
        type,
        handlers.filter((item) => item !== handler),
      );
    },
    dispatchEvent(event) {
      const handlers = listeners.get(event.type) || [];
      handlers.slice().forEach((handler) => handler(event));
    },
    listenerCount(type) {
      return (listeners.get(type) || []).length;
    },
  };
}

function createMapTarget() {
  const target = createEventTarget();
  return {
    on(type, handler) {
      target.addEventListener(type, handler);
      return this;
    },
    fire(type, payload) {
      target.dispatchEvent({ type, ...payload });
    },
    setView() {
      return this;
    },
    fitBounds() {
      return this;
    },
    panTo() {
      return this;
    },
    listenerCount: target.listenerCount,
  };
}

function createMarker(latLng) {
  const target = createEventTarget();
  let currentLatLng = { lat: latLng[0], lng: latLng[1] };
  return {
    addTo() {
      return this;
    },
    on(type, handler) {
      target.addEventListener(type, handler);
      return this;
    },
    trigger(type) {
      target.dispatchEvent({ type, target: this });
    },
    setLatLng(nextLatLng) {
      currentLatLng = Array.isArray(nextLatLng)
        ? { lat: nextLatLng[0], lng: nextLatLng[1] }
        : { lat: nextLatLng.lat, lng: nextLatLng.lng };
      return this;
    },
    getLatLng() {
      return currentLatLng;
    },
    bindPopup() {
      return this;
    },
    openPopup() {
      return this;
    },
    unbindPopup() {
      return this;
    },
  };
}

function createLeafletStub(state) {
  return {
    FeatureGroup: class {
      addTo() {
        return this;
      }
      addLayer() {}
      removeLayer() {}
      clearLayers() {}
    },
    map() {
      state.map = createMapTarget();
      return state.map;
    },
    marker(latLng) {
      state.marker = createMarker(latLng);
      return state.marker;
    },
    circle() {
      return {
        addTo() {
          return this;
        },
        setLatLng() {
          return this;
        },
        setRadius() {
          return this;
        },
      };
    },
    popup() {
      return {
        setLatLng() {
          return this;
        },
        setContent() {
          return this;
        },
        openOn() {
          return this;
        },
        remove() {},
      };
    },
    geoJSON() {
      return {
        addTo() {
          return this;
        },
        getLayers() {
          return [];
        },
        getBounds() {
          return { isValid: () => false };
        },
      };
    },
    Draw: {
      Polygon: class {
        enable() {}
        disable() {}
      },
      Event: {
        CREATED: "draw:created",
        DRAWSTOP: "draw:drawstop",
      },
    },
    GeometryUtil: {
      geodesicArea() {
        return 0;
      },
    },
    DomEvent: {
      disableClickPropagation() {},
      disableScrollPropagation() {},
    },
    Control: {
      extend(definition) {
        return class {
          addTo(map) {
            this.container = definition.onAdd.call(this, map);
            return this;
          }
        };
      },
    },
    control: {
      layers() {
        return {
          addTo() {
            return this;
          },
        };
      },
    },
    drawLocal: {
      draw: {
        toolbar: {},
        handlers: {
          polygon: {},
        },
      },
    },
  };
}

function createMapHarness(options = {}) {
  const windowEvents = createEventTarget();
  const documentEvents = createEventTarget();
  const leafletState = {};
  const apiCalls = [];
  const pendingReports = [];
  const uiState = {
    setupCalls: 0,
    confirmHandlers: [],
    locateHandler: null,
    lineSummaryHandler: null,
    mobileStates: [],
    confirmEnabled: [],
    actionEnabled: [],
    messages: [],
    gpsLoading: 0,
    gpsReady: [],
    mapReady: [],
    dragReady: [],
    renderedResults: [],
    apiErrors: 0,
    lineSummaryStates: [],
    parcelControlStates: [],
    parcelInitCalls: 0,
    parcelReadyValues: [],
    warnings: [],
  };

  const text = {
    apiError: "Unable to load area data",
    apiLoading: "Loading area data",
    parcelEditLocked: "Parcel editing is active",
    positionUnavailable: "Position unavailable",
    secureContext: "Secure context required",
    unsupported: "Geolocation unavailable",
    noGisData: "No GIS data",
    phayaoCoverage: "Phayao only",
  };

  const MapApi = {
    getLocationReport(lat, lng, requestOptions) {
      const deferred = createDeferred();
      apiCalls.push({ method: "getLocationReport", lat, lng, options: requestOptions });
      pendingReports.push(deferred);
      return deferred.promise;
    },
    analyzeLineLocation(payload) {
      apiCalls.push({ method: "analyzeLineLocation", payload });
      return Promise.resolve({});
    },
    sendLineLocationSummary() {
      return Promise.resolve({ ok: true, status: "SENT" });
    },
  };

  const MapUi = {
    text,
    addLayerControl() {},
    setupLocationPanel(handlers) {
      uiState.setupCalls += 1;
      uiState.locateHandler = handlers.onLocate;
      uiState.confirmHandlers.push(handlers.onConfirm);
    },
    setLineSummaryHandler(handler) {
      uiState.lineSummaryHandler = handler;
    },
    setLineSummaryButtonState(state) {
      uiState.lineSummaryStates.push({ ...state });
    },
    syncMobilePointConfirmButton(state) {
      uiState.mobileStates.push({ ...state });
    },
    setConfirmEnabled(value) {
      uiState.confirmEnabled.push(Boolean(value));
    },
    setLocationActionsEnabled(value) {
      uiState.actionEnabled.push(Boolean(value));
    },
    showGpsLoading() {
      uiState.gpsLoading += 1;
    },
    showGpsReady(location) {
      uiState.gpsReady.push({ ...location });
    },
    showMapSelectionReady(location) {
      uiState.mapReady.push({ ...location });
    },
    showDragSelectionReady(location) {
      uiState.dragReady.push({ ...location });
    },
    showLocationMessage(message) {
      uiState.messages.push(message);
    },
    getGeolocationErrorMessage() {
      return "geolocation error";
    },
    showAnalysisLoading() {},
    showApiError() {
      uiState.apiErrors += 1;
    },
    renderResultPanel(payload) {
      uiState.renderedResults.push(payload);
    },
    closeCurrentResultPanel() {},
    setResultPanelCloseHandler() {},
    clearLineSummaryStatus() {},
    isMobileLayout() {
      return true;
    },
    createPopupContent() {
      return "popup";
    },
    renderTemporaryParcelList() {},
    addParcelDrawControl() {
      return {};
    },
    setParcelControlState(state) {
      uiState.parcelControlStates.push({ ...state });
    },
  };

  const MapLiffMode = {
    isEnabled: () => options.liffEnabled !== false,
    initialize: () =>
      options.liffInitializeRejects
        ? Promise.reject(new Error("LIFF init failed"))
        : Promise.resolve(true),
    isReady: () => options.liffReady !== false,
    getIdToken: () => "id-token",
    getErrorMessage: () => "LIFF unavailable",
    isInClient: () => true,
    closeWindow: () => true,
  };

  const MapParcelManagement = {
    init() {
      uiState.parcelInitCalls += 1;
      if (options.parcelInitThrows) {
        throw new Error("parcel init failed");
      }
    },
    setLiffReady(value) {
      uiState.parcelReadyValues.push(Boolean(value));
    },
  };

  const navigator = {
    geolocation: {
      getCurrentPosition(success) {
        success({
          coords: {
            latitude: options.gpsLat || 19.039564,
            longitude: options.gpsLng || 99.888847,
            accuracy: 12,
          },
        });
      },
    },
  };

  const window = {
    AppConfig: {
      map: {
        center: [19.1, 99.9],
        zoom: 12,
        maxZoom: 18,
      },
    },
    MapApi,
    MapLayers: {
      createBaseLayers() {
        return {
          googleSatellite: {
            addTo() {},
          },
          openStreetMap: {},
        };
      },
      createOverlayLayers() {
        return {};
      },
    },
    MapLiffMode,
    MapParcelManagement,
    MapParcelState: {
      ensurePersistenceState(parcel) {
        if (!parcel.persistence) {
          parcel.persistence = {};
        }
        return parcel.persistence;
      },
      isValidGeoJsonGeometry() {
        return false;
      },
    },
    MapPointState: pointState,
    MapUi,
    isSecureContext: true,
    matchMedia() {
      return {
        matches: true,
        addEventListener() {},
        addListener() {},
      };
    },
    crypto: {
      randomUUID: () => "tmp-id",
    },
    addEventListener: windowEvents.addEventListener,
    removeEventListener: windowEvents.removeEventListener,
    dispatchEvent: windowEvents.dispatchEvent,
    setTimeout,
    clearTimeout,
    console: {
      warn(message) {
        uiState.warnings.push(String(message));
      },
    },
  };

  const document = {
    addEventListener: documentEvents.addEventListener,
    removeEventListener: documentEvents.removeEventListener,
  };

  const context = {
    window,
    document,
    navigator,
    L: createLeafletStub(leafletState),
    AbortController,
    Error,
    TypeError,
    Promise,
    console: window.console,
    setTimeout,
    clearTimeout,
  };

  vm.createContext(context);
  vm.runInContext(mapSource, context);
  window.dispatchEvent({ type: "DOMContentLoaded" });

  return {
    apiCalls,
    pendingReports,
    uiState,
    map: leafletState.map,
    get marker() {
      return leafletState.marker;
    },
  };
}

function pointPayload(lat = 19.039564, lng = 99.888847) {
  return {
    found: true,
    clickedPoint: { latitude: lat, longitude: lng },
    location: { province: "Phayao" },
    soil: {},
    water: {},
    riceLandSuitability: { class: "S1", label: "good", sourceName: "test" },
    maizeLandSuitability: { class: "S2", label: "ok", sourceName: "test" },
  };
}

function last(items) {
  return items[items.length - 1];
}

test("mobile point confirm DOM is singular, real, and bound once in UI source", () => {
  assert.equal((uiSource.match(/id = "mobile-point-confirm"/g) || []).length, 1);
  assert.equal(
    (uiSource.match(/mobileConfirmButton\.addEventListener\("click", onConfirm\)/g) || [])
      .length,
    1,
  );
  assert.match(uiSource, /button\.type = "button"/);
  assert.doesNotMatch(uiSource, /cloneNode\(/);
  assert.doesNotMatch(uiSource, /mobile-point-actions[\s\S]*innerHTML/);
});

test("GPS selection enables mobile confirmation without LIFF auth readiness", async () => {
  const harness = createMapHarness({ liffReady: false, liffInitializeRejects: true });
  await nextTick();

  harness.uiState.locateHandler();

  assert.equal(harness.uiState.gpsLoading, 1);
  assert.equal(harness.uiState.gpsReady.length, 1);
  assert.equal(last(harness.uiState.confirmEnabled), true);
  assert.equal(last(harness.uiState.mobileStates).hasSelectedPoint, true);
  assert.equal(last(harness.uiState.mobileStates).isBlocked, false);
});

test("map click enables confirmation and marker drag invalidates the previous result", async () => {
  const harness = createMapHarness();
  await nextTick();

  harness.map.fire("click", { latlng: { lat: 19.12, lng: 99.72 } });
  assert.equal(harness.uiState.mapReady.length, 1);
  assert.equal(last(harness.uiState.mobileStates).hasSelectedPoint, true);

  const confirm = harness.uiState.confirmHandlers[0]();
  assert.equal(harness.apiCalls.length, 1);
  harness.pendingReports[0].resolve(pointPayload(19.12, 99.72));
  await confirm;
  assert.equal(harness.uiState.renderedResults.length, 1);
  assert.equal(last(harness.uiState.lineSummaryStates).visible, true);

  harness.marker.setLatLng([19.25, 99.75]);
  harness.marker.trigger("dragstart");
  harness.marker.trigger("dragend");

  assert.equal(harness.uiState.dragReady.length, 1);
  assert.equal(last(harness.uiState.lineSummaryStates).visible, false);
  assert.equal(last(harness.uiState.mobileStates).hasSelectedPoint, true);
});

test("confirm sends one ordinary point analysis request and shows loading immediately", async () => {
  const harness = createMapHarness();
  await nextTick();
  harness.uiState.locateHandler();

  const firstConfirm = harness.uiState.confirmHandlers[0]();
  const secondConfirm = harness.uiState.confirmHandlers[0]();

  assert.deepEqual(
    harness.apiCalls.map((call) => call.method),
    ["getLocationReport"],
  );
  assert.equal(last(harness.uiState.mobileStates).isLoading, true);
  assert.ok(harness.uiState.messages.includes("Loading area data"));
  assert.equal(harness.apiCalls[0].lat, 19.039564);
  assert.equal(harness.apiCalls[0].lng, 99.888847);

  harness.pendingReports[0].resolve(pointPayload());
  await Promise.all([firstConfirm, secondConfirm]);

  assert.equal(harness.uiState.renderedResults.length, 1);
  assert.equal(last(harness.uiState.lineSummaryStates).visible, true);
});

test("failed point request shows sanitized LIFF error text", async () => {
  const harness = createMapHarness();
  await nextTick();
  harness.map.fire("click", { latlng: { lat: 19.44, lng: 99.11 } });

  const confirm = harness.uiState.confirmHandlers[0]();
  const error = new Error("raw backend detail that should not render");
  error.statusCode = 500;
  harness.pendingReports[0].reject(error);
  await confirm;

  assert.equal(harness.uiState.renderedResults.length, 0);
  assert.equal(last(harness.uiState.messages), "Unable to load area data");
});

test("stale point response cannot replace a newer selected point result", async () => {
  const harness = createMapHarness();
  await nextTick();

  harness.map.fire("click", { latlng: { lat: 19.01, lng: 99.01 } });
  const confirm = harness.uiState.confirmHandlers[0]();
  harness.map.fire("click", { latlng: { lat: 19.02, lng: 99.02 } });

  harness.pendingReports[0].resolve(pointPayload(19.01, 99.01));
  await confirm;

  assert.equal(harness.uiState.renderedResults.length, 0);
  assert.equal(last(harness.uiState.mobileStates).hasSelectedPoint, true);
});

test("Phase 5 parcel initialization failure cannot block point handler registration", async () => {
  const harness = createMapHarness({ parcelInitThrows: true });
  await nextTick();

  assert.equal(harness.uiState.setupCalls, 1);
  assert.equal(harness.uiState.confirmHandlers.length, 1);
  assert.equal(harness.map.listenerCount("click"), 1);

  harness.map.fire("click", { latlng: { lat: 19.31, lng: 99.31 } });
  const confirm = harness.uiState.confirmHandlers[0]();

  assert.equal(harness.apiCalls.length, 1);
  assert.equal(harness.apiCalls[0].method, "getLocationReport");
  assert.equal(harness.uiState.warnings.length, 1);

  harness.pendingReports[0].resolve(pointPayload(19.31, 99.31));
  await confirm;
  assert.equal(harness.uiState.renderedResults.length, 1);
});

test("closed parcel sheets are removed and cannot leave an intercepting backdrop", () => {
  const closeSheetSource = managementSource.match(
    /function closeSheet\(sheet\) \{[\s\S]*?\n  \}/,
  )[0];
  const createSheetSource = managementSource.match(
    /function createSheet\(id, title\) \{[\s\S]*?return \{ backdrop, body \};\n  \}/,
  )[0];

  assert.match(closeSheetSource, /sheet\.remove\(\)/);
  assert.match(createSheetSource, /createElement\("div", "parcel-sheet-backdrop"\)/);
  assert.match(cssSource, /\.parcel-sheet-backdrop \{[\s\S]*position: fixed/);
  assert.match(cssSource, /\.parcel-sheet-backdrop \{[\s\S]*z-index: 1250/);
  assert.doesNotMatch(closeSheetSource, /hidden = true|opacity = "0"|style\.display/);
});

test("point confirmation source no longer depends on token-bearing LIFF analysis", () => {
  assert.match(mapSource, /async function requestPointAnalysis\(location, options\) \{[\s\S]*MapApi\.getLocationReport/);
  assert.doesNotMatch(
    mapSource.match(/async function requestPointAnalysis\(location, options\) \{[\s\S]*?\n  \}/)[0],
    /analyzeLineLocation|getIdToken|isReady/,
  );
  assert.doesNotMatch(
    mapSource.match(/async function confirmSelectedLocation\(\) \{[\s\S]*?\n  \}/)[0],
    /isLiffConfirmationUnavailable\(\)/,
  );
});
