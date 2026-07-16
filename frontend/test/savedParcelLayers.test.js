const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const frontendRoot = path.resolve(__dirname, "..");
const mapSource = fs.readFileSync(path.join(frontendRoot, "js/map.js"), "utf8");
const parcelState = require("../js/parcel-state");

const PARCEL_A_ID = "11111111-1111-4111-8111-111111111111";
const PARCEL_B_ID = "22222222-2222-4222-8222-222222222222";

function polygon(offset) {
  return {
    type: "Polygon",
    coordinates: [[
      [99 + offset, 19],
      [99.001 + offset, 19],
      [99.001 + offset, 19.001],
      [99 + offset, 19.001],
      [99 + offset, 19],
    ]],
  };
}

function multiPolygon(offset) {
  return {
    type: "MultiPolygon",
    coordinates: [
      polygon(offset).coordinates,
      polygon(offset + 0.004).coordinates,
    ],
  };
}

function parcel(id, name, geometry = polygon(0)) {
  return {
    id,
    parcelCode: id === PARCEL_A_ID ? "PY-2026-0016" : "PY-2026-0017",
    parcelName: name,
    cropType: id === PARCEL_A_ID ? "rice" : "maize",
    riceVariety: id === PARCEL_A_ID ? "มม.1" : "โพด3",
    plantingDate: "2026-07-16",
    areaSqm: id === PARCEL_A_ID ? 801.09 : 772.4,
    areaRai: id === PARCEL_A_ID ? 0.5 : 0.48,
    geometry,
    updatedAt: id === PARCEL_A_ID
      ? "2026-07-16T09:40:56.527Z"
      : "2026-07-16T09:41:26.085Z",
  };
}

function nextTick() {
  return Promise.resolve();
}

function createEventTarget() {
  const listeners = new Map();
  return {
    on(type, handler) {
      const handlers = listeners.get(type) || [];
      handlers.push(handler);
      listeners.set(type, handlers);
      return this;
    },
    addEventListener(type, handler) {
      return this.on(type, handler);
    },
    removeEventListener(type, handler) {
      const handlers = listeners.get(type) || [];
      listeners.set(
        type,
        handlers.filter((item) => item !== handler),
      );
    },
    dispatchEvent(event) {
      (listeners.get(event.type) || []).slice().forEach((handler) => handler(event));
    },
    listenerCount(type) {
      return (listeners.get(type) || []).length;
    },
    listeners(type) {
      return (listeners.get(type) || []).slice();
    },
  };
}

function createLeafletStub(state) {
  class FeatureGroup {
    constructor() {
      this.layers = [];
      this.clearCount = 0;
      state.featureGroups.push(this);
    }
    addTo(map) {
      this.map = map;
      state.addedGroups.push(this);
      return this;
    }
    addLayer(layer) {
      if (!this.layers.includes(layer)) {
        this.layers.push(layer);
      }
      layer.parentGroup = this;
      return this;
    }
    removeLayer(layer) {
      this.layers = this.layers.filter((item) => item !== layer);
      if (layer) {
        layer.parentGroup = null;
      }
      return this;
    }
    clearLayers() {
      this.clearCount += 1;
      this.layers.forEach((layer) => {
        layer.parentGroup = null;
      });
      this.layers = [];
      return this;
    }
    getLayers() {
      return this.layers.slice();
    }
  }

  function createGeoJsonLayer(data, options = {}) {
    const target = createEventTarget();
    const layer = {
      data,
      options,
      style: options.style || {},
      styleHistory: [options.style || {}],
      editing: {
        enabled: false,
        enable() {
          this.enabled = true;
        },
        disable() {
          this.enabled = false;
        },
      },
      addTo(group) {
        group.addLayer(this);
        return this;
      },
      setStyle(style) {
        this.style = style;
        this.styleHistory.push(style);
        return this;
      },
      getBounds() {
        return {
          parcelId: data?.properties?.parcelId,
          isValid: () => true,
          getCenter: () => ({ lat: 19, lng: 99 }),
        };
      },
      getLayers() {
        return [this];
      },
      eachLayer(callback) {
        callback(this);
      },
      on: target.on,
      fire(type, payload = {}) {
        const event = {
          type,
          target: this,
          latlng: payload.latlng || { lat: 19, lng: 99 },
          originalEvent: payload.originalEvent || {},
          stopPropagation() {
            this._stopped = true;
          },
        };
        target.dispatchEvent(event);
        if (
          type === "click" &&
          options.bubblingMouseEvents !== false &&
          state.map &&
          !event._stopped &&
          !event.originalEvent._stopped
        ) {
          state.map.fire("click", { latlng: event.latlng });
        }
        return this;
      },
      listenerCount: target.listenerCount,
      bindPopup() {
        return this;
      },
      openPopup() {
        return this;
      },
      closePopup() {
        return this;
      },
      getLatLngs() {
        return [];
      },
      toGeoJSON() {
        return data;
      },
    };
    if (typeof options.onEachFeature === "function") {
      options.onEachFeature(data, layer);
    }
    state.geoJsonLayers.push(layer);
    return layer;
  }

  return {
    FeatureGroup,
    map() {
      const target = createEventTarget();
      state.map = {
        on: target.on,
        fire(type, payload) {
          target.dispatchEvent({ type, ...payload });
        },
        setView() {
          return this;
        },
        fitBounds(bounds, options) {
          state.fitBounds.push({ bounds, options });
          return this;
        },
        panTo() {
          return this;
        },
        listenerCount: target.listenerCount,
      };
      return state.map;
    },
    marker(latLng) {
      state.marker = {
        latLng,
        addTo() {
          return this;
        },
        on() {
          return this;
        },
        setLatLng(nextLatLng) {
          this.latLng = nextLatLng;
          return this;
        },
        getLatLng() {
          return Array.isArray(this.latLng)
            ? { lat: this.latLng[0], lng: this.latLng[1] }
            : this.latLng;
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
    geoJSON: createGeoJsonLayer,
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
      stopPropagation(event) {
        if (event) {
          event._stopped = true;
        }
      },
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

function createHarness(options = {}) {
  const windowEvents = createEventTarget();
  const documentEvents = createEventTarget();
  const leafletState = {
    featureGroups: [],
    addedGroups: [],
    geoJsonLayers: [],
    fitBounds: [],
  };
  const apiCalls = [];
  const uiState = {
    renderedSavedDetails: [],
    renderedParcelResults: [],
    closeResultPanelCalls: 0,
    closedMyParcelSheets: 0,
    refreshedOpenLists: 0,
    mapReady: [],
    mobileStates: [],
    confirmEnabled: [],
    parcelControlStates: [],
    parcelControlHandlers: null,
    messages: [],
  };
  let parcelHandlers = null;

  const MapParcelManagement = {
    init(handlers) {
      parcelHandlers = handlers;
    },
    setLiffReady() {},
    closeMyParcelsSheet() {
      uiState.closedMyParcelSheets += 1;
    },
    confirmOpenSavedParcel: async () => true,
    refreshMyParcelsIfOpen() {
      uiState.refreshedOpenLists += 1;
      return options.refreshOpenList || false;
    },
    renderSaveAction() {},
    getFriendlyError() {
      return "ไม่สามารถโหลดข้อมูลแปลงได้";
    },
  };

  const MapApi = {
    listMyParcels: async () => {
      apiCalls.push({ method: "listMyParcels" });
      return { success: true, parcels: options.listParcels || [] };
    },
    getMyParcel: async (id) => {
      apiCalls.push({ method: "getMyParcel", id });
      return {
        success: true,
        parcel: (options.detailParcels || []).find((item) => item.id === id),
      };
    },
    analyzeMyParcel: async (id) => {
      apiCalls.push({ method: "analyzeMyParcel", id });
      return { success: true };
    },
    updateMyParcel: async (id, patch) => {
      apiCalls.push({ method: "updateMyParcel", id, patch });
      if (options.updateParcelRejects) {
        const error = new Error("raw owner detail should not leak");
        error.statusCode = options.updateStatusCode || 500;
        throw error;
      }
      return {
        success: true,
        parcel: options.updatedParcel || {
          ...(options.detailParcels || options.listParcels || []).find((item) => item.id === id),
          ...patch,
          id,
          areaSqm: 1800,
          areaRai: 1.13,
          updatedAt: "2026-07-16T10:00:00.000Z",
        },
      };
    },
    getLocationReport: async () => ({ success: true }),
  };

  const window = {
    location: { search: "" },
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
    MapLiffMode: {
      isEnabled: () => true,
      initialize: () => Promise.resolve(true),
      isReady: () => true,
      getErrorMessage: () => "LIFF unavailable",
    },
    MapParcelManagement,
    MapParcelState: parcelState,
    MapPointState: require("../js/point-state"),
    MapUi: {
      text: {
        lineSummarySentShort: "sent",
        lineSummarySendingShort: "sending",
        lineSummary: "line",
        apiError: "api error",
        parcelEditLocked: "locked",
        positionUnavailable: "position unavailable",
        secureContext: "secure",
        unsupported: "unsupported",
        saveBoundary: "บันทึกขอบเขต",
        cancel: "ยกเลิก",
      },
      addLayerControl() {},
      setupLocationPanel() {},
      setLineSummaryHandler() {},
      syncMobilePointConfirmButton(state) {
        uiState.mobileStates.push({ ...state });
      },
      setLineSummaryButtonState() {},
      clearLineSummaryStatus() {},
      setLocationActionsEnabled() {},
      setConfirmEnabled(value) {
        uiState.confirmEnabled.push(Boolean(value));
      },
      showLocationMessage(message) {
        uiState.messages.push(message);
      },
      showMapSelectionReady(location) {
        uiState.mapReady.push({ ...location });
      },
      setParcelControlState(state) {
        uiState.parcelControlStates.push({ ...state });
      },
      addParcelDrawControl(map, handlers) {
        uiState.parcelControlHandlers = handlers;
      },
      renderTemporaryParcelList() {},
      setResultPanelCloseHandler() {},
      renderSavedParcelDetail(parcel, message) {
        uiState.renderedSavedDetails.push({ parcel, message });
      },
      renderParcelResult(parcel) {
        uiState.renderedParcelResults.push(parcel);
      },
      closeCurrentResultPanel() {
        uiState.closeResultPanelCalls += 1;
      },
    },
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
    addEventListener: windowEvents.addEventListener.bind(windowEvents),
    removeEventListener: windowEvents.removeEventListener.bind(windowEvents),
    dispatchEvent: windowEvents.dispatchEvent.bind(windowEvents),
    setTimeout,
    clearTimeout,
    console: {
      warn() {},
    },
  };

  const document = {
    addEventListener: documentEvents.addEventListener.bind(documentEvents),
    removeEventListener: documentEvents.removeEventListener.bind(documentEvents),
  };

  const context = {
    window,
    document,
    navigator: { geolocation: {} },
    L: createLeafletStub(leafletState),
    URLSearchParams,
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
  assert.ok(parcelHandlers);

  return {
    apiCalls,
    leafletState,
    parcelHandlers,
    uiState,
    get savedGroup() {
      return leafletState.featureGroups.find((group) => group.layers.length > 0) ||
        leafletState.featureGroups[1];
    },
  };
}

test("opening My Parcels renders every returned owned parcel without pressing view", () => {
  const parcels = [
    parcel(PARCEL_A_ID, "ข้าวจ้า", polygon(0)),
    parcel(PARCEL_B_ID, "ข้าวโพดจ้า", polygon(0.002)),
  ];
  const harness = createHarness();

  const result = harness.parcelHandlers.onParcelsLoaded(parcels);

  assert.equal(result.rendered, 2);
  assert.equal(result.skipped, 0);
  assert.equal(harness.savedGroup.layers.length, 2);
  assert.notEqual(harness.savedGroup.layers[0], harness.savedGroup.layers[1]);
  assert.deepEqual(
    harness.savedGroup.layers.map((layer) => layer._mapPhayaoParcelId).sort(),
    [PARCEL_A_ID, PARCEL_B_ID],
  );
  assert.deepEqual(harness.apiCalls, []);
});

test("saved parcel polygon tap opens details without creating or moving the point marker", async () => {
  const parcelA = parcel(PARCEL_A_ID, "เธเนเธฒเธงเธเนเธฒ", polygon(0));
  const parcelB = parcel(PARCEL_B_ID, "เธเนเธฒเธงเนเธเธ”เธเนเธฒ", polygon(0.002));
  const harness = createHarness();
  harness.parcelHandlers.onParcelsLoaded([parcelA, parcelB]);
  const layerA = harness.savedGroup.layers.find((layer) => layer._mapPhayaoParcelId === PARCEL_A_ID);
  const layerB = harness.savedGroup.layers.find((layer) => layer._mapPhayaoParcelId === PARCEL_B_ID);

  assert.equal(layerA.listenerCount("click"), 1);
  layerA.fire("click", {
    latlng: { lat: 19.555, lng: 99.555 },
    originalEvent: {},
  });
  await nextTick();

  assert.equal(harness.uiState.renderedSavedDetails.at(-1).parcel.id, PARCEL_A_ID);
  assert.equal(layerA.style.color, "#ea580c");
  assert.equal(layerB.style.color, "#166534");
  assert.equal(harness.savedGroup.layers.length, 2);
  assert.equal(harness.leafletState.marker, undefined);
  assert.equal(harness.uiState.mapReady.length, 0);
  assert.equal(
    harness.apiCalls.some((call) => call.method === "getLocationReport"),
    false,
  );
});

test("saved parcel tap restores previous highlight and MultiPolygon paths resolve to the parcel", async () => {
  const parcelA = parcel(PARCEL_A_ID, "เธเนเธฒเธงเธเนเธฒ", polygon(0));
  const parcelB = parcel(PARCEL_B_ID, "เธเนเธฒเธงเนเธเธ”เธเนเธฒ", multiPolygon(0.002));
  const harness = createHarness();
  harness.parcelHandlers.onParcelsLoaded([parcelA, parcelB]);
  const layerA = harness.savedGroup.layers.find((layer) => layer._mapPhayaoParcelId === PARCEL_A_ID);
  const layerB = harness.savedGroup.layers.find((layer) => layer._mapPhayaoParcelId === PARCEL_B_ID);

  layerA.fire("click", { originalEvent: {} });
  await nextTick();
  layerB.fire("click", { originalEvent: {} });
  await nextTick();

  assert.equal(harness.uiState.renderedSavedDetails.at(-1).parcel.id, PARCEL_B_ID);
  assert.equal(layerA.style.color, "#166534");
  assert.equal(layerB.style.color, "#ea580c");
  assert.equal(harness.savedGroup.layers.length, 2);
});

test("rebuilding saved layers keeps one click handler per persisted layer", () => {
  const parcels = [
    parcel(PARCEL_A_ID, "เธเนเธฒเธงเธเนเธฒ", polygon(0)),
    parcel(PARCEL_B_ID, "เธเนเธฒเธงเนเธเธ”เธเนเธฒ", polygon(0.002)),
  ];
  const harness = createHarness();

  harness.parcelHandlers.onParcelsLoaded(parcels);
  harness.parcelHandlers.onParcelsLoaded(parcels);

  harness.savedGroup.layers.forEach((layer) => {
    assert.equal(layer.listenerCount("click"), 1);
  });
});

test("empty map click still creates a point marker and enables point confirmation", () => {
  const harness = createHarness();

  harness.leafletState.map.fire("click", { latlng: { lat: 19.12, lng: 99.72 } });

  assert.deepEqual(harness.leafletState.marker.getLatLng(), { lat: 19.12, lng: 99.72 });
  assert.equal(harness.uiState.mapReady.length, 1);
  assert.equal(harness.uiState.mobileStates.at(-1).hasPendingPoint, true);
});

test("selecting saved parcels fits and highlights one without removing the other", async () => {
  const parcelA = parcel(PARCEL_A_ID, "ข้าวจ้า", polygon(0));
  const parcelB = parcel(PARCEL_B_ID, "ข้าวโพดจ้า", polygon(0.002));
  const harness = createHarness();
  harness.parcelHandlers.onParcelsLoaded([parcelA, parcelB]);
  const layerA = harness.savedGroup.layers.find((layer) => layer._mapPhayaoParcelId === PARCEL_A_ID);
  const layerB = harness.savedGroup.layers.find((layer) => layer._mapPhayaoParcelId === PARCEL_B_ID);

  await harness.parcelHandlers.onOpenParcel(parcelA);
  assert.equal(harness.savedGroup.layers.length, 2);
  assert.equal(harness.leafletState.fitBounds.length, 1);
  assert.equal(layerA.style.color, "#ea580c");
  assert.equal(layerB.style.color, "#166534");

  await harness.parcelHandlers.onOpenParcel(parcelB);
  assert.equal(harness.savedGroup.layers.length, 2);
  assert.equal(harness.leafletState.fitBounds.length, 2);
  assert.equal(layerA.style.color, "#166534");
  assert.equal(layerB.style.color, "#ea580c");
  assert.equal(harness.uiState.renderedSavedDetails.at(-1).parcel.id, PARCEL_B_ID);
  assert.equal(harness.uiState.closedMyParcelSheets, 2);
});

test("reopening the list rebuilds owned parcel layers without duplicates", () => {
  const parcels = [
    parcel(PARCEL_A_ID, "ข้าวจ้า", polygon(0)),
    parcel(PARCEL_B_ID, "ข้าวโพดจ้า", polygon(0.002)),
  ];
  const harness = createHarness();

  harness.parcelHandlers.onParcelsLoaded(parcels);
  harness.parcelHandlers.onParcelsLoaded(parcels);

  assert.equal(harness.savedGroup.layers.length, 2);
  assert.equal(new Set(harness.savedGroup.layers).size, 2);
});

test("update and delete affect only the matching persisted parcel layer", async () => {
  const parcelA = parcel(PARCEL_A_ID, "ข้าวจ้า", polygon(0));
  const parcelB = parcel(PARCEL_B_ID, "ข้าวโพดจ้า", polygon(0.002));
  const updatedA = parcel(PARCEL_A_ID, "ข้าวจ้าใหม่", polygon(0.004));
  const harness = createHarness();
  harness.parcelHandlers.onParcelsLoaded([parcelA, parcelB]);

  harness.parcelHandlers.onParcelUpdated(updatedA);
  assert.equal(harness.savedGroup.layers.length, 2);
  const replacementA = harness.savedGroup.layers.find((layer) => layer._mapPhayaoParcelId === PARCEL_A_ID);
  const untouchedB = harness.savedGroup.layers.find((layer) => layer._mapPhayaoParcelId === PARCEL_B_ID);
  assert.deepEqual(replacementA.data.geometry, updatedA.geometry);
  assert.deepEqual(untouchedB.data.geometry, parcelB.geometry);

  await harness.parcelHandlers.onOpenParcel(updatedA);
  harness.parcelHandlers.onParcelDeleted(PARCEL_A_ID);

  assert.equal(harness.savedGroup.layers.length, 1);
  assert.equal(harness.savedGroup.layers[0]._mapPhayaoParcelId, PARCEL_B_ID);
  assert.equal(harness.uiState.closeResultPanelCalls, 1);
});

test("saved boundary edit mode edits only the selected parcel and blocks point selection", async () => {
  const parcelA = parcel(PARCEL_A_ID, "เธเนเธฒเธงเธเนเธฒ", polygon(0));
  const parcelB = parcel(PARCEL_B_ID, "เธเนเธฒเธงเนเธเธ”เธเนเธฒ", polygon(0.002));
  const harness = createHarness();
  harness.parcelHandlers.onParcelsLoaded([parcelA, parcelB]);

  await harness.parcelHandlers.onEditBoundary(parcelA);
  const editGroup = harness.leafletState.featureGroups[2];

  assert.equal(harness.savedGroup.layers.length, 2);
  assert.equal(editGroup.layers.length, 1);
  assert.equal(editGroup.layers[0]._mapPhayaoParcelId, PARCEL_A_ID);
  assert.equal(editGroup.layers[0].editing.enabled, true);
  assert.equal(harness.savedGroup.layers.find((layer) => layer._mapPhayaoParcelId === PARCEL_B_ID).style.color, "#166534");
  assert.equal(harness.uiState.parcelControlStates.at(-1).saveText, "บันทึกขอบเขต");
  assert.equal(harness.uiState.parcelControlStates.at(-1).drawDisabled, true);

  harness.leafletState.map.fire("click", { latlng: { lat: 19.12, lng: 99.72 } });
  assert.equal(harness.leafletState.marker, undefined);
  assert.equal(harness.uiState.mapReady.length, 0);
  assert.equal(harness.uiState.mobileStates.at(-1).isBlocked, true);
});

test("saving a saved boundary sends geometry and replaces only that persisted layer", async () => {
  const parcelA = parcel(PARCEL_A_ID, "เธเนเธฒเธงเธเนเธฒ", polygon(0));
  const parcelB = parcel(PARCEL_B_ID, "เธเนเธฒเธงเนเธเธ”เธเนเธฒ", polygon(0.002));
  const updatedA = parcel(PARCEL_A_ID, "เธเนเธฒเธงเธเนเธฒ", polygon(0.006));
  const harness = createHarness({ updatedParcel: updatedA });
  harness.parcelHandlers.onParcelsLoaded([parcelA, parcelB]);

  await harness.parcelHandlers.onEditBoundary(parcelA);
  await harness.uiState.parcelControlHandlers.onSaveEdit();
  const editGroup = harness.leafletState.featureGroups[2];
  const replacementA = harness.savedGroup.layers.find((layer) => layer._mapPhayaoParcelId === PARCEL_A_ID);
  const untouchedB = harness.savedGroup.layers.find((layer) => layer._mapPhayaoParcelId === PARCEL_B_ID);

  assert.equal(harness.apiCalls.at(-1).method, "updateMyParcel");
  assert.equal(harness.apiCalls.at(-1).id, PARCEL_A_ID);
  assert.deepEqual(
    JSON.parse(JSON.stringify(harness.apiCalls.at(-1).patch.geometry)),
    parcelA.geometry,
  );
  assert.equal(editGroup.layers.length, 0);
  assert.deepEqual(replacementA.data.geometry, updatedA.geometry);
  assert.deepEqual(untouchedB.data.geometry, parcelB.geometry);
  assert.equal(harness.uiState.renderedSavedDetails.at(-1).parcel.areaRai, updatedA.areaRai);
});

test("canceling saved boundary edit discards the copy without an API request", async () => {
  const parcelA = parcel(PARCEL_A_ID, "เธเนเธฒเธงเธเนเธฒ", polygon(0));
  const harness = createHarness();
  harness.parcelHandlers.onParcelsLoaded([parcelA]);

  await harness.parcelHandlers.onEditBoundary(parcelA);
  harness.uiState.parcelControlHandlers.onCancelEdit();

  assert.equal(harness.leafletState.featureGroups[2].layers.length, 0);
  assert.equal(harness.apiCalls.some((call) => call.method === "updateMyParcel"), false);
  assert.deepEqual(harness.savedGroup.layers[0].data.geometry, parcelA.geometry);
});

test("failed saved boundary save keeps editable draft and original persisted layer", async () => {
  const parcelA = parcel(PARCEL_A_ID, "เธเนเธฒเธงเธเนเธฒ", polygon(0));
  const harness = createHarness({ updateParcelRejects: true });
  harness.parcelHandlers.onParcelsLoaded([parcelA]);

  await harness.parcelHandlers.onEditBoundary(parcelA);
  await harness.uiState.parcelControlHandlers.onSaveEdit();

  assert.equal(harness.leafletState.featureGroups[2].layers.length, 1);
  assert.deepEqual(harness.savedGroup.layers[0].data.geometry, parcelA.geometry);
  assert.equal(harness.uiState.messages.includes("raw owner detail should not leak"), false);
});

test("empty owned parcel list clears only persisted parcel layers", () => {
  const harness = createHarness();
  harness.parcelHandlers.onParcelsLoaded([
    parcel(PARCEL_A_ID, "ข้าวจ้า", polygon(0)),
    parcel(PARCEL_B_ID, "ข้าวโพดจ้า", polygon(0.002)),
  ]);
  const temporaryGroup = harness.leafletState.featureGroups[0];
  const marker = harness.leafletState.marker;

  const result = harness.parcelHandlers.onParcelsLoaded([]);

  assert.equal(result.rendered, 0);
  assert.equal(result.skipped, 0);
  assert.equal(harness.savedGroup.layers.length, 0);
  assert.equal(temporaryGroup.layers.length, 0);
  assert.equal(harness.leafletState.marker, marker);
});
