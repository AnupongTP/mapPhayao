// Builds basemaps, lazy GeoJSON overlays, and panes for map layer ordering.
(function (window) {
  const SUITABILITY_COLORS = {
    S1: "#74ff00",
    S2: "#ffbf00",
    S3: "#ff6900",
    N: "#ff0c00",
  };

  const HAZARD_LAYER_KEYS = {
    flood: "floodRecurrence",
    drought: "droughtRecurrence",
  };

  function createBaseLayers() {
    const maxZoom = window.AppConfig.map.maxZoom;
    const openStreetMap = L.tileLayer(
      "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      {
        maxZoom,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      },
    );

    const googleSatellite = L.tileLayer(
      "https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}",
      {
        maxZoom,
        attribution: "Google",
      },
    );
    return {
      openStreetMap,
      googleSatellite,
    };
  }

  function ensurePane(map, name, zIndex) {
    if (!map || map.getPane(name)) {
      return;
    }

    map.createPane(name);
    map.getPane(name).style.zIndex = zIndex;
  }

  function getSuitabilityClass(feature) {
    return String(feature?.properties?.suitabilit || "").trim().toUpperCase();
  }

  function createSuitabilityStyle(feature) {
    const classValue = getSuitabilityClass(feature);
    return {
      color: "#232323",
      weight: 1,
      opacity: 0.65,
      fillColor: SUITABILITY_COLORS[classValue] || "#7a35e7",
      fillOpacity: 0.4,
      pane: "ricePotentialPane",
    };
  }

  function createLazyLayerController(map, options) {
    const state = {
      name: options.name,
      url: options.url,
      layer: options.layer,
      loaded: false,
      loading: false,
      abortController: null,
      requestId: 0,
    };

    async function load() {
      if (state.loaded || state.loading) {
        return;
      }

      state.loading = true;
      state.requestId += 1;

      const currentRequestId = state.requestId;
      const controller = new AbortController();
      state.abortController = controller;

      try {
        const response = await fetch(state.url, {
          signal: controller.signal,
          cache: "default",
        });

        if (!response.ok) {
          const error = new Error(
            `${state.name}: HTTP ${response.status} ${response.statusText}`,
          );
          error.status = response.status;
          error.statusText = response.statusText;
          throw error;
        }

        const geojson = await response.json();
        const requestIsCurrent = currentRequestId === state.requestId;
        const layerIsVisible = map.hasLayer(state.layer);

        if (!controller.signal.aborted && requestIsCurrent && layerIsVisible) {
          state.layer.addData(geojson);
          state.loaded = true;
        }
      } catch (error) {
        if (error.name === "AbortError") {
          return;
        }

        console.error(`[GeoJSON] Failed to load ${state.name}`, {
          url: state.url,
          status: error.status || null,
          message: error.message,
          error,
        });

        if (map.hasLayer(state.layer)) {
          map.removeLayer(state.layer);
        }
      } finally {
        if (currentRequestId === state.requestId) {
          state.loading = false;
          state.abortController = null;
        }
      }
    }

    function unload() {
      state.requestId += 1;

      if (state.abortController) {
        state.abortController.abort();
      }

      state.layer.clearLayers();
      state.loaded = false;
      state.loading = false;
      state.abortController = null;
    }

    return {
      layer: state.layer,
      load,
      unload,
      getState: () => ({
        name: state.name,
        url: state.url,
        loaded: state.loaded,
        loading: state.loading,
        requestId: state.requestId,
        featureCount: state.layer.getLayers().length,
      }),
    };
  }

  function registerLazyLayer(map, registry, options) {
    const layer = L.geoJSON(null, options.geoJsonOptions || {});
    const controller = createLazyLayerController(map, {
      ...options,
      layer,
    });
    registry.set(layer, controller);
    return layer;
  }

  function getYearsCount(feature) {
    const years = feature?.properties?.yearsDetected;
    return Array.isArray(years) ? years.length : 0;
  }

  function getFloodStyle(feature) {
    const count = getYearsCount(feature);
    let fillColor = "#fee8c8";
    if (count >= 7) {
      fillColor = "#b30000";
    } else if (count >= 4) {
      fillColor = "#e34a33";
    } else if (count >= 2) {
      fillColor = "#fc8d59";
    }

    return {
      pane: "hazardPane",
      color: "#7f1d1d",
      weight: 1,
      opacity: 0.85,
      fillColor,
      fillOpacity: 0.52,
    };
  }

  function getDroughtStyle(feature) {
    const count = getYearsCount(feature);
    let fillColor = "#f1f5f9";
    if (count >= 3) {
      fillColor = "#a16207";
    } else if (count === 2) {
      fillColor = "#d97706";
    } else if (count === 1) {
      fillColor = "#fbbf24";
    }

    return {
      pane: "hazardPane",
      color: "#78350f",
      weight: 1,
      opacity: 0.8,
      fillColor,
      fillOpacity: count > 0 ? 0.48 : 0.18,
    };
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatYears(years) {
    return Array.isArray(years) && years.length ? years.join(", ") : "-";
  }

  function bindFloodPopup(feature, layer) {
    const properties = feature.properties || {};
    const years = Array.isArray(properties.yearsDetected)
      ? properties.yearsDetected
      : [];
    const period = properties.startYear && properties.endYear
      ? `${properties.startYear}–${properties.endYear}`
      : "-";
    layer.bindPopup(
      `<div class="map-popup hazard-popup">`
        + `<h3>พื้นที่น้ำท่วมซ้ำซาก</h3>`
        + `<p><strong>ช่วงข้อมูล:</strong> ${escapeHtml(period)}</p>`
        + `<p><strong>จำนวนปีที่พบ:</strong> ${properties.frequency ?? years.length}</p>`
        + `<p><strong>ปีที่พบ:</strong> ${escapeHtml(formatYears(years))}</p>`
        + `<p><strong>ตำบล:</strong> ${escapeHtml(properties.subdistrict || "-")}</p>`
        + `<p><strong>อำเภอ:</strong> ${escapeHtml(properties.district || "-")}</p>`
        + `<p><strong>แหล่งข้อมูล:</strong> GISTDA</p>`
        + `</div>`,
    );
  }

  function bindDroughtPopup(feature, layer) {
    const properties = feature.properties || {};
    const years = Array.isArray(properties.yearsDetected)
      ? properties.yearsDetected
      : [];
    const period = properties.startYear && properties.endYear
      ? `${properties.startYear}–${properties.endYear}`
      : "-";
    layer.bindPopup(
      `<div class="map-popup hazard-popup">`
        + `<h3>ประวัติภัยแล้งซ้ำซากระดับตำบล</h3>`
        + `<p><strong>ตำบล:</strong> ${escapeHtml(properties.tambon || "-")}</p>`
        + `<p><strong>อำเภอ:</strong> ${escapeHtml(properties.district || "-")}</p>`
        + `<p><strong>จำนวนปีที่พบ:</strong> ${years.length}</p>`
        + `<p><strong>ปีที่พบ:</strong> ${escapeHtml(formatYears(years))}</p>`
        + `<p><strong>ช่วงข้อมูล:</strong> ${escapeHtml(period)}</p>`
        + `<p><strong>แหล่งข้อมูล:</strong> GISTDA</p>`
        + `<p class="hazard-popup-note">ชั้นข้อมูลนี้เป็นผลสรุประดับตำบล ไม่ใช่ขอบเขตพื้นที่ภัยแล้งภายในตำบล</p>`
        + `</div>`,
    );
  }

  function getCurrentBbox(map) {
    const bounds = map.getBounds();
    return [
      bounds.getWest(),
      bounds.getSouth(),
      bounds.getEast(),
      bounds.getNorth(),
    ].map((value) => value.toFixed(6)).join(",");
  }

  function createFloodRecurrenceController(map) {
    const layer = L.geoJSON(null, {
      pane: "hazardPane",
      style: getFloodStyle,
      onEachFeature: bindFloodPopup,
    });
    const state = {
      abortController: null,
      enabled: false,
      requestId: 0,
      timer: null,
      lastKey: "",
    };

    async function load() {
      if (!state.enabled || !map.hasLayer(layer)) {
        return;
      }

      const bbox = getCurrentBbox(map);
      const zoom = map.getZoom();
      const key = `${bbox}:${zoom}`;
      if (key === state.lastKey && layer.getLayers().length) {
        return;
      }

      state.requestId += 1;
      const currentRequestId = state.requestId;
      if (state.abortController) {
        state.abortController.abort();
      }
      const controller = new AbortController();
      state.abortController = controller;

      try {
        const geojson = await window.MapApi.getFloodRecurrenceLayer(
          bbox,
          zoom,
          { signal: controller.signal },
        );
        if (
          !controller.signal.aborted
          && currentRequestId === state.requestId
          && state.enabled
          && map.hasLayer(layer)
        ) {
          layer.clearLayers();
          layer.addData(geojson);
          state.lastKey = key;
        }
      } catch (error) {
        if (error.name !== "AbortError") {
          console.error("[Hazard layer] Failed to load flood recurrence", {
            statusCode: error.statusCode || null,
            message: error.message,
          });
          layer.clearLayers();
        }
      } finally {
        if (currentRequestId === state.requestId) {
          state.abortController = null;
        }
      }
    }

    function scheduleLoad() {
      if (state.timer) {
        window.clearTimeout(state.timer);
      }
      state.timer = window.setTimeout(load, 250);
    }

    function enable() {
      state.enabled = true;
      map.on("moveend", scheduleLoad);
      load();
    }

    function unload() {
      state.enabled = false;
      state.requestId += 1;
      state.lastKey = "";
      map.off("moveend", scheduleLoad);
      if (state.timer) {
        window.clearTimeout(state.timer);
        state.timer = null;
      }
      if (state.abortController) {
        state.abortController.abort();
      }
      state.abortController = null;
      layer.clearLayers();
    }

    return {
      layer,
      load: enable,
      unload,
    };
  }

  function createDroughtRecurrenceController(map) {
    const layer = L.geoJSON(null, {
      pane: "hazardPane",
      style: getDroughtStyle,
      onEachFeature: bindDroughtPopup,
    });
    const state = {
      abortController: null,
      loaded: false,
      loading: false,
      requestId: 0,
    };

    async function load() {
      if (state.loaded || state.loading) {
        return;
      }

      state.loading = true;
      state.requestId += 1;
      const currentRequestId = state.requestId;
      const controller = new AbortController();
      state.abortController = controller;

      try {
        const geojson = await window.MapApi.getDroughtRecurrenceLayer({
          signal: controller.signal,
        });
        if (
          !controller.signal.aborted
          && currentRequestId === state.requestId
          && map.hasLayer(layer)
        ) {
          layer.clearLayers();
          layer.addData(geojson);
          state.loaded = true;
        }
      } catch (error) {
        if (error.name !== "AbortError") {
          console.error("[Hazard layer] Failed to load drought recurrence", {
            statusCode: error.statusCode || null,
            message: error.message,
          });
          if (map.hasLayer(layer)) {
            map.removeLayer(layer);
          }
        }
      } finally {
        if (currentRequestId === state.requestId) {
          state.loading = false;
          state.abortController = null;
        }
      }
    }

    function unload() {
      state.requestId += 1;
      if (state.abortController) {
        state.abortController.abort();
      }
      layer.clearLayers();
      state.loaded = false;
      state.loading = false;
      state.abortController = null;
    }

    return {
      layer,
      load,
      unload,
    };
  }

  function createLegendItem(color, label) {
    const item = L.DomUtil.create("div", "hazard-legend-item");
    const swatch = L.DomUtil.create("span", "hazard-legend-swatch", item);
    swatch.style.backgroundColor = color;
    const text = L.DomUtil.create("span", "", item);
    text.textContent = label;
    return item;
  }

  function createHazardLegendControl(map, activeLayers) {
    const control = L.control({ position: "bottomright" });
    let container = null;

    function addSection(title, items, note) {
      const section = L.DomUtil.create("div", "hazard-legend-section", container);
      const heading = L.DomUtil.create("h4", "", section);
      heading.textContent = title;
      items.forEach((item) => section.appendChild(createLegendItem(item.color, item.label)));
      if (note) {
        const noteEl = L.DomUtil.create("p", "hazard-legend-note", section);
        noteEl.textContent = note;
      }
    }

    function update() {
      if (!container) {
        return;
      }
      container.replaceChildren();
      const showFlood = activeLayers.has(HAZARD_LAYER_KEYS.flood);
      const showDrought = activeLayers.has(HAZARD_LAYER_KEYS.drought);
      container.hidden = !showFlood && !showDrought;
      if (showFlood) {
        addSection("จำนวนปีที่พบประวัติน้ำท่วมใน 10 ปีล่าสุด", [
          { color: "#fee8c8", label: "1 ปี" },
          { color: "#fc8d59", label: "2–3 ปี" },
          { color: "#e34a33", label: "4–6 ปี" },
          { color: "#b30000", label: "7 ปีขึ้นไป" },
        ]);
      }
      if (showDrought) {
        addSection("จำนวนปีที่พบประวัติภัยแล้ง", [
          { color: "#f1f5f9", label: "ไม่พบในชุดข้อมูล" },
          { color: "#fbbf24", label: "1 ปี" },
          { color: "#d97706", label: "2 ปี" },
          { color: "#a16207", label: "3 ปีขึ้นไป" },
        ], "ภัยแล้งเป็นผลสรุประดับตำบล ไม่ใช่ขอบเขตพื้นที่ภัยแล้งภายในตำบล");
      }
    }

    control.onAdd = function () {
      container = L.DomUtil.create("div", "hazard-legend leaflet-control");
      container.hidden = true;
      L.DomEvent.disableClickPropagation(container);
      L.DomEvent.disableScrollPropagation(container);
      update();
      return container;
    };

    control.addTo(map);
    return { update };
  }

  function bindLazyLayerEvents(map, registry) {
    const activeHazardLayers = new Set();
    const hazardLegend = createHazardLegendControl(map, activeHazardLayers);

    map.on("overlayadd", (event) => {
      const controller = registry.get(event.layer);
      if (controller) {
        controller.load();
      }
      const hazardKey = event.layer?.options?.hazardLayerKey;
      if (hazardKey) {
        activeHazardLayers.add(hazardKey);
        hazardLegend.update();
      }
    });

    map.on("overlayremove", (event) => {
      const controller = registry.get(event.layer);
      if (controller) {
        controller.unload();
      }
      const hazardKey = event.layer?.options?.hazardLayerKey;
      if (hazardKey) {
        activeHazardLayers.delete(hazardKey);
        hazardLegend.update();
      }
    });
  }

  function createOverlayLayers(map) {
    ensurePane(map, "subBasinPane", 320);
    ensurePane(map, "mainBasinPane", 330);
    ensurePane(map, "ricePotentialPane", 340);
    ensurePane(map, "waterPane", 350);
    ensurePane(map, "hazardPane", 360);

    const data = window.AppConfig.data;
    const lazyLayerControllers = new Map();

    const thailandProvince = registerLazyLayer(map, lazyLayerControllers, {
      name: "Thailand provinces",
      url: data.thailandProvinceGeoJson,
      geoJsonOptions: {
        style: {
          color: "#3388ff",
          weight: 3,
          opacity: 1,
          fillOpacity: 0.2,
        },
      },
    });

    const tambonLayer = registerLazyLayer(map, lazyLayerControllers, {
      name: "ขอบเขตตำบล",
      url: data.layers.tambon,
      geoJsonOptions: {
        style: {
          color: "#232323",
          weight: 1,
          opacity: 1,
          fillColor: "#c6c6c6",
          fillOpacity: 0.22,
        },
      },
    });

    const amphoeLayer = registerLazyLayer(map, lazyLayerControllers, {
      name: "ขอบเขตอำเภอ",
      url: data.layers.amphoe,
      geoJsonOptions: {
        style: {
          color: "#000000",
          weight: 2,
          opacity: 1,
          fillColor: "#c6c6c6",
          fillOpacity: 0.32,
        },
      },
    });

    const mainBasinLayer = registerLazyLayer(map, lazyLayerControllers, {
      name: "ขอบเขตลุ่มน้ำหลัก",
      url: data.layers.basinMain,
      geoJsonOptions: {
        pane: "mainBasinPane",
        style: {
          color: "#08519C",
          weight: 2.5,
          opacity: 1,
          fillColor: "#3182BD",
          fillOpacity: 0.05,
        },
      },
    });

    const subBasinLayer = registerLazyLayer(map, lazyLayerControllers, {
      name: "ขอบเขตลุ่มน้ำย่อย",
      url: data.layers.subBasinDisplay,
      geoJsonOptions: {
        pane: "subBasinPane",
        style: {
          color: "#3182BD",
          weight: 1.2,
          opacity: 1,
          fillColor: "#6BAED6",
          fillOpacity: 0.18,
        },
      },
    });

    const streamLayer = registerLazyLayer(map, lazyLayerControllers, {
      name: "แม่น้ำและลำห้วย",
      url: data.layers.stream,
      geoJsonOptions: {
        pane: "waterPane",
        style: {
          color: "#003EBA",
          weight: 2,
          opacity: 1,
        },
      },
    });

    const irrigationCanalLayer = registerLazyLayer(map, lazyLayerControllers, {
      name: "คลองชลประทาน",
      url: data.layers.irrigationCanal,
      geoJsonOptions: {
        pane: "waterPane",
        style: {
          color: "#0891b2",
          weight: 2,
          opacity: 1,
        },
      },
    });

    const ricePotentialAllLayer = registerLazyLayer(map, lazyLayerControllers, {
      name: "ความเหมาะสมปลูกข้าว — ทุกระดับ",
      url: data.layers.ricePotential,
      geoJsonOptions: {
        pane: "ricePotentialPane",
        style: createSuitabilityStyle,
      },
    });

    const maizePotentialAllLayer = registerLazyLayer(map, lazyLayerControllers, {
      name: "ความเหมาะสมปลูกข้าวโพด — ทุกระดับ",
      url: data.layers.maizePotential,
      geoJsonOptions: {
        pane: "ricePotentialPane",
        style: createSuitabilityStyle,
      },
    });

    const floodRecurrenceController = createFloodRecurrenceController(map);
    floodRecurrenceController.layer.options.hazardLayerKey = HAZARD_LAYER_KEYS.flood;
    lazyLayerControllers.set(floodRecurrenceController.layer, floodRecurrenceController);

    const droughtRecurrenceController = createDroughtRecurrenceController(map);
    droughtRecurrenceController.layer.options.hazardLayerKey = HAZARD_LAYER_KEYS.drought;
    lazyLayerControllers.set(droughtRecurrenceController.layer, droughtRecurrenceController);

    bindLazyLayerEvents(map, lazyLayerControllers);

    return {
      thailandProvince,
      tambonLayer,
      amphoeLayer,
      mainBasinLayer,
      subBasinLayer,
      streamLayer,
      irrigationCanalLayer,
      ricePotentialAllLayer,
      maizePotentialAllLayer,
      floodRecurrenceLayer: floodRecurrenceController.layer,
      droughtRecurrenceLayer: droughtRecurrenceController.layer,
      lazyLayerControllers,
    };
  }

  window.MapLayers = {
    createBaseLayers,
    createOverlayLayers,
  };
})(window);
