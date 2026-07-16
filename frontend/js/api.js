// Frontend API helpers: one configured API base, safe JSON parsing, and focused request builders.
(function (window) {
  const PARCEL_ID_PATTERN =
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;
  const AUTH_REQUIRED_MESSAGE = "กรุณาเปิดระบบผ่าน LINE ใหม่อีกครั้ง";

  function buildUrl(path) {
    return `${window.AppConfig.apiBaseUrl}${path}`;
  }

  async function parseJsonSafely(response) {
    try {
      return await response.json();
    } catch (error) {
      return null;
    }
  }

  function createRequestError(response, body) {
    const message =
      body && typeof body.error === "string" && body.error.trim()
        ? body.error.trim()
        : `API request failed: ${response.status}`;
    const requestError = new Error(message);
    requestError.statusCode = response.status;
    return requestError;
  }

  async function getJson(path, options) {
    const response = await fetch(buildUrl(path), options);
    const body = await parseJsonSafely(response);

    if (!response.ok) {
      throw createRequestError(response, body);
    }

    return body;
  }

  function getRiceSuitabilityAtPoint(lat, lng, options) {
    const params = new URLSearchParams({
      lat: String(lat),
      lng: String(lng),
    });

    return getJson(`/rice-suitability/point?${params.toString()}`, options);
  }

  function getLocationReport(lat, lng, options) {
    const params = new URLSearchParams({
      lat: String(lat),
      lng: String(lng),
    });

    return getJson(`/location-report?${params.toString()}`, options);
  }

  function getFloodRecurrenceLayer(bbox, zoom, options) {
    const params = new URLSearchParams({
      bbox: String(bbox),
      zoom: String(zoom),
    });

    return getJson(`/hazard-layers/flood-recurrence?${params.toString()}`, options);
  }

  function getDroughtRecurrenceLayer(options) {
    return getJson("/hazard-layers/drought-recurrence", options);
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

  function assertParcelId(parcelId) {
    const value = typeof parcelId === "string" ? parcelId.trim() : "";
    if (!PARCEL_ID_PATTERN.test(value)) {
      throw new TypeError("parcelId is invalid");
    }
    return value;
  }

  function normalizeString(value) {
    if (value === null || value === undefined) {
      return undefined;
    }
    const text = String(value).trim();
    return text === "" ? undefined : text;
  }

  function cloneGeometry(geometry) {
    if (!geometry || typeof geometry !== "object") {
      return undefined;
    }
    return JSON.parse(JSON.stringify(geometry));
  }

  function createParcelBody(payload) {
    const source = payload && typeof payload === "object" ? payload : {};
    const body = {};
    const parcelName = normalizeString(source.parcelName);
    const cropType = normalizeString(source.cropType);
    const riceVariety = normalizeString(source.riceVariety);
    const plantingDate = normalizeString(source.plantingDate);
    const geometry = cloneGeometry(source.geometry);

    if (parcelName) {
      body.parcelName = parcelName;
    }
    if (cropType) {
      body.cropType = cropType;
    }
    if (riceVariety) {
      body.riceVariety = riceVariety;
    }
    if (plantingDate) {
      body.plantingDate = plantingDate;
    }
    if (geometry) {
      body.geometry = geometry;
    }

    return body;
  }

  function createParcelPatchBody(payload) {
    const source = payload && typeof payload === "object" ? payload : {};
    const body = {};

    ["parcelName", "cropType", "riceVariety", "plantingDate"].forEach((key) => {
      if (!Object.prototype.hasOwnProperty.call(source, key)) {
        return;
      }
      body[key] =
        source[key] === null || source[key] === undefined
          ? null
          : String(source[key]).trim();
    });

    if (Object.prototype.hasOwnProperty.call(source, "geometry")) {
      const geometry = cloneGeometry(source.geometry);
      if (geometry) {
        body.geometry = geometry;
      }
    }

    return body;
  }

  async function getCurrentLiffIdToken() {
    if (
      !window.MapLiffMode ||
      typeof window.MapLiffMode.getCurrentIdToken !== "function"
    ) {
      const error = new Error(AUTH_REQUIRED_MESSAGE);
      error.statusCode = 401;
      throw error;
    }

    return window.MapLiffMode.getCurrentIdToken();
  }

  async function sendAuthenticatedParcelJson(path, body, method, options) {
    const idToken = await getCurrentLiffIdToken();
    const requestOptions = {
      ...options,
      method,
      headers: {
        Authorization: `Bearer ${idToken}`,
        ...(options && options.headers ? options.headers : {}),
      },
    };

    if (body !== undefined) {
      requestOptions.headers = {
        ...requestOptions.headers,
        "Content-Type": "application/json",
      };
      requestOptions.body = JSON.stringify(body);
    }

    return getJson(path, requestOptions);
  }

  window.MapApi = {
    getJson,
    buildUrl,
    createParcelBody,
    createParcelPatchBody,
    getRiceSuitabilityAtPoint,
    getLocationReport,
    getFloodRecurrenceLayer,
    getDroughtRecurrenceLayer,
    analyzeLineLocation: function (payload, options) {
      return sendJson("/line/location-analysis", payload, "POST", options);
    },
    sendLineLocationSummary: async function (payload, options) {
      const body = window.MapPointState.createLineSummaryPayload(payload);
      const result = await sendJson(
        "/line/location-summary",
        body,
        "POST",
        options,
      );

      if (!result || result.ok !== true || result.status !== "SENT") {
        throw new Error("LINE summary request did not return SENT");
      }

      return result;
    },
    analyzePolygonArea: function (payload, options) {
      return sendJson("/area-analysis/polygon", payload, "POST", options);
    },
    createParcel: function (payload, options) {
      return sendAuthenticatedParcelJson(
        "/parcels",
        createParcelBody(payload),
        "POST",
        options,
      );
    },
    listMyParcels: function (options) {
      return sendAuthenticatedParcelJson("/parcels/mine", undefined, "GET", options);
    },
    getMyParcel: function (parcelId, options) {
      return sendAuthenticatedParcelJson(
        `/parcels/${encodeURIComponent(assertParcelId(parcelId))}`,
        undefined,
        "GET",
        options,
      );
    },
    updateMyParcel: function (parcelId, patch, options) {
      return sendAuthenticatedParcelJson(
        `/parcels/${encodeURIComponent(assertParcelId(parcelId))}`,
        createParcelPatchBody(patch),
        "PATCH",
        options,
      );
    },
    deleteMyParcel: function (parcelId, options) {
      return sendAuthenticatedParcelJson(
        `/parcels/${encodeURIComponent(assertParcelId(parcelId))}`,
        undefined,
        "DELETE",
        options,
      );
    },
    analyzeMyParcel: function (parcelId, options) {
      return sendAuthenticatedParcelJson(
        `/parcels/${encodeURIComponent(assertParcelId(parcelId))}/analyze`,
        undefined,
        "POST",
        options,
      );
    },
    getProvinces: function () {
      return getJson("/pgconnect/provinces");
    },
    getLandmarks: function () {
      return getJson("/pgconnect/landmarks");
    },
  };
})(window);
