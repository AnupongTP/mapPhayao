// Builds basemaps, lazy GeoJSON overlays, and panes for map layer ordering.
(function (window) {
  const SUITABILITY_COLORS = {
    S1: "#74ff00",
    S2: "#ffbf00",
    S3: "#ff6900",
    N: "#ff0c00",
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

  function bindLazyLayerEvents(map, registry) {
    map.on("overlayadd", (event) => {
      const controller = registry.get(event.layer);
      if (controller) {
        controller.load();
      }
    });

    map.on("overlayremove", (event) => {
      const controller = registry.get(event.layer);
      if (controller) {
        controller.unload();
      }
    });
  }

  function createOverlayLayers(map) {
    ensurePane(map, "subBasinPane", 320);
    ensurePane(map, "mainBasinPane", 330);
    ensurePane(map, "ricePotentialPane", 340);
    ensurePane(map, "waterPane", 350);

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
      lazyLayerControllers,
    };
  }

  window.MapLayers = {
    createBaseLayers,
    createOverlayLayers,
  };
})(window);
