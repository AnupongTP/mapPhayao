// ไฟล์สร้าง panel, card, popup, และข้อความที่ผู้ใช้เห็นบนหน้าแผนที่
(function (window) {
  const formatters = window.MapFormatters;
  const TEXT = {
    empty: formatters.EMPTY_TEXT,
    notEvaluated: formatters.NOT_EVALUATED_TEXT,
    locationTitle: "ตำแหน่งที่เลือก",
    instruction: "คลิกบนแผนที่ ลากหมุด หรือใช้ตำแหน่งปัจจุบัน",
    noSelection: "ยังไม่ได้เลือกตำแหน่ง",
    mapReady: "เลือกตำแหน่งแล้ว กรุณาตรวจสอบหมุดและกดยืนยันตำแหน่ง",
    dragReady: "อัปเดตตำแหน่งแล้ว กรุณาตรวจสอบหมุดและกดยืนยันตำแหน่ง",
    locate: "หาตำแหน่งปัจจุบัน",
    confirm: "ยืนยันตำแหน่ง",
    gpsLoading: "กำลังค้นหาตำแหน่งปัจจุบัน...",
    gpsReady: "พบตำแหน่งปัจจุบันแล้ว กรุณาตรวจสอบหมุดและกดยืนยันตำแหน่ง",
    apiLoading: "กำลังตรวจสอบข้อมูลพื้นที่...",
    unsupported: "อุปกรณ์หรือเบราว์เซอร์นี้ไม่รองรับการระบุตำแหน่ง กรุณาเลือกตำแหน่งจากแผนที่",
    permissionDenied: "ไม่สามารถเข้าถึงตำแหน่งได้ กรุณาอนุญาตการใช้ตำแหน่ง หรือเลือกตำแหน่งจากแผนที่",
    positionUnavailable: "ไม่พบตำแหน่งปัจจุบัน กรุณาลองใหม่หรือเลือกตำแหน่งจากแผนที่",
    timeout: "ใช้เวลาค้นหาตำแหน่งนานเกินไป กรุณาลองใหม่",
    secureContext: "เบราว์เซอร์ไม่อนุญาตให้เข้าถึงตำแหน่ง กรุณาใช้งานผ่าน HTTPS หรือ localhost",
    apiError: "ไม่สามารถโหลดข้อมูลพื้นที่ได้ กรุณาลองใหม่",
    noGisData: "ไม่พบข้อมูล GIS สำหรับตำแหน่งนี้",
    phayaoCoverage: "ข้อมูลปัจจุบันครอบคลุมเฉพาะพื้นที่จังหวัดพะเยา",
    mapSource: "เลือกจากแผนที่",
    dragSource: "ลากหมุด",
    gpsSource: "ตำแหน่งปัจจุบัน",
    riceSuitabilityTitle: "ความเหมาะสมของที่ดินสำหรับปลูกข้าว",
    riceSuitabilitySource: "ผลจากชั้นข้อมูล Potential ของกรมพัฒนาที่ดิน",
    incompleteEvaluation: "ยังไม่ได้ประเมินครบทุกปัจจัย",
  };

  const suitabilityLabels = {
    S1: "เหมาะสมมาก",
    S2: "เหมาะสมปานกลาง",
    S3: "เหมาะสมน้อย",
    N: "ไม่เหมาะสม",
  };

  const suitabilityClasses = {
    S1: "status-s1",
    S2: "status-s2",
    S3: "status-s3",
    N: "status-n",
    NO_COVERAGE: "status-no-coverage",
  };

  function addLayerControl(map, baseLayers, overlayLayers) {
    // รวม base layer กับ overlay layer เข้า control เดียว เพื่อให้ผู้ใช้เปิดปิดทีละชั้น
    const layerControlBaseLayers = {
      OpenStreetMap: baseLayers.openStreetMap,
      GoogleSatellite: baseLayers.googleSatellite,
    };

    const layerControlOverlayLayers = {};
    const addOverlay = (label, layer) => {
      if (layer) {
        layerControlOverlayLayers[label] = layer;
      }
    };

    addOverlay("Thailand provinces", overlayLayers.thailandProvince);
    addOverlay("ขอบเขตตำบล", overlayLayers.tambonWms);
    addOverlay("ขอบเขตอำเภอ", overlayLayers.amphoeWms);
    addOverlay("ขอบเขตลุ่มน้ำหลัก", overlayLayers.mainBasinLayer);
    addOverlay("ขอบเขตลุ่มน้ำย่อย", overlayLayers.subBasinLayer);
    addOverlay("ลุ่มน้ำ", overlayLayers.basinWms);
    addOverlay("แม่น้ำและลำห้วย", overlayLayers.streamWms);
    addOverlay("คลองชลประทาน", overlayLayers.irrigationCanalWms);
    addOverlay("ความเหมาะสมปลูกข้าว — ทุกระดับ", overlayLayers.ricePotentialAllLayer);
    // addOverlay("S1 — เหมาะสมมาก", overlayLayers.ricePotentialS1Layer);
    // addOverlay("S2 — เหมาะสมปานกลาง", overlayLayers.ricePotentialS2Layer);
    // addOverlay("S3 — เหมาะสมน้อย", overlayLayers.ricePotentialS3Layer);
    // addOverlay("N — ไม่เหมาะสม", overlayLayers.ricePotentialNLayer);

    return L.control
      .layers(layerControlBaseLayers, layerControlOverlayLayers, {
        position: "topleft",
        collapsed: true,
      })
      .addTo(map);
  }

  function createElement(tagName, className, text) {
    const element = document.createElement(tagName);
    if (className) {
      element.className = className;
    }
    if (text !== undefined) {
      element.textContent = text;
    }
    return element;
  }

  function appendField(parent, label, value, formatter) {
    const row = createElement("div", "result-field");
    row.append(
      createElement("dt", "result-label", label),
      createElement("dd", "result-value", formatter ? formatter(value) : formatters.formatValue(value)),
    );
    parent.appendChild(row);
  }

  function appendSection(parent, title, fields) {
    const section = createElement("section", "result-section");
    section.append(createElement("h3", null, title));
    const list = createElement("dl", "result-list");
    fields.forEach((field) => appendField(list, field.label, field.value, field.formatter));
    section.appendChild(list);
    parent.appendChild(section);
  }

  function createSummaryRow(label, value, formatter) {
    const row = createElement("div", "summary-card-row");
    row.append(
      createElement("dt", "summary-card-label", label),
      createElement("dd", "summary-card-value", formatter ? formatter(value) : formatters.formatValue(value)),
    );
    return row;
  }

  function appendSummaryGroup(parent, title, rows) {
    const group = createElement("section", "summary-card-group");
    group.append(createElement("h4", null, title));
    const list = createElement("dl", "summary-card-list");
    rows.forEach((row) => list.appendChild(createSummaryRow(row.label, row.value, row.formatter)));
    group.appendChild(list);
    parent.appendChild(group);
  }

  function formatSource(source) {
    if (source === "map") {
      return TEXT.mapSource;
    }
    if (source === "drag") {
      return TEXT.dragSource;
    }
    if (source === "gps") {
      return TEXT.gpsSource;
    }
    return TEXT.empty;
  }

  function formatAdministrativeLocation(location) {
    // รวมตำบล อำเภอ จังหวัด ให้สั้นและอ่านง่ายบน card
    const tambon = formatters.formatValue(location?.tambon);
    const amphoe = formatters.formatValue(location?.amphoe);
    const province = formatters.formatValue(location?.province);
    const parts = [];

    if (tambon !== TEXT.empty) {
      parts.push(tambon);
    }
    if (amphoe !== TEXT.empty) {
      parts.push(amphoe);
    }
    if (province !== TEXT.empty) {
      parts.push(province);
    }

    return parts.length ? parts.join(" ") : TEXT.empty;
  }

  function createPanel(id, className, titleText) {
    const panel = createElement("aside", className);
    panel.id = id;
    panel.setAttribute("aria-live", "polite");

    const header = createElement("div", "panel-header");
    header.appendChild(createElement("h2", null, titleText));

    const content = createElement("div", "panel-content");
    content.id = `${id}-content`;

    panel.append(header, content);
    document.body.appendChild(panel);
    return panel;
  }

  function ensureLocationPanel() {
    // สร้างแผงตำแหน่งครั้งเดียว แล้วอัปเดตค่าเดิมเมื่อผู้ใช้เปลี่ยนพิกัด
    let panel = document.getElementById("location-panel");
    if (panel) {
      return panel;
    }

    panel = createPanel("location-panel", "location-panel is-open", TEXT.locationTitle);
    const content = panel.querySelector("#location-panel-content");
    const status = createElement("p", "location-status", TEXT.noSelection);
    status.id = "location-status";
    const instruction = createElement("p", "location-instruction", TEXT.instruction);
    instruction.id = "location-instruction";
    const list = createElement("dl", "location-list");
    list.id = "location-values";
    updateLocationList(list, null);
    const actions = createElement("div", "location-actions");
    const locateButton = createElement("button", "panel-button secondary", TEXT.locate);
    locateButton.type = "button";
    locateButton.id = "locate-button";
    const confirmButton = createElement("button", "panel-button primary", TEXT.confirm);
    confirmButton.type = "button";
    confirmButton.id = "confirm-location-button";
    confirmButton.disabled = true;

    actions.append(locateButton, confirmButton);
    content.append(status, instruction, list, actions);
    return panel;
  }

  function updateLocationList(list, location) {
    // แสดงพิกัดและแหล่งที่มาของตำแหน่งที่เลือก
    list.replaceChildren();
    appendField(list, "Latitude", location?.lat, formatters.formatCoordinate);
    appendField(list, "Longitude", location?.lng, formatters.formatCoordinate);
    appendField(list, "แหล่งที่มา", location?.source, formatSource);
    appendField(list, "ความแม่นยำ GPS", location?.accuracy, formatters.formatAccuracy);
  }

  function updateLocationValues(location) {
    const values = document.getElementById("location-values");
    if (values) {
      updateLocationList(values, location);
    }
  }

  function setLocationStatus(message, instruction) {
    ensureLocationPanel();
    document.getElementById("location-status").textContent = message;
    document.getElementById("location-instruction").textContent = instruction || TEXT.instruction;
  }

  function setConfirmEnabled(isEnabled) {
    ensureLocationPanel();
    document.getElementById("confirm-location-button").disabled = !isEnabled;
  }

  function setupLocationPanel({ onLocate, onConfirm }) {
    const panel = ensureLocationPanel();
    panel.querySelector("#locate-button").addEventListener("click", onLocate);
    panel.querySelector("#confirm-location-button").addEventListener("click", onConfirm);
    return panel;
  }

  function showGpsLoading() {
    setLocationStatus(TEXT.gpsLoading);
  }

  function showGpsReady(location) {
    updateLocationValues(location);
    setLocationStatus(TEXT.gpsReady);
    setConfirmEnabled(true);
  }

  function showMapSelectionReady(location) {
    updateLocationValues(location);
    setLocationStatus(TEXT.mapReady);
    setConfirmEnabled(true);
  }

  function showDragSelectionReady(location) {
    updateLocationValues(location);
    setLocationStatus(TEXT.dragReady);
    setConfirmEnabled(true);
  }

  function showLocationMessage(message) {
    setLocationStatus(message);
  }

  function getGeolocationErrorMessage(error) {
    if (!window.isSecureContext) {
      return TEXT.secureContext;
    }
    if (!error) {
      return TEXT.positionUnavailable;
    }
    if (error.code === error.PERMISSION_DENIED) {
      return TEXT.permissionDenied;
    }
    if (error.code === error.POSITION_UNAVAILABLE) {
      return TEXT.positionUnavailable;
    }
    if (error.code === error.TIMEOUT) {
      return TEXT.timeout;
    }
    return TEXT.positionUnavailable;
  }

  function ensureResultPanel() {
    let panel = document.getElementById("result-panel");
    if (panel) {
      return panel;
    }

    panel = createPanel("result-panel", "result-panel", "ผลการตรวจสอบพื้นที่");
    const header = panel.querySelector(".panel-header");
    const closeButton = createElement("button", "panel-close", "ปิด");
    closeButton.type = "button";
    closeButton.addEventListener("click", () => panel.classList.remove("is-open"));
    header.appendChild(closeButton);
    return panel;
  }

  function setResultPanelState(messages) {
    const panel = ensureResultPanel();
    const content = panel.querySelector("#result-panel-content");
    const messageList = Array.isArray(messages) ? messages : [messages];
    content.replaceChildren();
    messageList.forEach((message) => {
      content.appendChild(createElement("p", "result-message", message));
    });
    panel.classList.add("is-open");
  }

  function showAnalysisLoading() {
    setResultPanelState(TEXT.apiLoading);
  }

  function showApiError() {
    setResultPanelState(TEXT.apiError);
  }

  function showNoDataResult() {
    setResultPanelState([TEXT.noGisData, TEXT.phayaoCoverage]);
  }

  function getRiceLandSuitabilityDisplay(data) {
    const riceLandSuitability = data.riceLandSuitability || {};
    const landClass = riceLandSuitability.class;
    const label = landClass && suitabilityLabels[landClass]
      ? suitabilityLabels[landClass]
      : formatters.formatValue(riceLandSuitability.label);
    const className = landClass && suitabilityClasses[landClass]
      ? suitabilityClasses[landClass]
      : suitabilityClasses.NO_COVERAGE;

    return {
      grade: landClass || "ไม่มีข้อมูล",
      label: landClass ? `${landClass} — ${label}` : label,
      className,
    };
  }

  function renderResultPanel(data) {
    // ฝั่งสรุปผล: card ความเหมาะสมปลูกข้าว, ข้อมูลตำแหน่ง, ชุดดิน, และข้อมูลน้ำ
    const panel = ensureResultPanel();
    const content = panel.querySelector("#result-panel-content");
    const payload = data || {};
    const location = payload.location || {};
    const soil = payload.soil || {};
    const water = payload.water || {};
    const nearestStream = water.nearestStream || {};
    const nearestIrrigationCanal = water.nearestIrrigationCanal || {};
    const clickedPoint = payload.clickedPoint || {};

    content.replaceChildren();

    if (!payload || payload.found === false) {
      if (payload && payload.found === false) {
        content.appendChild(createElement("p", "result-message", TEXT.noGisData));
        content.appendChild(createElement("p", "result-message", TEXT.phayaoCoverage));
      } else {
        content.appendChild(createElement("p", "result-message", TEXT.notEvaluated));
      }
      panel.classList.add("is-open");
      return;
    }

    content.appendChild(renderSuitabilitySummaryCard(payload));

    appendSection(content, "ข้อมูลตำแหน่ง", [
      { label: "จังหวัด", value: location.province },
      { label: "อำเภอ", value: location.amphoe },
      { label: "ตำบล", value: location.tambon },
      { label: "ลุ่มน้ำหลัก", value: location.basin },
      { label: "ลุ่มน้ำย่อย", value: location.subBasin },
      { label: "Latitude", value: clickedPoint.latitude, formatter: formatters.formatCoordinate },
      { label: "Longitude", value: clickedPoint.longitude, formatter: formatters.formatCoordinate },
    ]);

    appendSection(content, "ข้อมูลชุดดิน", [
      { label: "รหัสชุดดิน", value: soil.seriesNo },
      { label: "ชื่อชุดดิน", value: soil.soilNameThai },
      { label: "การระบายน้ำ", value: soil.drainageDescriptionThai, formatter: formatters.formatDrainage },
      { label: "ความลึกของดิน", value: soil.depthDescriptionThai, formatter: formatters.formatSoilDepth },
      { label: "เนื้อดินชั้นบน", value: soil.surfaceTextureThai },
      { label: "ข้อมูลที่ยังขาด", value: soil.missingFields, formatter: formatters.formatMissingFields },
      { label: "สถานะข้อมูล", value: soil.dataStatus, formatter: formatters.formatStatus },
    ]);

    appendSection(content, "ข้อมูลลุ่มน้ำ", [
      { label: "ลำน้ำใกล้ที่สุด", value: nearestStream.streamName },
      { label: "ประเภทลำน้ำ", value: nearestStream.streamType },
      { label: "ระยะห่างจากลำน้ำ", value: nearestStream.distanceM, formatter: formatters.formatDistance },
      { label: "คลองชลประทานใกล้ที่สุด", value: nearestIrrigationCanal.canalName },
      { label: "ระยะห่างจากคลอง", value: nearestIrrigationCanal.distanceM, formatter: formatters.formatDistance },
    ]);

    panel.classList.add("is-open");
  }

  function renderSuitabilitySummaryCard(data) {
    // Card บนสุดใช้สรุป class จากชั้นข้อมูล Potential ของกรมพัฒนาที่ดิน
    const card = createElement("article", "suitability-summary-card");
    const display = getRiceLandSuitabilityDisplay(data);
    const header = createElement("header", `suitability-card-header ${display.className}`);
    const body = createElement("section", "suitability-card-body");
    const footer = createElement("footer", "suitability-card-footer");
    const riceLandSuitability = data.riceLandSuitability || {};

    header.append(
      createElement("div", "suitability-grade", display.grade),
      createElement("div", "suitability-label", display.label),
    );

    appendSummaryGroup(body, TEXT.riceSuitabilityTitle, [
      { label: "ความเหมาะสมปลูกข้าว", value: display.label },
      { label: "วิธีประเมิน", value: riceLandSuitability.evaluationMethod },
      { label: "แหล่งข้อมูล", value: riceLandSuitability.sourceName },
      { label: "ชุดข้อมูล", value: riceLandSuitability.sourceDataset },
      { label: "สถานะรวม", value: TEXT.incompleteEvaluation },
    ]);

    footer.append(createElement("span", "suitability-status-pill", TEXT.incompleteEvaluation));

    card.append(header, body, footer);
    return card;
  }

  function createPopupContent(data) {
    // Popup บนแผนที่สรุปผลสั้น ๆ ส่วนรายละเอียดเต็มอยู่ใน result panel
    const container = createElement("div", "map-popup");
    const title = createElement("h3", null, "ข้อมูลตำแหน่ง");
    const location = data.location || {};
    const soil = data.soil || {};
    const riceLandSuitability = data.riceLandSuitability || {};
    const list = createElement("dl", "popup-list");

    appendField(list, "ตำบล", location.tambon);
    appendField(list, "อำเภอ", location.amphoe);
    appendField(list, "ชุดดิน", soil.soilNameThai);
    appendField(
      list,
      "ความเหมาะสมปลูกข้าว",
      riceLandSuitability.class && suitabilityLabels[riceLandSuitability.class]
        ? `${riceLandSuitability.class} — ${suitabilityLabels[riceLandSuitability.class]}`
        : riceLandSuitability.label,
    );

    container.append(title, list);
    return container;
  }

  window.MapUi = {
    addLayerControl,
    setupLocationPanel,
    setConfirmEnabled,
    showGpsLoading,
    showGpsReady,
    showMapSelectionReady,
    showDragSelectionReady,
    showLocationMessage,
    getGeolocationErrorMessage,
    showAnalysisLoading,
    showApiError,
    showNoDataResult,
    renderResultPanel,
    createPopupContent,
    text: TEXT,
  };
})(window);
