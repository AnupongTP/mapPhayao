(function (window) {
  function buildUrl(path) {
    return `${window.AppConfig.apiBaseUrl}${path}`;
  }

  async function getJson(path, options) {
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
    const params = new URLSearchParams({
      lat: String(lat),
      lng: String(lng),
    });

    return getJson(`/rice-suitability/point?${params.toString()}`, options);
  }

  async function sendJson(path, body, method, options) {
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

  function createParcel(payload, options) {
    return sendJson("/parcels", payload, "POST", options);
  }

  function listParcels(options) {
    return getJson("/parcels", options);
  }

  function getParcel(id, options) {
    return getJson(`/parcels/${encodeURIComponent(id)}`, options);
  }

  window.MapApi = {
    getJson,
    getRiceSuitabilityAtPoint,
    createParcel,
    listParcels,
    getParcel,
    getProvinces: function () {
      return getJson("/pgconnect/provinces");
    },
    getLandmarks: function () {
      return getJson("/pgconnect/landmarks");
    },
  };
})(window);
