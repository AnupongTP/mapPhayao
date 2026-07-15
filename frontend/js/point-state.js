(function (root) {
  const POINT_KEY_PRECISION = 7;

  function parseFiniteNumber(value) {
    if (typeof value === "number") {
      return Number.isFinite(value) ? value : null;
    }

    if (typeof value === "string" && value.trim() !== "") {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }

    return null;
  }

  function normalizePoint(input, longitude, options = {}) {
    const sourceInput = input && typeof input === "object" ? input : null;
    const latitude = parseFiniteNumber(sourceInput ? sourceInput.lat ?? sourceInput.latitude : input);
    const lng = parseFiniteNumber(
      sourceInput ? sourceInput.lng ?? sourceInput.longitude : longitude,
    );

    if (
      latitude === null ||
      lng === null ||
      latitude < -90 ||
      latitude > 90 ||
      lng < -180 ||
      lng > 180
    ) {
      return null;
    }

    const source =
      options.source !== undefined
        ? options.source
        : sourceInput && sourceInput.source !== undefined
          ? sourceInput.source
          : undefined;
    const accuracy =
      options.accuracy !== undefined
        ? options.accuracy
        : sourceInput && sourceInput.accuracy !== undefined
          ? sourceInput.accuracy
          : undefined;
    const point = {
      lat: latitude,
      lng,
    };

    if (typeof source === "string" && source.trim() !== "") {
      point.source = source.trim();
    }

    if (accuracy === null || Number.isFinite(Number(accuracy))) {
      point.accuracy = accuracy === null ? null : Number(accuracy);
    }

    return point;
  }

  function isValidPoint(point) {
    return normalizePoint(point) !== null;
  }

  function createPointKey(point) {
    const normalized = normalizePoint(point);
    if (!normalized) {
      return null;
    }

    return `${normalized.lat.toFixed(POINT_KEY_PRECISION)},${normalized.lng.toFixed(
      POINT_KEY_PRECISION,
    )}`;
  }

  function areSamePoints(first, second) {
    const firstKey = createPointKey(first);
    const secondKey = createPointKey(second);
    return Boolean(firstKey && secondKey && firstKey === secondKey);
  }

  function createConfirmedPoint(point) {
    const normalized = normalizePoint(point);
    if (!normalized) {
      return null;
    }

    return {
      lat: normalized.lat,
      lng: normalized.lng,
    };
  }

  function shouldAcceptPointAnalysisResponse(requestedPoint, currentSelectedPoint) {
    return areSamePoints(requestedPoint, currentSelectedPoint);
  }

  function createLineSummaryPayload(payload) {
    const idToken = payload && typeof payload.idToken === "string" ? payload.idToken.trim() : "";
    const point = payload && payload.point
      ? createConfirmedPoint(payload.point)
      : createConfirmedPoint({
          lat: payload && payload.lat,
          lng: payload && payload.lng,
        });

    if (!idToken) {
      throw new TypeError("idToken is required");
    }

    if (!point) {
      throw new TypeError("lat and lng are required finite coordinates");
    }

    return {
      idToken,
      lat: point.lat,
      lng: point.lng,
    };
  }

  const api = {
    normalizePoint,
    isValidPoint,
    createPointKey,
    areSamePoints,
    createConfirmedPoint,
    shouldAcceptPointAnalysisResponse,
    createLineSummaryPayload,
  };

  root.MapPointState = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
