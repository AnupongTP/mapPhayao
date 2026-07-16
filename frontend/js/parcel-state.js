(function (root) {
  const PARCEL_ID_PATTERN =
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;

  function cloneGeometry(geometry) {
    return geometry ? JSON.parse(JSON.stringify(geometry)) : null;
  }

  function createPersistenceState() {
    return {
      geometryRevision: 0,
      analysisRevision: 0,
      analyzedGeometryRevision: null,
      analyzedGeometry: null,
      savedParcelId: null,
      savedParcel: null,
      saveState: "idle",
      savingGeometryRevision: null,
    };
  }

  function ensurePersistenceState(parcel) {
    if (!parcel.persistence || typeof parcel.persistence !== "object") {
      parcel.persistence = createPersistenceState();
    }
    return parcel.persistence;
  }

  function markGeometryChanged(parcel) {
    const state = ensurePersistenceState(parcel);
    state.geometryRevision += 1;
    state.analyzedGeometryRevision = null;
    state.analyzedGeometry = null;
    state.savedParcelId = null;
    state.savedParcel = null;
    state.saveState = "idle";
    state.savingGeometryRevision = null;
    return state.geometryRevision;
  }

  function markAnalysisStarted(parcel) {
    const state = ensurePersistenceState(parcel);
    state.analysisRevision += 1;
    state.analyzedGeometryRevision = null;
    state.analyzedGeometry = null;
    if (state.saveState !== "saving") {
      state.saveState = "idle";
    }
    return {
      analysisRevision: state.analysisRevision,
      geometryRevision: state.geometryRevision,
    };
  }

  function markAnalysisSucceeded(parcel, token, geometry) {
    const state = ensurePersistenceState(parcel);
    if (
      !token ||
      token.analysisRevision !== state.analysisRevision ||
      token.geometryRevision !== state.geometryRevision
    ) {
      return false;
    }

    state.analyzedGeometryRevision = state.geometryRevision;
    state.analyzedGeometry = cloneGeometry(geometry || parcel.geometry);
    state.saveState = state.savedParcelId ? "saved" : "ready";
    state.savingGeometryRevision = null;
    return true;
  }

  function markAnalysisStale(parcel) {
    const state = ensurePersistenceState(parcel);
    state.analyzedGeometryRevision = null;
    state.analyzedGeometry = null;
    if (state.saveState !== "saving") {
      state.saveState = "idle";
    }
  }

  function canSaveAnalyzedParcel(parcel) {
    const state = ensurePersistenceState(parcel);
    return Boolean(
      parcel &&
        parcel.analysisStatus === "success" &&
        state.saveState !== "saving" &&
        !state.savedParcelId &&
        state.analyzedGeometryRevision === state.geometryRevision &&
        state.analyzedGeometry,
    );
  }

  function captureSaveSnapshot(parcel) {
    if (!canSaveAnalyzedParcel(parcel)) {
      return null;
    }

    const state = ensurePersistenceState(parcel);
    state.saveState = "saving";
    state.savingGeometryRevision = state.geometryRevision;
    return {
      geometryRevision: state.geometryRevision,
      geometry: cloneGeometry(state.analyzedGeometry),
    };
  }

  function markSaveSucceeded(parcel, snapshot, savedParcel) {
    const state = ensurePersistenceState(parcel);
    if (!snapshot || snapshot.geometryRevision !== state.geometryRevision) {
      return false;
    }

    const savedParcelId =
      savedParcel && typeof savedParcel.id === "string" ? savedParcel.id.trim() : "";
    if (!PARCEL_ID_PATTERN.test(savedParcelId)) {
      state.saveState = "ready";
      state.savingGeometryRevision = null;
      return false;
    }

    state.savedParcelId = savedParcelId;
    state.savedParcel = {
      id: savedParcelId,
      parcelName: savedParcel.parcelName || null,
      cropType: savedParcel.cropType || null,
      riceVariety: savedParcel.riceVariety || null,
      plantingDate: savedParcel.plantingDate || null,
      areaSqm: savedParcel.areaSqm ?? null,
      areaRai: savedParcel.areaRai ?? null,
      geometry: cloneGeometry(savedParcel.geometry),
      createdAt: savedParcel.createdAt || null,
      updatedAt: savedParcel.updatedAt || null,
    };
    state.saveState = "saved";
    state.savingGeometryRevision = null;
    return true;
  }

  function markSaveFailed(parcel, snapshot) {
    const state = ensurePersistenceState(parcel);
    if (!snapshot || snapshot.geometryRevision === state.geometryRevision) {
      state.saveState = canSaveAnalyzedParcel(parcel) ? "ready" : "idle";
      state.savingGeometryRevision = null;
    }
  }

  function markSavedParcelOpened(parcel) {
    return {
      openedSavedParcelId: parcel && typeof parcel.id === "string" ? parcel.id : null,
      isEditable: false,
      geometry: cloneGeometry(parcel?.geometry),
    };
  }

  function shouldAcceptListResponse(requestRevision, currentRevision) {
    return requestRevision === currentRevision;
  }

  function shouldAcceptDetailResponse(requestedParcelId, currentParcelId, requestRevision, currentRevision) {
    return (
      requestedParcelId === currentParcelId &&
      requestRevision === currentRevision
    );
  }

  function isValidGeoJsonGeometry(geometry) {
    return Boolean(
      geometry &&
        typeof geometry === "object" &&
        (geometry.type === "Polygon" || geometry.type === "MultiPolygon") &&
        Array.isArray(geometry.coordinates) &&
        geometry.coordinates.length > 0,
    );
  }

  const api = {
    cloneGeometry,
    createPersistenceState,
    ensurePersistenceState,
    markGeometryChanged,
    markAnalysisStarted,
    markAnalysisSucceeded,
    markAnalysisStale,
    canSaveAnalyzedParcel,
    captureSaveSnapshot,
    markSaveSucceeded,
    markSaveFailed,
    markSavedParcelOpened,
    shouldAcceptListResponse,
    shouldAcceptDetailResponse,
    isValidGeoJsonGeometry,
  };

  root.MapParcelState = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
