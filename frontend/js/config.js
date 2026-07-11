// ไฟล์ตั้งค่ากลางของ frontend: API, จุดเริ่มแผนที่, และข้อมูลอ้างอิง
(function (window) {
  const isLocal =
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1";

  window.AppConfig = {
    apiBaseUrl: isLocal
      ? "http://localhost:3000/api"
      : "https://mapphayao-backend.onrender.com/api",
    map: {
      center: [19.0290389, 99.8906438],
      zoom: 15,
      maxZoom: 19,
    },
    data: {
      thailandProvinceGeoJson: "data/thailand_province.geojson",
    },
  };
})(window);
