// ไฟล์สร้าง basemap, WMS overlay, และ pane สำหรับจัดลำดับชั้นบนแผนที่
(function (window) {
  function createBaseLayers() {
    // Base layer คือแผนที่พื้นหลังที่ผู้ใช้เลือกได้จาก control
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
    // Pane กำหนดลำดับซ้อนของ layer ไม่ให้บัง marker หรือ popup
    if (!map || map.getPane(name)) {
      return;
    }

    map.createPane(name);
    map.getPane(name).style.zIndex = zIndex;
  }

  function createOverlayLayers(map) {
    // GeoServer WMS ใช้แสดงข้อมูลเชิงพื้นที่ ฝั่งคำนวณจริงอยู่ที่ Backend/PostGIS
    const geoserverWmsUrl = "http://localhost:8080/geoserver/rice_gis/wms";
    // แยก pane ตามกลุ่มข้อมูล เพื่อคุมลำดับการวาดของ basin, water, และ potential
    ensurePane(map, "subBasinPane", 320);
    ensurePane(map, "mainBasinPane", 330);
    ensurePane(map, "ricePotentialPane", 340);
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

    const ricePotentialLayerOptions = {
      // ใช้ layer เดียว แล้วกรองด้วย CQL_FILTER เพื่อแยก S1/S2/S3/N
      format: "image/png",
      transparent: true,
      tiled: true,
      opacity: 0.65,
      version: "1.1.1",
      pane: "ricePotentialPane",
    };

    const ricePotentialAllLayer = L.tileLayer.wms(
      geoserverWmsUrl,
      {
        ...ricePotentialLayerOptions,
        layers: "rice_gis:rice_potential",
      },
    );

    const ricePotentialS1Layer = L.tileLayer.wms(
      geoserverWmsUrl,
      {
        ...ricePotentialLayerOptions,
        layers: "rice_gis:rice_potential",
        CQL_FILTER: "suitability_class='S1'",
      },
    );

    const ricePotentialS2Layer = L.tileLayer.wms(
      geoserverWmsUrl,
      {
        ...ricePotentialLayerOptions,
        layers: "rice_gis:rice_potential",
        CQL_FILTER: "suitability_class='S2'",
      },
    );

    const ricePotentialS3Layer = L.tileLayer.wms(
      geoserverWmsUrl,
      {
        ...ricePotentialLayerOptions,
        layers: "rice_gis:rice_potential",
        CQL_FILTER: "suitability_class='S3'",
      },
    );

    const ricePotentialNLayer = L.tileLayer.wms(
      geoserverWmsUrl,
      {
        ...ricePotentialLayerOptions,
        layers: "rice_gis:rice_potential",
        CQL_FILTER: "suitability_class='N'",
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
      ricePotentialAllLayer,
      ricePotentialS1Layer,
      ricePotentialS2Layer,
      ricePotentialS3Layer,
      ricePotentialNLayer,
    };
  }

  window.MapLayers = {
    createBaseLayers,
    createOverlayLayers,
  };
})(window);
