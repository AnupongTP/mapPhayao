// ไฟล์ควบคุม flow ของแผนที่: เลือกตำแหน่ง, GPS, confirm, และ point analysis
(function (window) {
  let selectedLocation = null;
  let locationMarker = null;
  let accuracyCircle = null;
  let pointRequestController = null;
  let resultPopup = null;
  let appMap = null;

  const GEOLOCATION_OPTIONS = {
    enableHighAccuracy: true,
    timeout: 15000,
    maximumAge: 0,
  };

  function initMap() {
    // สร้าง Leaflet map เพียงครั้งเดียว แล้วผูก layers กับ panels เข้าด้วยกัน
    const mapConfig = window.AppConfig.map;
    const map = L.map("map").setView(mapConfig.center, mapConfig.zoom);
    const baseLayers = window.MapLayers.createBaseLayers();
    const overlayLayers = window.MapLayers.createOverlayLayers(map);

    appMap = map;
    baseLayers.openStreetMap.addTo(map);
    window.MapUi.addLayerControl(map, baseLayers, overlayLayers);
    window.MapUi.setupLocationPanel({
      onLocate: requestCurrentLocation,
      onConfirm: confirmSelectedLocation,
    });

    map.on("click", handleMapClick);

    window.appMap = map;
  }

  function handleMapClick(event) {
    // คลิกแผนที่เปลี่ยนตำแหน่งที่เลือก แต่ยังไม่เรียก API จนกว่าผู้ใช้จะยืนยัน
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
    // ลาก marker จบแล้วค่อยอัปเดตพิกัด เพื่อไม่ยิง request ระหว่างลาก
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
    // ขอพิกัดจากอุปกรณ์เมื่อผู้ใช้กดปุ่มตำแหน่งปัจจุบัน
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
    // GPS สำเร็จ: ย้าย marker เดิม และอัปเดต accuracy circle แต่ยังไม่เรียก point API
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
    // เรียก point-analysis API เฉพาะตอนผู้ใช้กด confirm เท่านั้น
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

      window.MapUi.renderResultPanel(data);

      if (data.found !== false) {
        openResultPopup(data);
      } else {
        closeResultPopup();
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
    // Popup ใช้แค่สรุปสั้น ส่วนรายละเอียดจริงอยู่ใน result panel
    if (!locationMarker) {
      return;
    }

    closeResultPopup();

    resultPopup = L.popup()
      .setLatLng(locationMarker.getLatLng())
      .setContent(window.MapUi.createPopupContent(data))
      .openOn(appMap);
  }

  function closeResultPopup() {
    if (!resultPopup) {
      return;
    }

    resultPopup.remove();
    resultPopup = null;
  }

  window.addEventListener("DOMContentLoaded", initMap);
})(window);
