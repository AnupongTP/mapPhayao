// Frontend API helpers: one configured API base, safe JSON parsing, and focused request builders.
(function (window) {
  const PARCEL_ID_PATTERN =
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;
  const AUTH_REQUIRED_MESSAGE = "กรุณาเปิดระบบผ่าน LINE ใหม่อีกครั้ง";
  const UPLOAD_STAGES = new Set(["REQUEST_RECEIVED", "AUTH_VERIFIED", "MULTIPART_PARSED",
    "PARCEL_LOOKUP", "PARCEL_VERIFIED", "IMAGE_VALIDATION", "IMAGE_PROCESSED",
    "SHEET_CHECK", "DRIVE_UPLOAD", "SHEET_UPDATE", "UPLOAD_COMPLETE"]);
  const UPLOAD_CODES = new Set(["IMAGE_CONFLICT", "DRIVE_NOT_CONFIGURED", "APPS_SCRIPT_TIMEOUT",
    "APPS_SCRIPT_NETWORK_ERROR", "APPS_SCRIPT_REJECTED", "APPS_SCRIPT_HTTP_ERROR",
    "APPS_SCRIPT_INVALID_RESPONSE", "DRIVE_UPLOAD_ERROR", "SHEET_HEADER_MISMATCH",
    "SHEET_UPDATE_ERROR", "SHEET_READ_ERROR", "AUTH_REQUIRED", "PARCEL_NOT_FOUND",
    "IMAGE_TOO_LARGE", "IMAGE_UNSUPPORTED", "INVALID_UPLOAD", "UPLOAD_FAILED"]);
  const SAVED_IMAGE_RETRY_DELAYS = [500, 1000, 2000];
  const SAVED_IMAGE_RETRY_STATUSES = new Set([404, 500, 502, 503, 504]);

  function savedImageAbortError() {
    const error = new Error("Saved image request aborted");
    error.name = "AbortError";
    return error;
  }

  function waitForSavedImageRetry(delay, signal) {
    if (signal?.aborted) return Promise.reject(savedImageAbortError());
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        clearTimeout(timer);
        reject(savedImageAbortError());
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, delay);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

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
    requestError.retryable = body?.retryable === true;
    requestError.ambiguous = body?.ambiguous === true;
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
    const note = normalizeString(source.note);
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
    if (note) {
      body.note = note;
    }
    if (geometry) {
      body.geometry = geometry;
    }

    return body;
  }

  function createParcelPatchBody(payload) {
    const source = payload && typeof payload === "object" ? payload : {};
    const body = {};

    ["parcelName", "cropType", "riceVariety", "plantingDate", "note"].forEach((key) => {
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
    uploadParcelImage: async function (parcelId, file, clientPhotoId, options = {}) {
      const idToken = await getCurrentLiffIdToken();
      const body = new FormData();
      body.append("image", file);
      body.append("clientPhotoId", clientPhotoId);
      let response;
      try {
        options.onRequestStart?.();
        const request = fetch(buildUrl(`/parcels/${encodeURIComponent(assertParcelId(parcelId))}/images`), {
          method: "POST",
          headers: { Authorization: `Bearer ${idToken}`, "X-Photo-Attempt": String(options.attempt || 0) },
          body,
          ...(options.signal ? { signal: options.signal } : {}),
        });
        options.onWaiting?.();
        response = await request;
      } catch (error) {
        error.ambiguous = true;
        error.diagnosticStage = error?.name === "AbortError" ? "REQUEST_ABORTED" : "NETWORK_NO_RESPONSE";
        error.diagnosticCode = error.diagnosticStage;
        error.stage = error.diagnosticStage;
        error.code = error.diagnosticCode;
        throw error;
      }
      const result = await parseJsonSafely(response);
      if (!response.ok) {
        const error = createRequestError(response, result);
        error.diagnosticStage = UPLOAD_STAGES.has(result?.stage) ? result.stage : "BACKEND_HTTP_ERROR";
        error.diagnosticCode = UPLOAD_CODES.has(result?.code) ? result.code : "BACKEND_HTTP_ERROR";
        error.stage = error.diagnosticStage;
        error.code = error.diagnosticCode;
        error.requestId = /^[A-F0-9]{8}$/.test(result?.requestId || "") ? result.requestId : null;
        throw error;
      }
      options.onDiagnostic?.({ stage: result?.stage === "UPLOAD_COMPLETE" ? result.stage : null,
        requestId: /^[A-F0-9]{8}$/.test(result?.requestId || "") ? result.requestId : null });
      return result.image;
    },
    getParcelImageBlob: async function (parcelId, imageId, options = {}) {
      if (typeof imageId !== "string" || !/^[A-Za-z0-9_-]+\.webp$/.test(imageId)) {
        throw new TypeError("imageId is invalid");
      }
      const safeParcelId = assertParcelId(parcelId);
      const idToken = await getCurrentLiffIdToken();
      const url = buildUrl(`/parcels/${encodeURIComponent(safeParcelId)}` +
        `/images/${encodeURIComponent(imageId)}/content`);
      for (let attempt = 1; attempt <= SAVED_IMAGE_RETRY_DELAYS.length + 1; attempt += 1) {
        if (options.signal?.aborted) throw savedImageAbortError();
        window.console?.info?.("[ParcelImageRead] FETCH", { attempt });
        try {
          let response;
          const started = window.performance?.now?.() ?? Date.now();
          try {
            response = await fetch(url, {
              ...options,
              method: "GET",
              headers: { Authorization: `Bearer ${idToken}` },
            });
          } catch (error) {
            if (error?.name === "AbortError") throw error;
            const transportError = new Error("Saved image transport failed");
            transportError.isSavedImageTransportFailure = true;
            throw transportError;
          }
          if (!response.ok) {
            const requestError = createRequestError(response, await parseJsonSafely(response));
            requestError.isSavedImageHttpFailure = true;
            throw requestError;
          }
          if (!/^image\/webp(?:;|$)/i.test(response.headers.get("Content-Type") || "")) {
            const error = new Error("Invalid parcel image response");
            error.nonRetryableImageRead = true;
            throw error;
          }
          const blob = await response.blob();
          if (options.signal?.aborted) throw savedImageAbortError();
          try {
            const timing = { attempt, status: response.status,
              clientMs: Math.max(0, (window.performance?.now?.() ?? Date.now()) - started) };
            const header = response.headers.get("Server-Timing") || "";
            for (const match of header.matchAll(/(?:^|,)\s*(ownership|provider|backend);dur=([0-9]+(?:\.[0-9]+)?)(?=,|$)/g)) {
              const value = Number(match[2]);
              if (Number.isFinite(value)) timing[`${match[1]}Ms`] = value;
            }
            window.console?.info?.("[ParcelImageTiming]", timing);
          } catch (_) {
            // Diagnostics must not affect a successful protected image read.
          }
          window.console?.info?.("[ParcelImageRead] SUCCESS", { attempts: attempt });
          return blob;
        } catch (error) {
          if (options.signal?.aborted || error?.name === "AbortError") throw error;
          const status = Number.isInteger(error?.statusCode) ? error.statusCode : null;
          const retryable = error?.isSavedImageTransportFailure === true ||
            (error?.isSavedImageHttpFailure === true && SAVED_IMAGE_RETRY_STATUSES.has(status));
          if (retryable && attempt <= SAVED_IMAGE_RETRY_DELAYS.length) {
            window.console?.warn?.("[ParcelImageRead] RETRY", {
              attempt: attempt + 1, maxAttempts: SAVED_IMAGE_RETRY_DELAYS.length + 1, status,
            });
            await waitForSavedImageRetry(SAVED_IMAGE_RETRY_DELAYS[attempt - 1], options.signal);
            continue;
          }
          window.console?.error?.("[ParcelImageRead] FAILED", { attempts: attempt, status });
          throw error;
        }
      }
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
