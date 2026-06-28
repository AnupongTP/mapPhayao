// ไฟล์เรียก API ฝั่ง frontend: ส่งคำขอไป Backend แล้วคืน JSON ให้ UI ใช้
(function (window) {
  function buildUrl(path) {
    // ต่อ path ต่อท้าย base URL กลางของระบบ
    return `${window.AppConfig.apiBaseUrl}${path}`;
  }

  async function getJson(path, options) {
    // helper กลางสำหรับ request ที่คาดหวัง response แบบ JSON
    const response = await fetch(buildUrl(path), options);

    if (!response.ok) {
      let message = `API request failed: ${response.status}`;

      try {
        const errorBody = await response.json();
        message = errorBody.error || message;
      } catch (error) {
        // Keep the HTTP status message when the response body is not JSON.
      }

      throw new Error(message);
    }

    return response.json();
  }

  function getRiceSuitabilityAtPoint(lat, lng, options) {
    // ส่ง longitude ก่อน latitude ตามรูปแบบ ST_MakePoint ของ PostGIS
    const params = new URLSearchParams({
      lat: String(lat),
      lng: String(lng),
    });

    return getJson(`/rice-suitability/point?${params.toString()}`, options);
  }

  async function sendJson(path, body, method, options) {
    // request แบบส่ง body JSON ไป Backend
    return getJson(path, {
      ...options,
      method,
      headers: {
        "Content-Type": "application/json",
        ...(options && options.headers ? options.headers : {}),
      },
      body: JSON.stringify(body),
    });
  }

  window.MapApi = {
    getJson,
    getRiceSuitabilityAtPoint,
    getProvinces: function () {
      return getJson("/pgconnect/provinces");
    },
    getLandmarks: function () {
      return getJson("/pgconnect/landmarks");
    },
  };
})(window);
