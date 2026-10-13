const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const frontendRoot = path.resolve(__dirname, "..");
const layersSource = fs.readFileSync(path.join(frontendRoot, "js/layers.js"), "utf8");
const mapSource = fs.readFileSync(path.join(frontendRoot, "js/map.js"), "utf8");

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

async function flushAsync() {
  for (let index = 0; index < 20; index += 1) {
    await nextTick();
  }
}

function collectText(node) {
  if (!node) {
    return "";
  }
  return `${node.textContent || ""}${(node.children || []).map(collectText).join("")}`;
}

function findNodes(node, predicate, results = []) {
  if (!node) {
    return results;
  }
  if (predicate(node)) {
    results.push(node);
  }
  (node.children || []).forEach((child) => findNodes(child, predicate, results));
  return results;
}

function feature(frequency, yearsDetected, overrides = {}) {
  return {
    type: "Feature",
    properties: {
      frequency,
      yearsDetected,
      startYear: 2020,
      endYear: 2024,
      subdistrict: "ต.ดอกคำใต้",
      district: "อ.ดอกคำใต้",
      source: "GISTDA",
      ...overrides,
    },
    geometry: {
      type: "Polygon",
      coordinates: [[
        [99, 19],
        [99.001, 19],
        [99.001, 19.001],
        [99, 19.001],
        [99, 19],
      ]],
    },
  };
}

function floodResponse(features = [feature(1, [2024])], properties = {}) {
  return {
    type: "FeatureCollection",
    properties: {
      startYear: 2020,
      endYear: 2024,
      years: [2020, 2021, 2022, 2023, 2024],
      yearCount: 5,
      datasetGeneration: "1",
      ...properties,
    },
    features,
  };
}

function createDomNode(tagName, className) {
  const classes = new Set((className || "").split(" ").filter(Boolean));
  const attributes = new Map();
  const listeners = new Map();
  return {
    tagName,
    className: className || "",
    children: [],
    style: {},
    hidden: false,
    textContent: "",
    classList: {
      add(name) { classes.add(name); },
      remove(name) { classes.delete(name); },
      contains(name) { return classes.has(name); },
      toggle(name) {
        if (classes.has(name)) { classes.delete(name); return false; }
        classes.add(name);
        return true;
      },
    },
    setAttribute(name, value) { attributes.set(name, value); },
    getAttribute(name) { return attributes.get(name); },
    addEventListener(name, handler) { listeners.set(name, handler); },
    click() { listeners.get("click")?.(); },
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    replaceChildren(...children) {
      this.children = children;
    },
  };
}

function createLeafletStub(state) {
  function createChildLayer(featureData, parent, options) {
    const listeners = new Map();
    const layer = {
      feature: featureData,
      parent,
      style: typeof options.style === "function"
        ? options.style(featureData)
        : options.style,
      popupHtml: "",
      on(type, handler) {
        const handlers = listeners.get(type) || [];
        handlers.push(handler);
        listeners.set(type, handlers);
        return this;
      },
      fire(type, payload = {}) {
        const event = {
          type,
          target: this,
          originalEvent: payload.originalEvent || {},
          stopPropagation() {
            this._stopped = true;
          },
        };
        (listeners.get(type) || []).forEach((handler) => handler(event));
        if (
          type === "click"
          && options.bubblingMouseEvents !== false
          && !event._stopped
          && !event.originalEvent._stopped
        ) {
          state.map.fire("click", {});
        }
        return event;
      },
      bindPopup(html) {
        this.popupHtml = html;
        return this;
      },
    };
    if (typeof options.onEachFeature === "function") {
      options.onEachFeature(featureData, layer);
    }
    return layer;
  }

  function createGeoJsonLayer(data, options = {}) {
    const layer = {
      options,
      children: [],
      addData(geojson) {
        const features = geojson?.type === "FeatureCollection"
          ? geojson.features || []
          : [geojson];
        features.forEach((featureData) => {
          if (typeof options.filter === "function" && !options.filter(featureData)) {
            return;
          }
          this.children.push(createChildLayer(featureData, this, options));
        });
        return this;
      },
      clearLayers() {
        this.children = [];
        return this;
      },
      getLayers() {
        return this.children.slice();
      },
    };
    if (data) {
      layer.addData(data);
    }
    state.geoJsonLayers.push(layer);
    return layer;
  }

  return {
    canvas(options) {
      state.canvasOptions.push(options);
      return { type: "canvas", options };
    },
    tileLayer(url, options) {
      const layer = { url, options };
      state.tileLayers.push(layer);
      return layer;
    },
    popup() {
      const popup = {
        latlng: null,
        content: "",
        setLatLng(latlng) { this.latlng = latlng; return this; },
        setContent(content) { this.content = content; return this; },
        openOn() { state.popups.push(this); return this; },
      };
      return popup;
    },
    geoJSON: createGeoJsonLayer,
    DomUtil: {
      create(tagName, className, parent) {
        const node = createDomNode(tagName, className);
        if (parent && typeof parent.appendChild === "function") {
          parent.appendChild(node);
        }
        return node;
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
    control(options) {
      return {
        options,
        addTo(map) {
          this.container = this.onAdd(map);
          state.controls.push(this);
          return this;
        },
      };
    },
  };
}

function createMapStub(state) {
  const listeners = new Map();
  const visibleLayers = new Set();
  const panes = new Map();
  const map = {
    on(type, handler) {
      const handlers = listeners.get(type) || [];
      handlers.push(handler);
      listeners.set(type, handlers);
      return this;
    },
    off(type, handler) {
      const handlers = listeners.get(type) || [];
      listeners.set(type, handlers.filter((item) => item !== handler));
      return this;
    },
    fire(type, payload = {}) {
      if (type === "click") {
        state.mapClicks += 1;
      }
      (listeners.get(type) || []).slice().forEach((handler) => handler({ type, ...payload }));
    },
    addOverlay(layer) {
      visibleLayers.add(layer);
      this.fire("overlayadd", { layer });
    },
    removeOverlay(layer) {
      visibleLayers.delete(layer);
      this.fire("overlayremove", { layer });
    },
    hasLayer(layer) {
      return visibleLayers.has(layer);
    },
    getBounds() {
      return {
        getWest: () => state.bounds[0],
        getSouth: () => state.bounds[1],
        getEast: () => state.bounds[2],
        getNorth: () => state.bounds[3],
      };
    },
    getZoom() {
      return 12;
    },
    createPane(name) {
      panes.set(name, { style: {} });
    },
    getPane(name) {
      return panes.get(name) || null;
    },
  };
  state.map = map;
  return map;
}

function createHarness(options = {}) {
  const state = {
    apiCalls: [],
    generationCalls: [],
    droughtCalls: [],
    pointCalls: [],
    pointResponses: options.pointResponses || [],
    canvasOptions: [],
    tileLayers: [],
    popups: [],
    controls: [],
    geoJsonLayers: [],
    mapClicks: 0,
    messages: [],
    bounds: [99.9, 19, 100, 19.1],
    now: options.now || 1_000_000,
  };
  const responses = options.responses || [floodResponse()];
  const generationResponses = options.generationResponses || [{ generation: "1" }];
  class HarnessDate extends Date {
    static now() {
      return state.now;
    }
  }
  const window = {
    AppConfig: {
      map: { maxZoom: 19 },
      data: {
        floodRasterTileUrl: "http://127.0.0.1/flood-tiles-lab/tiles_v1/{z}/{x}/{y}.png",
        thailandProvinceGeoJson: "data/thailand.geojson",
        layers: {
          tambon: "data/layers/tambon.geojson",
          amphoe: "data/layers/amphoe.geojson",
          basinMain: "data/layers/basin_main.geojson",
          subBasinDisplay: "data/layers/sub_basin_display.geojson",
          stream: "data/layers/stream.geojson",
          irrigationCanal: "data/layers/irrigation_canal.geojson",
          ricePotential: "data/layers/rice_potential.geojson",
          maizePotential: "data/layers/maize_potential.geojson",
        },
      },
    },
    MapApi: {
      getFloodRecurrenceGeneration: async (requestOptions) => {
        state.generationCalls.push({ requestOptions });
        const next = generationResponses.length > 1
          ? generationResponses.shift()
          : generationResponses[0];
        if (next && typeof next.then === "function") {
          return next;
        }
        if (next instanceof Error) {
          throw next;
        }
        return next || { generation: "1" };
      },
      getFloodRecurrenceLayer: async (bbox, zoom, requestOptions) => {
        state.apiCalls.push({ bbox, zoom, requestOptions });
        const next = responses.shift();
        if (next && typeof next.then === "function") {
          return next;
        }
        if (next instanceof Error) {
          throw next;
        }
        return next || floodResponse();
      },
      getFloodRecurrenceAtPoint: async (lat, lng, requestOptions) => {
        state.pointCalls.push({ lat, lng, requestOptions });
        const next = state.pointResponses.shift();
        if (next && typeof next.then === "function") return next;
        if (next instanceof Error) throw next;
        return next || { found: false };
      },
      getDroughtRecurrenceLayer: async () => {
        state.droughtCalls.push({});
        return floodResponse([]);
      },
    },
    MapUi: {
      showLocationMessage(message) {
        state.messages.push(message);
      },
    },
    setTimeout,
    clearTimeout,
    navigator: {
      connection: options.connection,
    },
    location: { search: options.search || "" },
    console: {
      error() {},
    },
  };
  const context = {
    window,
    L: createLeafletStub(state),
    AbortController,
    Error,
    Number,
    String,
    Promise,
    Date: HarnessDate,
    URLSearchParams,
    console: window.console,
    setTimeout,
    clearTimeout,
  };
  vm.createContext(context);
  vm.runInContext(layersSource, context);
  const map = createMapStub(state);
  const overlays = window.MapLayers.createOverlayLayers(map);
  const floodLayer = overlays.floodRecurrenceLayer;
  const floodController = overlays.lazyLayerControllers.get(floodLayer);
  return {
    state,
    map,
    overlays,
    floodLayer,
    floodController,
    get legend() {
      return state.controls[0]?.container;
    },
  };
}

test("flood recurrence layer is lazy and uses approved blue classes", async () => {
  const harness = createHarness({
    responses: [floodResponse([
      feature(1, [2024]),
      feature(2, [2023, 2024]),
      feature(4, [2020, 2021, 2023, 2024]),
      feature(0, []),
    ])],
  });

  assert.equal(harness.state.apiCalls.length, 0);
  harness.map.addOverlay(harness.floodLayer);
  await flushAsync();

  assert.equal(harness.state.apiCalls.length, 1);
  const styles = harness.floodLayer.getLayers().map((layer) => layer.style);
  assert.deepEqual(styles.map((style) => style.fillColor), ["#D9F0FF", "#7EC3F7", "#1F6FD6"]);
  assert.deepEqual(styles.map((style) => style.color), ["#7CB9DE", "#3B82C4", "#0F4FA8"]);
  assert.ok(harness.floodLayer.options.renderer);
  assert.equal(harness.floodLayer.getLayers().length, 3);
});

test("raster mode uses XYZ tiles through zoom 19 without requesting flood BBOX GeoJSON", async () => {
  const harness = createHarness({ search: "?floodRaster=1" });

  assert.equal(harness.floodLayer.url,
    "http://127.0.0.1/flood-tiles-lab/tiles_v1/{z}/{x}/{y}.png");
  assert.equal(harness.floodLayer.options.minZoom, 10);
  assert.equal(harness.floodLayer.options.maxNativeZoom, 16);
  assert.equal(harness.floodLayer.options.maxZoom, 19);
  harness.map.addOverlay(harness.floodLayer);
  await flushAsync();

  assert.equal(harness.state.apiCalls.length, 0);
  assert.equal(harness.state.generationCalls.length, 0);
});

test("raster point detail waits for confirmation and aborts stale lookups", async () => {
  const stale = createDeferred();
  const harness = createHarness({
    search: "?floodRaster=1",
    pointResponses: [
      stale.promise,
      {
        found: true,
        frequency: 3,
        yearsDetected: [2020, 2022, 2024],
        startYear: 2020,
        endYear: 2024,
        district: "เมืองพะเยา",
        subdistrict: "เวียง",
      },
    ],
  });
  harness.map.addOverlay(harness.floodLayer);
  harness.map.fire("click", { latlng: { lat: 19.03, lng: 99.9 } });
  await flushAsync();
  assert.equal(harness.state.mapClicks, 1);
  assert.equal(harness.state.pointCalls.length, 0);

  void harness.overlays.showFloodRasterPointDetail({ lat: 19.03, lng: 99.9 });
  await flushAsync();
  const firstSignal = harness.state.pointCalls[0].requestOptions.signal;
  await harness.overlays.showFloodRasterPointDetail({ lat: 19.04, lng: 99.91 });
  await flushAsync();

  assert.equal(firstSignal.aborted, true);
  assert.equal(harness.state.mapClicks, 1);
  assert.equal(harness.state.apiCalls.length, 0);
  assert.equal(harness.state.pointCalls.length, 2);
  assert.equal(harness.state.popups.length, 1);
  assert.match(harness.state.popups[0].content, /2020–2024/);
  assert.match(harness.state.popups[0].content, /2020, 2022, 2024/);

  stale.resolve({ found: true, frequency: 1, yearsDetected: [2024] });
  await flushAsync();
  assert.equal(harness.state.popups.length, 1);

  harness.map.removeOverlay(harness.floodLayer);
  await harness.overlays.showFloodRasterPointDetail({ lat: 19.05, lng: 99.92 });
  await flushAsync();
  assert.equal(harness.state.pointCalls.length, 2);
});

test("flood prefetch starts in the background without displaying layer or legend", async () => {
  const harness = createHarness();

  const result = await harness.floodController.prefetch();
  await flushAsync();

  assert.equal(harness.state.apiCalls.length, 1);
  assert.ok(result);
  assert.equal(harness.map.hasLayer(harness.floodLayer), false);
  assert.equal(harness.legend.hidden, true);
  assert.equal(harness.floodLayer.getLayers().length, 1);
  assert.equal(harness.state.messages.length, 0);
});

test("map startup schedules flood prefetch after map readiness and idle time", () => {
  assert.match(mapSource, /scheduleFloodRecurrencePrefetch/);
  assert.match(mapSource, /map\.whenReady\(scheduleIdle\)/);
  assert.match(mapSource, /requestIdleCallback\(startPrefetch, \{ timeout: 2000 \}\)/);
  assert.match(mapSource, /setTimeout\(startPrefetch, 750\)/);
});

test("flood enable after completed prefetch uses prepared cache without another request", async () => {
  const harness = createHarness();

  await harness.floodController.prefetch();
  await flushAsync();
  assert.equal(harness.state.apiCalls.length, 1);

  harness.map.addOverlay(harness.floodLayer);
  await flushAsync();

  assert.equal(harness.state.apiCalls.length, 1);
  assert.equal(harness.floodLayer.getLayers().length, 1);
  assert.equal(harness.legend.hidden, false);
  assert.match(collectText(harness.legend), /2020–2024/);
});

test("flood enable while prefetching waits for the same request", async () => {
  const pending = createDeferred();
  const harness = createHarness({ responses: [pending.promise] });

  const prefetchPromise = harness.floodController.prefetch();
  await flushAsync();
  harness.map.addOverlay(harness.floodLayer);
  await flushAsync();

  assert.equal(harness.state.apiCalls.length, 1);
  assert.equal(harness.state.messages[0], "กำลังโหลดข้อมูลน้ำท่วมซ้ำซาก…");
  pending.resolve(floodResponse());
  await prefetchPromise;
  await flushAsync();

  assert.equal(harness.state.apiCalls.length, 1);
  assert.equal(harness.floodLayer.getLayers().length, 1);
  assert.equal(harness.map.hasLayer(harness.floodLayer), true);
});

test("flood disable aborts prefetch and prevents stale cache population", async () => {
  const pending = createDeferred();
  const harness = createHarness({ responses: [pending.promise, floodResponse()] });

  const prefetchPromise = harness.floodController.prefetch();
  harness.map.addOverlay(harness.floodLayer);
  await flushAsync();
  harness.map.removeOverlay(harness.floodLayer);
  assert.equal(harness.state.apiCalls[0].requestOptions.signal.aborted, true);
  pending.resolve(floodResponse());
  await prefetchPromise;
  await flushAsync();

  assert.equal(harness.state.apiCalls.length, 1);
  assert.equal(harness.map.hasLayer(harness.floodLayer), false);
  assert.equal(harness.legend.hidden, true);

  harness.map.addOverlay(harness.floodLayer);
  await flushAsync();
  assert.equal(harness.state.apiCalls.length, 2);
  assert.equal(harness.floodLayer.getLayers().length, 1);
});

test("flood viewport change aborts the old request and suppresses its stale response", async () => {
  const pending = createDeferred();
  const harness = createHarness({ responses: [pending.promise, floodResponse([feature(3, [2022, 2023, 2024])])] });

  harness.map.addOverlay(harness.floodLayer);
  await flushAsync();
  const firstSignal = harness.state.apiCalls[0].requestOptions.signal;
  harness.state.bounds = [100.1, 19.1, 100.2, 19.2];
  const newerLoad = harness.floodController.load();
  await flushAsync();

  assert.equal(firstSignal.aborted, true);
  assert.equal(harness.state.apiCalls.length, 2);
  pending.resolve(floodResponse([feature(1, [2024])]));
  await newerLoad;
  await flushAsync();

  assert.match(harness.floodController.getState().dataKey, /^100\.100000,19\.100000/);
  assert.equal(harness.floodLayer.getLayers()[0].feature.properties.frequency, 3);
});

test("flood HTTP 413 is shown once and is not retried after an in-flight prefetch", async () => {
  const pending = createDeferred();
  const error = Object.assign(new Error("extent too large"), { statusCode: 413 });
  const harness = createHarness({ responses: [pending.promise, floodResponse()] });

  const prefetch = harness.floodController.prefetch();
  await flushAsync();
  harness.map.addOverlay(harness.floodLayer);
  await flushAsync();
  pending.reject(error);
  await prefetch;
  await flushAsync();

  assert.equal(harness.state.apiCalls.length, 1);
  assert.equal(harness.floodController.getState().status, "failed");
  assert.equal(harness.state.messages.includes("ไม่สามารถโหลดข้อมูลน้ำท่วมซ้ำซากได้ในขณะนี้"), true);
});

test("flood prefetch failures are silent and user-triggered retries remain possible", async () => {
  const harness = createHarness({
    responses: [new Error("prefetch failed"), new Error("user failed"), floodResponse()],
  });

  await harness.floodController.prefetch();
  await flushAsync();
  assert.equal(harness.state.apiCalls.length, 1);
  assert.equal(harness.state.messages.length, 0);

  harness.map.addOverlay(harness.floodLayer);
  await flushAsync();
  assert.equal(harness.state.apiCalls.length, 2);
  assert.equal(
    harness.state.messages.includes("ไม่สามารถโหลดข้อมูลน้ำท่วมซ้ำซากได้ในขณะนี้"),
    true,
  );

  harness.map.removeOverlay(harness.floodLayer);
  harness.map.addOverlay(harness.floodLayer);
  await flushAsync();
  assert.equal(harness.state.apiCalls.length, 3);
  assert.equal(harness.floodLayer.getLayers().length, 1);
});

test("flood prefetch respects save-data and slow connection hints", async () => {
  const saveData = createHarness({ connection: { saveData: true } });
  await saveData.floodController.prefetch();
  assert.equal(saveData.state.apiCalls.length, 0);

  const slow = createHarness({ connection: { effectiveType: "2g" } });
  await slow.floodController.prefetch();
  assert.equal(slow.state.apiCalls.length, 0);

  slow.map.addOverlay(slow.floodLayer);
  await flushAsync();
  assert.equal(slow.state.apiCalls.length, 1);
  assert.equal(slow.floodLayer.getLayers().length, 1);
});

test("flood prefetch does not change drought layer lifecycle", async () => {
  const harness = createHarness();

  await harness.floodController.prefetch();
  await flushAsync();
  assert.equal(harness.state.droughtCalls.length, 0);

  harness.map.addOverlay(harness.overlays.droughtRecurrenceLayer);
  await flushAsync();
  assert.equal(harness.state.droughtCalls.length, 1);
});

test("flood legend uses five-year blue classes and dynamic period", async () => {
  const harness = createHarness();

  harness.map.addOverlay(harness.floodLayer);
  await flushAsync();

  const text = collectText(harness.legend);
  const swatches = findNodes(harness.legend, (node) => node.className === "hazard-legend-swatch");
  assert.match(text, /จำนวนปีที่พบประวัติน้ำท่วมใน 5 ปีล่าสุด/);
  assert.match(text, /ช่วงข้อมูล: 2020–2024/);
  assert.match(text, /1 ปี/);
  assert.match(text, /2–3 ปี/);
  assert.match(text, /4–5 ปี/);
  assert.doesNotMatch(text, /4–6 ปี|7 ปีขึ้นไป|10 ปีล่าสุด/);
  assert.deepEqual(
    swatches.slice(0, 3).map((node) => node.style.backgroundColor),
    ["#D9F0FF", "#7EC3F7", "#1F6FD6"],
  );
});

test("hazard legend stays closed when layers are enabled and opens only on tap", async () => {
  const harness = createHarness();
  const legend = harness.legend;
  const toggle = findNodes(legend, (node) => node.className === "hazard-legend-mobile-toggle")[0];
  assert.equal(harness.state.controls[0].options.position, "topright");
  assert.equal(legend.hidden, true);

  harness.map.addOverlay(harness.floodLayer);
  assert.equal(legend.hidden, false);
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  assert.equal(findNodes(legend, (node) => node.tagName === "h4").length, 1);
  toggle.click();
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  await flushAsync();
  assert.equal(toggle.getAttribute("aria-expanded"), "true");

  harness.map.addOverlay(harness.overlays.droughtRecurrenceLayer);
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  assert.equal(findNodes(legend, (node) => node.tagName === "h4").length, 2);
  toggle.click();
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  harness.map.removeOverlay(harness.floodLayer);
  assert.equal(findNodes(legend, (node) => node.tagName === "h4").length, 1);
  assert.match(collectText(legend), /ภัยแล้ง/);
  harness.map.removeOverlay(harness.overlays.droughtRecurrenceLayer);
  assert.equal(legend.hidden, true);
  assert.equal(toggle.getAttribute("aria-expanded"), "false");

  harness.map.addOverlay(harness.overlays.droughtRecurrenceLayer);
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  toggle.click();
  toggle.click();
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
});

test("flood popup uses five-year values and safe admin labels", async () => {
  const harness = createHarness({
    responses: [floodResponse([
      feature(1, [2024], {
        yearsDetected: [2024],
        subdistrict: "ตำบลดอกคำใต้",
        district: "อำเภอดอกคำใต้",
      }),
    ])],
  });

  harness.map.addOverlay(harness.floodLayer);
  await flushAsync();

  const popup = harness.floodLayer.getLayers()[0].popupHtml;
  assert.match(popup, /ช่วงข้อมูล:<\/strong> 2020–2024/);
  assert.match(popup, /จำนวนปีที่พบ:<\/strong> 1/);
  assert.match(popup, /ปีที่พบ:<\/strong> 2024/);
  assert.doesNotMatch(popup, /2017|undefined|null|NaN|\[object Object\]/);
  assert.match(popup, /ตำบล:<\/strong> ต\.ดอกคำใต้/);
  assert.match(popup, /อำเภอ:<\/strong> อ\.ดอกคำใต้/);
  assert.doesNotMatch(popup, /ต\.ตำบล|อ\.อำเภอ/);
});

test("flood polygon click does not bubble to ordinary point selection", async () => {
  const harness = createHarness();

  harness.map.addOverlay(harness.floodLayer);
  await flushAsync();
  const originalEvent = {};
  const event = harness.floodLayer.getLayers()[0].fire("click", { originalEvent });

  assert.equal(originalEvent._stopped, true);
  assert.equal(event._stopped, true);
  assert.equal(harness.state.mapClicks, 0);
});

test("flood layer reuses successful session cache and does not duplicate legend", async () => {
  const harness = createHarness();

  harness.map.addOverlay(harness.floodLayer);
  await flushAsync();
  const firstLegend = harness.legend;
  assert.equal(harness.state.apiCalls.length, 1);
  assert.equal(harness.state.generationCalls.length, 1);

  harness.map.removeOverlay(harness.floodLayer);
  assert.equal(harness.floodLayer.getLayers().length, 1);
  harness.map.addOverlay(harness.floodLayer);
  await flushAsync();

  assert.equal(harness.state.apiCalls.length, 1);
  assert.equal(harness.state.generationCalls.length, 2);
  assert.equal(harness.legend, firstLegend);
  assert.equal(findNodes(harness.legend, (node) => node.tagName === "h4").length, 1);
  assert.equal(harness.floodLayer.getLayers().length, 1);
});

test("flood layer invalidates cached geometry when dataset generation changes", async () => {
  const harness = createHarness({
    generationResponses: [{ generation: "1" }, { generation: "2" }],
    responses: [
      floodResponse([feature(1, [2024])], { datasetGeneration: "1" }),
      floodResponse([feature(2, [2023, 2024])], { datasetGeneration: "2" }),
    ],
  });

  harness.map.addOverlay(harness.floodLayer);
  await flushAsync();
  assert.equal(harness.state.apiCalls.length, 1);

  harness.map.removeOverlay(harness.floodLayer);
  harness.map.addOverlay(harness.floodLayer);
  await flushAsync();

  assert.equal(harness.state.apiCalls.length, 2);
  assert.equal(harness.floodController.getState().generation, "2");
  assert.equal(harness.floodController.getState().cacheEntries, 1);
  assert.deepEqual(
    harness.floodLayer.getLayers().map((item) => item.feature.properties.frequency),
    [2],
  );
});

test("flood layer bypasses cache when generation probe fails", async () => {
  const harness = createHarness({
    generationResponses: [{ generation: "1" }, new Error("generation unavailable")],
    responses: [floodResponse(), floodResponse()],
  });

  harness.map.addOverlay(harness.floodLayer);
  await flushAsync();
  harness.map.removeOverlay(harness.floodLayer);
  harness.map.addOverlay(harness.floodLayer);
  await flushAsync();

  assert.equal(harness.state.apiCalls.length, 2);
  assert.equal(harness.floodLayer.getLayers().length, 1);
});

test("flood layer rejects generation regression without serving stale cached geometry", async () => {
  const harness = createHarness({
    generationResponses: [{ generation: "2" }, { generation: "1" }],
    responses: [floodResponse([feature(2, [2023, 2024])], { datasetGeneration: "2" })],
  });

  harness.map.addOverlay(harness.floodLayer);
  await flushAsync();
  harness.map.removeOverlay(harness.floodLayer);
  harness.map.addOverlay(harness.floodLayer);
  await flushAsync();

  assert.equal(harness.state.apiCalls.length, 1);
  assert.equal(harness.floodController.getState().generation, "2");
  assert.equal(harness.floodController.getState().status, "failed");
  assert.equal(harness.floodLayer.getLayers().length, 0);
});

test("flood layer expires cached responses after the bounded cache lifetime", async () => {
  const harness = createHarness({ responses: [floodResponse(), floodResponse()] });

  harness.map.addOverlay(harness.floodLayer);
  await flushAsync();
  harness.map.removeOverlay(harness.floodLayer);
  harness.state.now += 60_001;
  harness.map.addOverlay(harness.floodLayer);
  await flushAsync();

  assert.equal(harness.state.apiCalls.length, 2);
  assert.equal(harness.floodController.getState().cacheEntries, 1);
});

test("flood layer cache remains bounded by entry count and estimated bytes", async () => {
  const responses = Array.from({ length: 22 }, () => floodResponse());
  const harness = createHarness({ responses });
  harness.map.addOverlay(harness.floodLayer);
  await flushAsync();

  for (let index = 1; index < 22; index += 1) {
    harness.state.bounds = [99.9 + index / 1000, 19, 100 + index / 1000, 19.1];
    await harness.floodController.load();
  }

  const cacheState = harness.floodController.getState();
  assert.equal(harness.state.apiCalls.length, 22);
  assert.equal(cacheState.cacheEntries, 20);
  assert.ok(cacheState.cacheBytes > 0);
  assert.ok(cacheState.cacheBytes <= 16 * 1024 * 1024);
});

test("flood layer avoids duplicate in-flight requests and failed loads can retry", async () => {
  const pending = createDeferred();
  const harness = createHarness({
    responses: [pending.promise, new Error("network"), floodResponse()],
  });

  harness.map.addOverlay(harness.floodLayer);
  await flushAsync();
  const sharedLoad = harness.floodController.load();
  await flushAsync();
  assert.equal(harness.state.apiCalls.length, 1);
  assert.equal(harness.state.messages[0], "กำลังโหลดข้อมูลน้ำท่วมซ้ำซาก…");

  pending.resolve(floodResponse());
  await sharedLoad;
  await flushAsync();
  assert.equal(harness.state.apiCalls.length, 1);
  assert.equal(harness.state.messages.includes(""), true);

  harness.map.removeOverlay(harness.floodLayer);
  harness.state.apiCalls.length = 0;
  harness.floodController.getMetadata();
  harness.map.addOverlay(harness.floodLayer);
  await flushAsync();
  assert.equal(harness.state.apiCalls.length, 0);

  const failingHarness = createHarness({
    responses: [new Error("network"), floodResponse()],
  });
  failingHarness.map.addOverlay(failingHarness.floodLayer);
  await flushAsync();
  assert.equal(
    failingHarness.state.messages.includes("ไม่สามารถโหลดข้อมูลน้ำท่วมซ้ำซากได้ในขณะนี้"),
    true,
  );
  failingHarness.map.removeOverlay(failingHarness.floodLayer);
  failingHarness.map.addOverlay(failingHarness.floodLayer);
  await flushAsync();
  assert.equal(failingHarness.state.apiCalls.length, 2);
  assert.equal(failingHarness.floodLayer.getLayers().length, 1);
});
