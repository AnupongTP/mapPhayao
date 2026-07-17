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
  await nextTick();
  await nextTick();
  await nextTick();
  await nextTick();
  await nextTick();
  await nextTick();
  await nextTick();
  await nextTick();
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
      ...properties,
    },
    features,
  };
}

function createDomNode(tagName, className) {
  return {
    tagName,
    className: className || "",
    children: [],
    style: {},
    hidden: false,
    textContent: "",
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
      return { url, options };
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
    control() {
      return {
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
        getWest: () => 99.9,
        getSouth: () => 19,
        getEast: () => 100,
        getNorth: () => 19.1,
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
    droughtCalls: [],
    canvasOptions: [],
    controls: [],
    geoJsonLayers: [],
    mapClicks: 0,
    messages: [],
  };
  const responses = options.responses || [floodResponse()];
  const window = {
    AppConfig: {
      map: { maxZoom: 18 },
      data: {
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

test("flood disable before prefetch completion prevents late display but keeps cache", async () => {
  const pending = createDeferred();
  const harness = createHarness({ responses: [pending.promise] });

  const prefetchPromise = harness.floodController.prefetch();
  harness.map.addOverlay(harness.floodLayer);
  await flushAsync();
  harness.map.removeOverlay(harness.floodLayer);
  pending.resolve(floodResponse());
  await prefetchPromise;
  await flushAsync();

  assert.equal(harness.state.apiCalls.length, 1);
  assert.equal(harness.map.hasLayer(harness.floodLayer), false);
  assert.equal(harness.legend.hidden, true);

  harness.map.addOverlay(harness.floodLayer);
  await flushAsync();
  assert.equal(harness.state.apiCalls.length, 1);
  assert.equal(harness.floodLayer.getLayers().length, 1);
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

  harness.map.removeOverlay(harness.floodLayer);
  assert.equal(harness.floodLayer.getLayers().length, 1);
  harness.map.addOverlay(harness.floodLayer);
  await flushAsync();

  assert.equal(harness.state.apiCalls.length, 1);
  assert.equal(harness.legend, firstLegend);
  assert.equal(findNodes(harness.legend, (node) => node.tagName === "h4").length, 1);
  assert.equal(harness.floodLayer.getLayers().length, 1);
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
