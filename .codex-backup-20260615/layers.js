(function (window) {
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

  function createOverlayLayers(map) {
    const geoserverWmsUrl = "http://localhost:8080/geoserver/rice_gis/wms";
    ensurePane(map, "subBasinPane", 320);
    ensurePane(map, "mainBasinPane", 330);
    ensurePane(map, "waterPane", 350);

    const thailandProvince = new L.GeoJSON.AJAX([
      window.AppConfig.data.thailandProvinceGeoJson,
    ]);
    const amphoeWms = L.tileLayer.wms(
      geoserverWmsUrl,
      {
        layers: "rice_gis:amphoe",
        format: "image/png",
        transparent: true,
        version: "1.1.1",
        attribution: "GeoServer",
      },
    );
    const tambonWms = L.tileLayer.wms(
      geoserverWmsUrl,
      {
        layers: "rice_gis:tambon",
        format: "image/png",
        transparent: true,
        version: "1.1.1",
      },
    );

    const mainBasinLayer = L.tileLayer.wms(
      geoserverWmsUrl,
      {
        layers: "rice_gis:basin_main",
        format: "image/png",
        transparent: true,
        version: "1.1.1",
        pane: "mainBasinPane",
      },
    );

    const subBasinLayer = L.tileLayer.wms(
      geoserverWmsUrl,
      {
        layers: "rice_gis:sub_basin_display",
        format: "image/png",
        transparent: true,
        version: "1.1.1",
        pane: "subBasinPane",
      },
    );

    const streamWms = L.tileLayer.wms(
      geoserverWmsUrl,
      {
        layers: "rice_gis:stream",
        format: "image/png",
        transparent: true,
        version: "1.1.1",
        pane: "waterPane",
      },
    );

    const irrigationCanalWms = L.tileLayer.wms(
      geoserverWmsUrl,
      {
        layers: "rice_gis:irrigation_canal",
        format: "image/png",
        transparent: true,
        version: "1.1.1",
        pane: "waterPane",
      },
    );

    return {
      thailandProvince,
      amphoeWms,
      tambonWms,
      mainBasinLayer,
      subBasinLayer,
      streamWms,
      irrigationCanalWms,
    };
  }

  window.MapLayers = {
    createBaseLayers,
    createOverlayLayers,
  };
})(window);
