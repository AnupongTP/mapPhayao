// ไฟล์ตั้งค่ากลางของ frontend: API, จุดเริ่มแผนที่, และข้อมูลอ้างอิง
(function (window) {
  const hostname = window.location.hostname;

  const isLocal =
    hostname === "localhost" ||
    hostname === "127.0.0.1";

  const isCurrentCloudflareTunnel =
    hostname === "rapidly-marijuana-harper-partly.trycloudflare.com";

  const localApiBaseUrl = "http://localhost:3000/api";
  const renderApiBaseUrl = "https://mapphayao-backend.onrender.com/api";

  window.AppConfig = {
    apiBaseUrl: isLocal
      ? localApiBaseUrl
      : isCurrentCloudflareTunnel
        ? renderApiBaseUrl
        : renderApiBaseUrl,

    map: {
      center: [19.0290389, 99.8906438],
      zoom: 15,
      maxZoom: 19,
    },

    data: {
      thailandProvinceGeoJson: "data/thailand_province.geojson",

      layers: {
        amphoe: "data/layers/amphoe.geojson",
        tambon: "data/layers/tambon.geojson",
        basinMain: "data/layers/basin_main.geojson",
        subBasinDisplay: "data/layers/sub_basin_display.geojson",
        stream: "data/layers/stream.geojson",
        irrigationCanal: "data/layers/irrigation_canal.geojson",
        ricePotential: "data/layers/rice_potential.geojson",
        maizePotential: "data/layers/maize_potential.geojson",
      },
    },
  };
})(window);
