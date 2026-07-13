(function (window) {
  let selectedLocation = null;
  let locationMarker = null;
  let accuracyCircle = null;
  let pointRequestController = null;
  let resultPopup = null;
  let currentPointResult = null;
  let confirmedPointKey = null;
  let isPointAnalysisLoading = false;
  let appMap = null;
  let parcelDrawHandler = null;
  let isParcelDrawingActive = false;
  let editingTemporaryParcelId = null;
  let selectedTemporaryParcelId = null;
  let editingOriginalGeometry = null;
  let currentDetailParcelId = null;
  let parcelDetailPanelOpen = false;

  const temporaryParcelLayers = new L.FeatureGroup();
  const temporaryParcels = new Map();

  const GEOLOCATION_OPTIONS = {
    enableHighAccuracy: true,
    timeout: 15000,
    maximumAge: 0,
  };

  const TEMPORARY_PARCEL_STYLE = {
    color: "#0f766e",
    weight: 3,
    fillColor: "#2dd4bf",
    fillOpacity: 0.12,
  };

  const TEMPORARY_PARCEL_SELECTED_STYLE = {
    color: "#0f172a",
    weight: 4,
    fillColor: "#67e8f9",
    fillOpacity: 0.18,
    dashArray: "8 6",
  };

  const POLYGON_ANALYSIS_TIMEOUT_MS = 30000;

  function createFrontendId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }

    return `tmp-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  }

  function cloneGeometry(geometry) {
    return JSON.parse(JSON.stringify(geometry));
  }

  function isValidSelectedLocation() {
    return (
      selectedLocation &&
      Number.isFinite(selectedLocation.lat) &&
      Number.isFinite(selectedLocation.lng) &&
      selectedLocation.lat >= -90 &&
      selectedLocation.lat <= 90 &&
      selectedLocation.lng >= -180 &&
      selectedLocation.lng <= 180
    );
  }

  function isParcelInteractionLocked() {
    return isParcelDrawingActive || Boolean(editingTemporaryParcelId);
  }

  function createPointKey(location) {
    if (!location || !Number.isFinite(location.lat) || !Number.isFinite(location.lng)) {
      return null;
    }
    return `${location.lat.toFixed(7)},${location.lng.toFixed(7)}`;
  }

  function hasConfirmedCurrentPoint() {
    return Boolean(
      currentPointResult &&
      confirmedPointKey &&
      createPointKey(selectedLocation) === confirmedPointKey,
    );
  }

  function syncPointConfirmationState() {
    window.MapUi.syncMobilePointConfirmButton({
      hasPendingPoint: isValidSelectedLocation() && !hasConfirmedCurrentPoint(),
      isLoading: isPointAnalysisLoading,
      isBlocked: isParcelInteractionLocked(),
    });
  }

  function syncLocationActionState() {
    if (isParcelInteractionLocked()) {
      window.MapUi.setLocationActionsEnabled(false);
      syncPointConfirmationState();
      return;
    }

    window.MapUi.setLocationActionsEnabled(true);
    window.MapUi.setConfirmEnabled(isValidSelectedLocation());
    syncPointConfirmationState();
  }

  function clearParcelDetailPanelState() {
    currentDetailParcelId = null;
    parcelDetailPanelOpen = false;
  }

  function isParcelDetailPanelOpenFor(parcelId) {
    return parcelDetailPanelOpen && currentDetailParcelId === parcelId;
  }

  function renderOpenParcelDetailIfCurrent(parcel) {
    if (!parcel || !isParcelDetailPanelOpenFor(parcel.id)) {
      return;
    }

    window.MapUi.renderParcelResult(parcel);
  }

  function getCompletedTemporaryParcels() {
    return [...temporaryParcels.values()].sort((left, right) => left.createdAt - right.createdAt);
  }

  function getNextAvailableParcelName() {
    const usedNames = new Set(
      getCompletedTemporaryParcels().map((parcel) => parcel.name.trim()),
    );
    let index = 1;
    while (usedNames.has(`แปลงที่ ${index}`)) {
      index += 1;
    }
    return `แปลงที่ ${index}`;
  }

  function getParcelStatusText(parcel) {
    if (parcel.analysisStatus === "loading") {
      return window.MapUi.text.parcelLoading;
    }
    if (parcel.analysisStatus === "error") {
      return window.MapUi.text.parcelAnalyzeError;
    }
    if (parcel.analysisStatus === "stale") {
      return `${window.MapFormatters.formatThaiLandArea(parcel.areaSquareMeters)} - ต้องวิเคราะห์ใหม่`;
    }
    if (parcel.analysis && parcel.analysis.parcel) {
      return window.MapFormatters.formatThaiLandArea(parcel.analysis.parcel.areaSquareMeters);
    }
    if (Number.isFinite(parcel.areaSquareMeters)) {
      return window.MapFormatters.formatThaiLandArea(parcel.areaSquareMeters);
    }
    return window.MapUi.text.notEvaluated;
  }

  function getParcelListData() {
    return getCompletedTemporaryParcels()
      .map((parcel) => ({
        id: parcel.id,
        name: parcel.name,
        statusText: getParcelStatusText(parcel),
        isSelected: parcel.id === selectedTemporaryParcelId,
      }));
  }

  function refreshTemporaryParcelList() {
    window.MapUi.renderTemporaryParcelList(getParcelListData(), {
      onSelect: selectTemporaryParcelFromList,
      onFocus: focusTemporaryParcel,
      onRename: renameTemporaryParcel,
      onEdit: startTemporaryParcelEdit,
      onRetry: retryTemporaryParcelAnalysis,
      onDelete: deleteTemporaryParcel,
    });
  }

  function applyParcelStyle(parcel) {
    if (!parcel || !parcel.layer) {
      return;
    }

    parcel.layer.setStyle(
      parcel.id === selectedTemporaryParcelId
        ? TEMPORARY_PARCEL_SELECTED_STYLE
        : TEMPORARY_PARCEL_STYLE,
    );
  }

  function refreshParcelStyles() {
    temporaryParcels.forEach((parcel) => applyParcelStyle(parcel));
  }

  function geometryToLayerGeometry(geometry) {
    const geoJsonLayer = L.geoJSON({
      type: "Feature",
      geometry,
      properties: {},
    });
    const layer = geoJsonLayer.getLayers()[0];
    return layer ? layer.getLatLngs() : [];
  }

  function getOuterLatLngRing(latLngs) {
    if (!Array.isArray(latLngs) || latLngs.length === 0) {
      return [];
    }
    if (latLngs[0] && Number.isFinite(latLngs[0].lat) && Number.isFinite(latLngs[0].lng)) {
      return latLngs;
    }
    return getOuterLatLngRing(latLngs[0]);
  }

  function calculateParcelAreaSquareMeters(layer) {
    if (!layer || !L.GeometryUtil || typeof L.GeometryUtil.geodesicArea !== "function") {
      return null;
    }

    const ring = getOuterLatLngRing(layer.getLatLngs());
    if (ring.length < 3) {
      return null;
    }

    return L.GeometryUtil.geodesicArea(ring);
  }

  function bindTemporaryParcelEvents(parcel) {
    parcel.layer.on("click", () => {
      selectTemporaryParcel(parcel.id);
    });
  }

  function buildTemporaryParcelPopup(parcel) {
    if (parcel.analysisStatus !== "success" || !parcel.analysis) {
      return window.MapUi.createParcelPopupContent({
        ...parcel,
        analysis: {
          name: parcel.name,
          parcel: {
            areaSquareMeters: parcel.areaSquareMeters,
            areaRai: null,
          },
          riceLandSuitability: {},
          maizeLandSuitability: {},
        },
      }, {
        onOpenDetails: openTemporaryParcelDetails,
      });
    }

    return window.MapUi.createParcelPopupContent(parcel, {
      onOpenDetails: openTemporaryParcelDetails,
    });
  }

  function updateTemporaryParcelPopup(parcel, openPopup) {
    parcel.layer.bindPopup(buildTemporaryParcelPopup(parcel));
    if (openPopup) {
      parcel.layer.openPopup();
    }
  }

  function openParcelPopup(parcel) {
    closeResultPopup();
    updateTemporaryParcelPopup(parcel, true);
  }

  function selectTemporaryParcel(parcelId) {
    const parcel = temporaryParcels.get(parcelId);
    if (!parcel) {
      return;
    }

    selectedTemporaryParcelId = parcelId;
    refreshParcelStyles();
    refreshTemporaryParcelList();
    openParcelPopup(parcel);
  }

  function selectTemporaryParcelFromList(parcelId) {
    const parcel = temporaryParcels.get(parcelId);
    if (!parcel) {
      return;
    }

    selectTemporaryParcel(parcelId);
    appMap.panTo(parcel.layer.getBounds().getCenter());
  }

  function openTemporaryParcelDetails(parcelId) {
    const parcel = temporaryParcels.get(parcelId);
    if (!parcel) {
      return;
    }

    currentDetailParcelId = parcelId;
    parcelDetailPanelOpen = true;
    selectedTemporaryParcelId = parcelId;
    refreshParcelStyles();
    refreshTemporaryParcelList();
    window.MapUi.renderParcelResult(parcel);
    if (parcel.layer && parcel.layer.closePopup) {
      parcel.layer.closePopup();
    }
  }

  function focusTemporaryParcel(parcelId) {
    const parcel = temporaryParcels.get(parcelId);
    if (!parcel) {
      return;
    }

    appMap.fitBounds(parcel.layer.getBounds(), {
      padding: [24, 24],
      maxZoom: 18,
    });
    openParcelPopup(parcel);
  }

  async function renameTemporaryParcel(parcelId) {
    const parcel = temporaryParcels.get(parcelId);
    if (!parcel) {
      return;
    }

    const nextName = await window.MapUi.promptParcelName({
      title: "เปลี่ยนชื่อพื้นที่แปลง",
      initialValue: parcel.name,
      confirmText: "บันทึกชื่อ",
    });

    if (!nextName) {
      return;
    }

    parcel.name = nextName.trim();
    if (parcel.analysis && parcel.analysis.name) {
      parcel.analysis.name = parcel.name;
    }
    updateTemporaryParcelPopup(parcel, false);
    refreshTemporaryParcelList();
  }

  async function requestParcelName(defaultName) {
    return window.MapUi.promptParcelName({
      title: "ตั้งชื่อพื้นที่แปลง",
      initialValue: defaultName,
      confirmText: "เริ่มวิเคราะห์",
    });
  }

  async function analyzeTemporaryParcel(parcelId) {
    const parcel = temporaryParcels.get(parcelId);
    if (!parcel) {
      return;
    }

    if (parcel.requestController) {
      parcel.requestController.abort();
    }

    const requestController = new AbortController();
    let didTimeout = false;
    const timeoutId = window.setTimeout(() => {
      didTimeout = true;
      requestController.abort();
    }, POLYGON_ANALYSIS_TIMEOUT_MS);

    parcel.geometry = parcel.layer.toGeoJSON().geometry;
    parcel.areaSquareMeters = calculateParcelAreaSquareMeters(parcel.layer);
    parcel.analysis = null;
    parcel.analysisError = null;
    parcel.analysisStatus = "loading";
    parcel.requestController = requestController;
    refreshTemporaryParcelList();

    try {
      const analysis = await window.MapApi.analyzePolygonArea(
        {
          name: parcel.name,
          geometry: parcel.geometry,
        },
        { signal: requestController.signal },
      );

      if (parcel.requestController !== requestController) {
        return;
      }

      parcel.analysis = analysis;
      parcel.analysisStatus = "success";
      parcel.analysisError = null;
    } catch (error) {
      if (parcel.requestController !== requestController) {
        return;
      }

      if (error.name === "AbortError") {
        if (didTimeout) {
          parcel.analysisStatus = "error";
          parcel.analysisError = "วิเคราะห์ไม่สำเร็จ กรุณาลองใหม่";
          return;
        }
        return;
      }

      parcel.analysisStatus = "error";
      parcel.analysisError = error.message || window.MapUi.text.parcelAnalyzeError;
    } finally {
      window.clearTimeout(timeoutId);
      if (parcel.requestController === requestController) {
        parcel.requestController = null;
        updateTemporaryParcelPopup(parcel, selectedTemporaryParcelId === parcelId);
        refreshTemporaryParcelList();
        renderOpenParcelDetailIfCurrent(parcel);
      }
    }
  }

  async function registerTemporaryParcel(layer, requestedName) {
    const parcelId = createFrontendId();
    const parcel = {
      id: parcelId,
      name: requestedName,
      layer,
      geometry: layer.toGeoJSON().geometry,
      analysis: null,
      analysisStatus: "idle",
      analysisError: null,
      areaSquareMeters: calculateParcelAreaSquareMeters(layer),
      requestController: null,
      createdAt: Date.now(),
    };

    temporaryParcels.set(parcelId, parcel);
    temporaryParcelLayers.addLayer(layer);
    bindTemporaryParcelEvents(parcel);
    updateTemporaryParcelPopup(parcel, false);
    refreshTemporaryParcelList();
    selectTemporaryParcel(parcelId);
    await analyzeTemporaryParcel(parcelId);
  }

  function startTemporaryParcelEdit(parcelId) {
    const parcel = temporaryParcels.get(parcelId);
    if (!parcel || isParcelInteractionLocked()) {
      return;
    }

    window.MapUi.closeTemporaryParcelPanel();
    appMap.fitBounds(parcel.layer.getBounds(), {
      paddingTopLeft: [20, 100],
      paddingBottomRight: [20, 140],
      maxZoom: 18,
    });
    editingTemporaryParcelId = parcelId;
    editingOriginalGeometry = cloneGeometry(parcel.layer.toGeoJSON().geometry);
    parcel.layer.editing.enable();
    selectedTemporaryParcelId = parcelId;
    refreshParcelStyles();
    refreshTemporaryParcelList();
    window.MapUi.closeCurrentResultPanel();
    window.MapUi.setParcelControlState({
      isEditing: true,
      drawDisabled: true,
    });
    syncLocationActionState();
  }

  async function saveTemporaryParcelEdit() {
    if (!editingTemporaryParcelId) {
      return;
    }

    const parcel = temporaryParcels.get(editingTemporaryParcelId);
    if (!parcel) {
      editingTemporaryParcelId = null;
      editingOriginalGeometry = null;
      syncLocationActionState();
      return;
    }

    parcel.layer.editing.disable();
    parcel.geometry = parcel.layer.toGeoJSON().geometry;
    parcel.areaSquareMeters = calculateParcelAreaSquareMeters(parcel.layer);
    parcel.analysis = null;
    parcel.analysisError = null;
    updateTemporaryParcelPopup(parcel, false);
    editingTemporaryParcelId = null;
    editingOriginalGeometry = null;
    window.MapUi.setParcelControlState({
      isEditing: false,
      drawDisabled: false,
    });
    syncLocationActionState();
    refreshTemporaryParcelList();
    refreshParcelStyles();
    window.MapUi.closeCurrentResultPanel();
    await analyzeTemporaryParcel(parcel.id);
  }

  function cancelTemporaryParcelEdit() {
    if (!editingTemporaryParcelId) {
      return;
    }

    const parcel = temporaryParcels.get(editingTemporaryParcelId);
    if (parcel) {
      parcel.layer.editing.disable();
      if (editingOriginalGeometry) {
        parcel.layer.setLatLngs(geometryToLayerGeometry(editingOriginalGeometry));
      }
    }

    editingTemporaryParcelId = null;
    editingOriginalGeometry = null;
    window.MapUi.setParcelControlState({
      isEditing: false,
      drawDisabled: false,
    });
    syncLocationActionState();
    refreshParcelStyles();
    refreshTemporaryParcelList();
  }

  async function retryTemporaryParcelAnalysis(parcelId) {
    const parcel = temporaryParcels.get(parcelId);
    if (!parcel) {
      return;
    }

    selectedTemporaryParcelId = parcelId;
    refreshParcelStyles();
    refreshTemporaryParcelList();
    window.MapUi.closeCurrentResultPanel();
    await analyzeTemporaryParcel(parcelId);
  }

  function deleteTemporaryParcel(parcelId) {
    const parcel = temporaryParcels.get(parcelId);
    if (!parcel) {
      return;
    }

    const shouldDelete = window.confirm(`ลบ ${parcel.name} ใช่หรือไม่`);
    if (!shouldDelete) {
      return;
    }

    if (parcel.requestController) {
      parcel.requestController.abort();
    }

    if (editingTemporaryParcelId === parcelId) {
      editingTemporaryParcelId = null;
      editingOriginalGeometry = null;
      window.MapUi.setParcelControlState({
        isEditing: false,
        drawDisabled: false,
      });
    }

    temporaryParcelLayers.removeLayer(parcel.layer);
    temporaryParcels.delete(parcelId);

    if (selectedTemporaryParcelId === parcelId) {
      selectedTemporaryParcelId = null;
    }

    if (currentDetailParcelId === parcelId) {
      window.MapUi.closeCurrentResultPanel();
    }

    if (temporaryParcels.size === 0) {
      window.MapUi.closeCurrentResultPanel();
    }

    refreshTemporaryParcelList();
    refreshParcelStyles();
    syncLocationActionState();
  }

  function applyLeafletDrawThaiText() {
    if (!L.drawLocal || !L.drawLocal.draw) {
      return;
    }

    L.drawLocal.draw.toolbar.actions = {
      title: "ยกเลิกการวาด",
      text: "ยกเลิก",
    };
    L.drawLocal.draw.toolbar.finish = {
      title: "ปิดพื้นที่แปลง",
      text: "เสร็จสิ้น",
    };
    L.drawLocal.draw.toolbar.undo = {
      title: "ลบจุดล่าสุด",
      text: "ลบจุดล่าสุด",
    };
    L.drawLocal.draw.handlers.polygon = {
      tooltip: {
        start: "คลิกบนแผนที่เพื่อเริ่มวาดขอบเขตแปลง",
        cont: "คลิกเพื่อเพิ่มจุดขอบเขต",
        end: "คลิกจุดแรกเพื่อปิดพื้นที่แปลง กด Esc หรือกดปุ่มยกเลิกการวาดเพื่อยกเลิก",
      },
    };
  }

  function resetParcelDrawingState() {
    isParcelDrawingActive = false;
    syncLocationActionState();
    window.MapUi.setParcelControlState({
      isEditing: Boolean(editingTemporaryParcelId),
      drawDisabled: Boolean(editingTemporaryParcelId),
      isDrawing: false,
    });
  }

  function cancelParcelDrawing() {
    if (!parcelDrawHandler || !isParcelDrawingActive) {
      return;
    }

    parcelDrawHandler.disable();
    resetParcelDrawingState();
  }

  function handleParcelDrawKeydown(event) {
    if (event.key !== "Escape" || !isParcelDrawingActive) {
      return;
    }

    event.preventDefault();
    cancelParcelDrawing();
  }

  async function handleDrawCreated(event) {
    resetParcelDrawingState();

    const layer = event.layer;
    layer.setStyle(TEMPORARY_PARCEL_STYLE);

    const defaultName = getNextAvailableParcelName();
    const parcelName = await requestParcelName(defaultName);

    if (!parcelName) {
      return;
    }

    await registerTemporaryParcel(layer, parcelName.trim());
  }

  function startParcelDrawing() {
    if (editingTemporaryParcelId || !parcelDrawHandler) {
      return;
    }

    if (isParcelDrawingActive) {
      cancelParcelDrawing();
      return;
    }

    isParcelDrawingActive = true;
    syncLocationActionState();
    window.MapUi.setParcelControlState({
      isEditing: false,
      drawDisabled: false,
      isDrawing: true,
    });
    parcelDrawHandler.enable();
  }

  function initTemporaryParcels(map) {
    temporaryParcelLayers.addTo(map);
    applyLeafletDrawThaiText();
    parcelDrawHandler = new L.Draw.Polygon(map, {
      allowIntersection: false,
      repeatMode: false,
      shapeOptions: TEMPORARY_PARCEL_STYLE,
    });

    map.on(L.Draw.Event.CREATED, handleDrawCreated);
    map.on(L.Draw.Event.DRAWSTOP, () => {
      if (!editingTemporaryParcelId) {
        resetParcelDrawingState();
      }
    });

    document.removeEventListener("keydown", handleParcelDrawKeydown);
    document.addEventListener("keydown", handleParcelDrawKeydown);

    window.MapUi.addParcelDrawControl(map, {
      onDraw: startParcelDrawing,
      onSaveEdit: saveTemporaryParcelEdit,
      onCancelEdit: cancelTemporaryParcelEdit,
    });
    window.MapUi.setParcelControlState({
      isEditing: false,
      drawDisabled: false,
      isDrawing: false,
    });
    refreshTemporaryParcelList();
  }

  function initMap() {
    const mapConfig = window.AppConfig.map;
    const map = L.map("map").setView(mapConfig.center, mapConfig.zoom);
    const baseLayers = window.MapLayers.createBaseLayers();
    const overlayLayers = window.MapLayers.createOverlayLayers(map);

    appMap = map;
    baseLayers.googleSatellite.addTo(map);
    window.MapUi.addLayerControl(map, baseLayers, overlayLayers);
    window.MapUi.setupLocationPanel({
      onLocate: requestCurrentLocation,
      onConfirm: confirmSelectedLocation,
    });
    window.MapUi.setResultPanelCloseHandler(clearParcelDetailPanelState);
    syncPointConfirmationState();
    const mobilePointConfirmMediaQuery = window.matchMedia("(max-width: 700px)");
    if (mobilePointConfirmMediaQuery.addEventListener) {
      mobilePointConfirmMediaQuery.addEventListener("change", syncPointConfirmationState);
    } else if (mobilePointConfirmMediaQuery.addListener) {
      mobilePointConfirmMediaQuery.addListener(syncPointConfirmationState);
    }
    initTemporaryParcels(map);

    map.on("click", handleMapClick);

    window.appMap = map;
  }

  function handleMapClick(event) {
    if (isParcelInteractionLocked()) {
      return;
    }

    selectedLocation = {
      lat: event.latlng.lat,
      lng: event.latlng.lng,
      accuracy: null,
      source: "map",
    };

    updateLocationMarker(selectedLocation);
    removeAccuracyCircle();
    window.MapUi.showMapSelectionReady(selectedLocation);
    markSelectedPointPending(true);
  }

  function handleMarkerDragEnd(event) {
    if (isParcelInteractionLocked()) {
      return;
    }

    const position = event.target.getLatLng();

    selectedLocation = {
      lat: position.lat,
      lng: position.lng,
      accuracy: null,
      source: "drag",
    };

    removeAccuracyCircle();
    window.MapUi.showDragSelectionReady(selectedLocation);
    markSelectedPointPending(true);
  }

  function requestCurrentLocation() {
    if (isParcelInteractionLocked()) {
      window.MapUi.showLocationMessage(window.MapUi.text.parcelEditLocked);
      return;
    }

    if (!window.isSecureContext) {
      window.MapUi.showLocationMessage(window.MapUi.text.secureContext);
      return;
    }

    window.MapUi.showGpsLoading();

    if (!navigator.geolocation) {
      window.MapUi.showLocationMessage(window.MapUi.text.unsupported);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      handleLocationSuccess,
      handleLocationError,
      GEOLOCATION_OPTIONS,
    );
  }

  function handleLocationSuccess(position) {
    if (isParcelInteractionLocked()) {
      window.MapUi.showLocationMessage(window.MapUi.text.parcelEditLocked);
      return;
    }

    selectedLocation = {
      lat: position.coords.latitude,
      lng: position.coords.longitude,
      accuracy: position.coords.accuracy,
      source: "gps",
    };

    updateLocationMarker(selectedLocation);
    updateAccuracyCircle(selectedLocation);
    window.MapUi.showGpsReady(selectedLocation);
    markSelectedPointPending(true);
  }

  function handleLocationError(error) {
    window.MapUi.showLocationMessage(window.MapUi.getGeolocationErrorMessage(error));
  }

  function updateLocationMarker(location) {
    const latLng = [location.lat, location.lng];

    if (!locationMarker) {
      locationMarker = L.marker(latLng, {
        draggable: true,
      }).addTo(appMap);
      locationMarker.on("dragend", handleMarkerDragEnd);
    } else {
      locationMarker.setLatLng(latLng);
    }
  }

  function updateAccuracyCircle(location) {
    const latLng = [location.lat, location.lng];

    if (!accuracyCircle) {
      accuracyCircle = L.circle(latLng, {
        radius: location.accuracy || 0,
        color: "#0f766e",
        weight: 1,
        fillColor: "#14b8a6",
        fillOpacity: 0.14,
      }).addTo(appMap);
    } else {
      accuracyCircle.setLatLng(latLng);
      accuracyCircle.setRadius(location.accuracy || 0);
    }

    appMap.setView(latLng, 17);
  }

  function removeAccuracyCircle() {
    if (!accuracyCircle) {
      return;
    }

    appMap.removeLayer(accuracyCircle);
    accuracyCircle = null;
  }

  function refreshSelectedPointPopup(openPopup) {
    if (!locationMarker || !isValidSelectedLocation()) {
      closeResultPopup();
      return;
    }

    closeResultPopup();
    resultPopup = L.popup().setLatLng(locationMarker.getLatLng());

    if (hasConfirmedCurrentPoint()) {
      resultPopup.setContent(
        window.MapUi.createPopupContent(currentPointResult, {
          onOpenResult: openCurrentPointResult,
        }),
      );
    } else {
      closeResultPopup();
      syncLocationActionState();
      return;
    }

    locationMarker.bindPopup(resultPopup);
    if (openPopup) {
      locationMarker.openPopup();
    }
  }

  function markSelectedPointPending(openPopup = true) {
    if (!hasConfirmedCurrentPoint()) {
      window.MapUi.closeCurrentResultPanel();
      closeResultPopup();
      syncLocationActionState();
      return;
    }
    refreshSelectedPointPopup(openPopup);
    syncLocationActionState();
  }

  function openCurrentPointResult() {
    if (!hasConfirmedCurrentPoint()) {
      syncPointConfirmationState();
      return;
    }

    clearParcelDetailPanelState();
    window.MapUi.renderResultPanel(currentPointResult);
    syncPointConfirmationState();
  }

  async function confirmSelectedLocation() {
    if (isParcelInteractionLocked()) {
      window.MapUi.showLocationMessage(window.MapUi.text.parcelEditLocked);
      return;
    }

    if (isPointAnalysisLoading) {
      return;
    }

    if (!isValidSelectedLocation()) {
      window.MapUi.showLocationMessage(window.MapUi.text.positionUnavailable);
      return;
    }

    if (pointRequestController) {
      pointRequestController.abort();
    }

    pointRequestController = new AbortController();
    const requestController = pointRequestController;
    const requestLocation = { ...selectedLocation };
    const requestPointKey = createPointKey(requestLocation);

    isPointAnalysisLoading = true;
    window.MapUi.setConfirmEnabled(false);
    syncPointConfirmationState();

    if (window.MapUi.isMobileLayout()) {
      window.MapUi.showLocationMessage(window.MapUi.text.apiLoading);
    } else {
      clearParcelDetailPanelState();
      window.MapUi.showAnalysisLoading();
    }

    try {
      const data = await window.MapApi.getRiceSuitabilityAtPoint(
        requestLocation.lat,
        requestLocation.lng,
        { signal: requestController.signal },
      );

      if (data.success === false) {
        throw new Error(data.error || window.MapUi.text.apiError);
      }

      currentPointResult = data;
      confirmedPointKey = requestPointKey;

      if (createPointKey(selectedLocation) === requestPointKey) {
        clearParcelDetailPanelState();
        window.MapUi.renderResultPanel(data);
        if (data.found !== false) {
          refreshSelectedPointPopup(false);
        } else {
          closeResultPopup();
        }
      } else {
        refreshSelectedPointPopup(false);
      }
    } catch (error) {
      if (error.name === "AbortError") {
        return;
      }

      isPointAnalysisLoading = false;
      window.MapUi.setConfirmEnabled(isValidSelectedLocation());
      syncPointConfirmationState();
      window.MapUi.showApiError();
    } finally {
      if (pointRequestController === requestController) {
        pointRequestController = null;
      }
      isPointAnalysisLoading = false;
      window.MapUi.setConfirmEnabled(isValidSelectedLocation());
      syncPointConfirmationState();
    }
  }

  function openResultPopup(data) {
    if (!locationMarker) {
      return;
    }

    closeResultPopup();

    resultPopup = L.popup()
      .setLatLng(locationMarker.getLatLng())
      .setContent(
        window.MapUi.createPopupContent(data, {
          onOpenResult: openCurrentPointResult,
        }),
      )
      .openOn(appMap);
  }

  function closeResultPopup() {
    if (!resultPopup) {
      return;
    }

    if (locationMarker) {
      locationMarker.unbindPopup();
    }
    resultPopup.remove();
    resultPopup = null;
  }

  window.addEventListener("DOMContentLoaded", initMap);
})(window);
