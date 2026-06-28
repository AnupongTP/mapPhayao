(function (window) {
  let selectedLocation = null;
  let locationMarker = null;
  let accuracyCircle = null;
  let pointRequestController = null;
  let resultPopup = null;
  let appMap = null;
  let parcelDraftLayer = null;
  let parcelSavedLayer = null;
  let parcelDrawHandler = null;
  let parcelDraftGeometry = null;
  let selectedParcel = null;
  let latestPointData = null;
  let isParcelDrawing = false;

  const GEOLOCATION_OPTIONS = {
    enableHighAccuracy: true,
    timeout: 15000,
    maximumAge: 0,
  };

  const PARCEL_STYLE = {
    color: "#2563eb",
    weight: 2,
    fillColor: "#60a5fa",
    fillOpacity: 0.12,
    pane: "parcelPane",
  };

  const PARCEL_SELECTED_STYLE = {
    color: "#0f766e",
    weight: 3,
    fillColor: "#14b8a6",
    fillOpacity: 0.18,
    pane: "parcelPane",
  };

  const PARCEL_DRAFT_STYLE = {
    color: "#0f766e",
    weight: 2,
    fillColor: "#14b8a6",
    fillOpacity: 0.12,
    pane: "parcelPane",
  };

  function initMap() {
    const mapConfig = window.AppConfig.map;
    const map = L.map("map").setView(mapConfig.center, mapConfig.zoom);
    const baseLayers = window.MapLayers.createBaseLayers();
    const overlayLayers = window.MapLayers.createOverlayLayers(map);

    appMap = map;
    baseLayers.openStreetMap.addTo(map);

    parcelDraftLayer = L.featureGroup().addTo(map);
    parcelSavedLayer = L.geoJSON([], {
      pane: "parcelPane",
      style: getSavedParcelStyle,
      onEachFeature: onEachSavedParcelFeature,
    }).addTo(map);

    window.MapUi.addLayerControl(map, baseLayers, overlayLayers);
    window.MapUi.setupLocationPanel({
      onLocate: requestCurrentLocation,
      onConfirm: confirmSelectedLocation,
      onDrawParcel: startParcelDrawing,
    });

    map.on("click", handleMapClick);
    map.on(L.Draw.Event.CREATED, handleParcelDrawCreated);

    window.appMap = map;
    loadSavedParcels();
  }

  function getSavedParcelStyle(feature) {
    const parcel = feature?.properties || {};
    const isSelected = Boolean(selectedParcel && parcel.id === selectedParcel.id);

    return isSelected ? PARCEL_SELECTED_STYLE : PARCEL_STYLE;
  }

  function onEachSavedParcelFeature(feature, layer) {
    layer.on("click", () => {
      const parcel = feature?.properties || null;
      if (!parcel) {
        return;
      }

      selectParcel(parcel, layer, true);
    });
  }

  function refreshSavedParcelStyles() {
    if (!parcelSavedLayer) {
      return;
    }

    parcelSavedLayer.eachLayer((layer) => {
      const parcel = layer.feature?.properties || null;
      if (parcel) {
        layer.setStyle(
          selectedParcel && parcel.id === selectedParcel.id
            ? PARCEL_SELECTED_STYLE
            : PARCEL_STYLE,
        );
      }
    });
  }

  function handleMapClick(event) {
    if (isParcelDrawing) {
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
  }

  function handleMarkerDragEnd(event) {
    const position = event.target.getLatLng();

    selectedLocation = {
      lat: position.lat,
      lng: position.lng,
      accuracy: null,
      source: "drag",
    };

    removeAccuracyCircle();
    window.MapUi.showDragSelectionReady(selectedLocation);
  }

  function requestCurrentLocation() {
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
    selectedLocation = {
      lat: position.coords.latitude,
      lng: position.coords.longitude,
      accuracy: position.coords.accuracy,
      source: "gps",
    };

    updateLocationMarker(selectedLocation);
    updateAccuracyCircle(selectedLocation);
    window.MapUi.showGpsReady(selectedLocation);
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

  async function confirmSelectedLocation() {
    if (isParcelDrawing) {
      window.MapUi.showLocationMessage("กรุณาวาดขอบเขตแปลงให้เสร็จก่อน");
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

    window.MapUi.showAnalysisLoading();

    try {
      const data = await window.MapApi.getRiceSuitabilityAtPoint(
        selectedLocation.lat,
        selectedLocation.lng,
        { signal: requestController.signal },
      );

      if (data.success === false) {
        throw new Error(data.error || window.MapUi.text.apiError);
      }

      latestPointData = data;
      window.MapUi.renderResultPanel(data, selectedParcel);

      if (data.found !== false) {
        openResultPopup(data);
      }
    } catch (error) {
      if (error.name === "AbortError") {
        return;
      }

      window.MapUi.showApiError();
    } finally {
      if (pointRequestController === requestController) {
        pointRequestController = null;
      }
    }
  }

  function openResultPopup(data) {
    if (!locationMarker) {
      return;
    }

    if (resultPopup) {
      resultPopup.remove();
    }

    resultPopup = L.popup()
      .setLatLng(locationMarker.getLatLng())
      .setContent(window.MapUi.createPopupContent(data))
      .openOn(appMap);
  }

  function openParcelPopup(parcel, layer) {
    if (resultPopup) {
      resultPopup.remove();
    }

    const popupLatLng = layer ? layer.getBounds().getCenter() : locationMarker?.getLatLng();
    if (!popupLatLng) {
      return;
    }

    resultPopup = L.popup()
      .setLatLng(popupLatLng)
      .setContent(window.MapUi.createParcelPopupContent(parcel))
      .openOn(appMap);
  }

  function startParcelDrawing() {
    if (!appMap || isParcelDrawing) {
      return;
    }

    if (!window.L || !L.Draw || !L.Draw.Polygon) {
      window.MapUi.showLocationMessage("เบราว์เซอร์นี้ไม่รองรับการวาดแปลง");
      return;
    }

    clearDraftParcelLayer();
    isParcelDrawing = true;
    parcelDraftGeometry = null;
    window.MapUi.setConfirmEnabled(false);
    window.MapUi.showLocationMessage(window.MapUi.text.parcelDraftReady);

    parcelDrawHandler = new L.Draw.Polygon(appMap, {
      allowIntersection: false,
      repeatMode: false,
      showArea: true,
      shapeOptions: PARCEL_DRAFT_STYLE,
    });

    parcelDrawHandler.enable();
  }

  function handleParcelDrawCreated(event) {
    if (event.layerType !== "polygon") {
      return;
    }

    const layer = event.layer;
    clearDraftParcelLayer();
    parcelDraftLayer.addLayer(layer);
    parcelDraftGeometry = layer.toGeoJSON().geometry;
    isParcelDrawing = false;
    parcelDrawHandler = null;

    const area = calculateApproximateArea(layer);

    window.MapUi.showParcelDraftForm({
      approxAreaSqm: area.areaSqm,
      approxAreaRai: area.areaRai,
      onSave: handleParcelSave,
      onCancel: cancelParcelDraft,
      onDelete: cancelParcelDraft,
    });

    appMap.fitBounds(layer.getBounds(), { padding: [20, 20] });
    window.MapUi.setConfirmEnabled(Boolean(isValidSelectedLocation()));
  }

  function calculateApproximateArea(layer) {
    const latLngs = layer.getLatLngs();
    const ring = Array.isArray(latLngs[0]) ? latLngs[0] : latLngs;
    const areaSqm =
      window.L?.GeometryUtil && typeof window.L.GeometryUtil.geodesicArea === "function"
        ? window.L.GeometryUtil.geodesicArea(ring)
        : 0;

    return {
      areaSqm,
      areaRai: areaSqm / 1600,
    };
  }

  function clearDraftParcelLayer() {
    if (parcelDraftLayer) {
      parcelDraftLayer.clearLayers();
    }

    parcelDraftGeometry = null;
    parcelDrawHandler = null;
    isParcelDrawing = false;
  }

  function restoreLocationStatus() {
    if (!selectedLocation) {
      window.MapUi.showLocationMessage(window.MapUi.text.noSelection);
      window.MapUi.setConfirmEnabled(false);
      return;
    }

    if (selectedLocation.source === "gps") {
      window.MapUi.showGpsReady(selectedLocation);
      return;
    }

    if (selectedLocation.source === "drag") {
      window.MapUi.showDragSelectionReady(selectedLocation);
      return;
    }

    window.MapUi.showMapSelectionReady(selectedLocation);
  }

  function cancelParcelDraft() {
    clearDraftParcelLayer();
    restoreLocationStatus();
    window.MapUi.renderResultPanel(latestPointData, selectedParcel);
    window.MapUi.showLocationMessage(window.MapUi.text.parcelDraftCancelled);
  }

  async function handleParcelSave(values) {
    if (!parcelDraftGeometry) {
      window.MapUi.showLocationMessage(window.MapUi.text.parcelDraftMissing);
      return;
    }

    const cropType = String(values.cropType || "").trim();
    if (!cropType) {
      values.setMessage("กรุณาระบุชนิดพืช");
      return;
    }

    values.setBusy(true);
    values.setMessage("กำลังบันทึกแปลง...");

    try {
      const response = await window.MapApi.createParcel({
        parcelName: String(values.parcelName || "").trim(),
        cropType,
        riceVariety: String(values.riceVariety || "").trim(),
        plantingDate: String(values.plantingDate || "").trim(),
        geometry: {
          type: parcelDraftGeometry.type,
          coordinates: parcelDraftGeometry.coordinates,
        },
      });

      if (!response || response.success === false || !response.parcel) {
        throw new Error(response?.error || "ไม่สามารถบันทึกแปลงได้ กรุณาลองใหม่");
      }

      selectedParcel = response.parcel;
      addSavedParcel(response.parcel);
      clearDraftParcelLayer();
      restoreLocationStatus();
      window.MapUi.renderResultPanel(null, selectedParcel);
      window.MapUi.showLocationMessage(window.MapUi.text.parcelDraftSaved);
      openParcelPopup(response.parcel, getLayerForParcel(response.parcel.id));
    } catch (error) {
      values.setMessage(error.message || "ไม่สามารถบันทึกแปลงได้ กรุณาลองใหม่");
    } finally {
      values.setBusy(false);
      window.MapUi.setConfirmEnabled(Boolean(isValidSelectedLocation()) && !isParcelDrawing);
    }
  }

  function addSavedParcel(parcel) {
    if (!parcelSavedLayer || !parcel || !parcel.geometry) {
      return;
    }

    const feature = {
      type: "Feature",
      geometry: parcel.geometry,
      properties: {
        ...parcel,
      },
    };

    parcelSavedLayer.addData(feature);
    refreshSavedParcelStyles();

    const layer = getLayerForParcel(parcel.id);
    if (layer) {
      appMap.fitBounds(layer.getBounds(), { padding: [24, 24] });
    }
  }

  function getLayerForParcel(parcelId) {
    if (!parcelSavedLayer) {
      return null;
    }

    let foundLayer = null;
    parcelSavedLayer.eachLayer((layer) => {
      const parcel = layer.feature?.properties || null;
      if (parcel && String(parcel.id) === String(parcelId)) {
        foundLayer = layer;
      }
    });

    return foundLayer;
  }

  function selectParcel(parcel, layer, shouldOpenPopup) {
    selectedParcel = parcel;
    refreshSavedParcelStyles();
    window.MapUi.renderResultPanel(null, selectedParcel);

    if (shouldOpenPopup) {
      openParcelPopup(parcel, layer || getLayerForParcel(parcel.id));
    }
  }

  async function loadSavedParcels() {
    try {
      const response = await window.MapApi.listParcels();
      const parcels = Array.isArray(response?.parcels) ? response.parcels : [];

      parcels.forEach((parcel) => addSavedParcel(parcel));
      refreshSavedParcelStyles();
    } catch (error) {
      // Keep the map usable even if the parcel list cannot be loaded.
    }
  }

  window.addEventListener("DOMContentLoaded", initMap);
})(window);
