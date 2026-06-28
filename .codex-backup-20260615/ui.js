(function (window) {
  const formatters = window.MapFormatters;
  const TEXT = {
    empty: formatters.EMPTY_TEXT,
    notEvaluated: formatters.NOT_EVALUATED_TEXT,
    parcelTitle: "ข้อมูลแปลงเกษตร",
    drawParcel: "วาดแปลงเกษตร",
    saveParcel: "บันทึกแปลง",
    cancel: "ยกเลิก",
    deleteDraft: "ลบขอบเขตที่วาด",
    locationTitle: "ตำแหน่งที่เลือก",
    instruction: "คลิกบนแผนที่ ลากหมุด หรือใช้ตำแหน่งปัจจุบัน",
    noSelection: "ยังไม่ได้เลือกตำแหน่ง",
    mapReady: "เลือกตำแหน่งแล้ว กรุณาตรวจสอบหมุดและกดยืนยันตำแหน่ง",
    dragReady: "อัปเดตตำแหน่งแล้ว กรุณาตรวจสอบและกดยืนยันตำแหน่ง",
    locate: "หาตำแหน่งปัจจุบัน",
    confirm: "ยืนยันตำแหน่ง",
    gpsLoading: "กำลังค้นหาตำแหน่งปัจจุบัน...",
    gpsReady: "พบตำแหน่งปัจจุบันแล้ว กรุณาตรวจสอบหมุดและกดยืนยันตำแหน่ง",
    apiLoading: "กำลังตรวจสอบข้อมูลพื้นที่...",
    unsupported:
      "อุปกรณ์หรือเบราว์เซอร์นี้ไม่รองรับการระบุตำแหน่ง กรุณาเลือกตำแหน่งจากแผนที่",
    permissionDenied:
      "ไม่สามารถเข้าถึงตำแหน่งได้ กรุณาอนุญาตการใช้ตำแหน่ง หรือลองเลือกตำแหน่งจากแผนที่",
    positionUnavailable:
      "ไม่พบตำแหน่งปัจจุบัน กรุณาลองใหม่หรือเลือกตำแหน่งจากแผนที่",
    timeout: "ใช้เวลาค้นหาตำแหน่งนานเกินไป กรุณาลองใหม่",
    secureContext:
      "เบราว์เซอร์ไม่อนุญาตให้เข้าถึงตำแหน่ง กรุณาใช้งานผ่าน HTTPS หรือ localhost",
    apiError: "ไม่สามารถโหลดข้อมูลพื้นที่ได้ กรุณาลองใหม่",
    noGisData: "ไม่พบข้อมูล GIS สำหรับตำแหน่งนี้",
    phayaoCoverage: "ข้อมูลปัจจุบันครอบคลุมเฉพาะพื้นที่จังหวัดพะเยา",
    mapSource: "เลือกจากแผนที่",
    dragSource: "ลากหมุด",
    gpsSource: "ตำแหน่งปัจจุบัน",
    parcelDraftReady: "วาดขอบเขตแปลงบนแผนที่",
    parcelDraftSaved: "บันทึกแปลงเรียบร้อยแล้ว",
    parcelDraftCancelled: "ยกเลิกการวาดแปลงแล้ว",
    parcelDraftMissing: "กรุณาวาดขอบเขตแปลงก่อน",
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
  };

  function addLayerControl(map, baseLayers, overlayLayers) {
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

    const layerControl = L.control
      .layers(layerControlBaseLayers, layerControlOverlayLayers, {
        position: "topleft",
        collapsed: true,
      })
      .addTo(map);

    return layerControl;
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
    const labelElement = createElement("dt", "result-label", label);
    const valueElement = createElement(
      "dd",
      "result-value",
      formatter ? formatter(value) : formatters.formatValue(value),
    );

    row.append(labelElement, valueElement);
    parent.appendChild(row);
  }

  function appendSection(parent, title, fields) {
    const section = createElement("section", "result-section");
    const heading = createElement("h3", null, title);
    const list = createElement("dl", "result-list");

    fields.forEach((field) => appendField(list, field.label, field.value, field.formatter));
    section.append(heading, list);
    parent.appendChild(section);
  }

  function createSummaryRow(label, value, formatter) {
    const row = createElement("div", "summary-card-row");
    const labelElement = createElement("dt", "summary-card-label", label);
    const valueElement = createElement(
      "dd",
      "summary-card-value",
      formatter ? formatter(value) : formatters.formatValue(value),
    );

    row.append(labelElement, valueElement);
    return row;
  }

  function appendSummaryGroup(parent, title, rows) {
    const group = createElement("section", "summary-card-group");
    const heading = createElement("h4", null, title);
    const list = createElement("dl", "summary-card-list");

    rows.forEach((row) => {
      list.appendChild(createSummaryRow(row.label, row.value, row.formatter));
    });

    group.append(heading, list);
    parent.appendChild(group);
  }

  function removeThaiPrefix(value, prefix) {
    const text = formatters.formatValue(value);

    if (text === formatters.EMPTY_TEXT) {
      return text;
    }

    return text.replace(new RegExp(`^${prefix}\\s*`, "u"), "");
  }

  function formatAdministrativeLocation(location) {
    const tambon = removeThaiPrefix(location?.tambon, "ตำบล");
    const amphoe = removeThaiPrefix(location?.amphoe, "อำเภอ");
    const province = removeThaiPrefix(location?.province, "จังหวัด");
    const parts = [];

    if (tambon !== formatters.EMPTY_TEXT) {
      parts.push(`ตำบล${tambon}`);
    }

    if (amphoe !== formatters.EMPTY_TEXT) {
      parts.push(`อำเภอ${amphoe}`);
    }

    if (province !== formatters.EMPTY_TEXT) {
      parts.push(`จังหวัด${province}`);
    }

    return parts.length ? parts.join(" ") : formatters.EMPTY_TEXT;
  }

  function formatParcelArea(areaRai, areaSqm) {
    return formatters.formatAreaDetail(areaRai, areaSqm);
  }

  function renderParcelSummaryCard(parcel) {
    const card = createElement("article", "parcel-summary-card");
    const header = createElement("header", "parcel-summary-header");
    const title = createElement("div", "parcel-summary-title", TEXT.parcelTitle);
    const subtitle = createElement(
      "div",
      "parcel-summary-subtitle",
      parcel?.parcelCode || TEXT.empty,
    );
    const body = createElement("section", "parcel-summary-body");
    const footer = createElement("footer", "parcel-summary-footer");
    const areaText = formatParcelArea(parcel?.areaRai, parcel?.areaSqm);

    header.append(title, subtitle);

    appendSummaryGroup(body, "ข้อมูลแปลง", [
      { label: "รหัสแปลง", value: parcel?.parcelCode },
      { label: "ชื่อแปลง", value: parcel?.parcelName },
      { label: "พื้นที่", value: areaText },
      { label: "ชนิดพืช", value: parcel?.cropType },
      { label: "พันธุ์ข้าว", value: parcel?.riceVariety },
      {
        label: "วันที่ปลูก",
        value: parcel?.plantingDate,
        formatter: formatters.formatThaiDate,
      },
    ]);

    footer.appendChild(
      createElement("span", "suitability-status-pill", "ผลความเหมาะสมรวม: ยังไม่ได้ประเมิน"),
    );

    card.append(header, body, footer);
    return card;
  }

  function renderParcelDraftForm({ approxAreaSqm, approxAreaRai, onSave, onCancel, onDelete }) {
    const card = createElement("article", "parcel-draft-card");
    const header = createElement("header", "parcel-draft-header");
    const title = createElement("h3", null, TEXT.parcelTitle);
    const subtitle = createElement("p", "summary-card-message", TEXT.parcelDraftReady);
    const form = createElement("form", "parcel-draft-form");
    const message = createElement("p", "parcel-form-message", "");
    message.id = "parcel-form-message";
    const area = createElement(
      "p",
      "parcel-area-preview",
      `พื้นที่โดยประมาณ: ${formatParcelArea(approxAreaRai, approxAreaSqm)}`,
    );

    const nameLabel = createElement("label", "parcel-field");
    nameLabel.append(
      createElement("span", "parcel-field-label", "ชื่อแปลง"),
    );
    const nameInput = createElement("input", "parcel-input");
    nameInput.type = "text";
    nameInput.name = "parcelName";
    nameInput.maxLength = 150;
    nameInput.placeholder = "เช่น แปลงนาทดลอง";
    nameLabel.appendChild(nameInput);

    const cropLabel = createElement("label", "parcel-field");
    cropLabel.append(
      createElement("span", "parcel-field-label", "ชนิดพืช"),
    );
    const cropInput = createElement("input", "parcel-input");
    cropInput.type = "text";
    cropInput.name = "cropType";
    cropInput.required = true;
    cropInput.value = "ข้าว";
    cropInput.maxLength = 100;
    cropLabel.appendChild(cropInput);

    const varietyLabel = createElement("label", "parcel-field");
    varietyLabel.append(
      createElement("span", "parcel-field-label", "พันธุ์ข้าว"),
    );
    const varietyInput = createElement("input", "parcel-input");
    varietyInput.type = "text";
    varietyInput.name = "riceVariety";
    varietyInput.maxLength = 150;
    varietyInput.placeholder = "เช่น กข6";
    varietyLabel.appendChild(varietyInput);

    const dateLabel = createElement("label", "parcel-field");
    dateLabel.append(
      createElement("span", "parcel-field-label", "วันที่ปลูก"),
    );
    const dateInput = createElement("input", "parcel-input");
    dateInput.type = "date";
    dateInput.name = "plantingDate";
    dateLabel.appendChild(dateInput);

    const actions = createElement("div", "parcel-form-actions");
    const deleteButton = createElement("button", "panel-button secondary", TEXT.deleteDraft);
    deleteButton.type = "button";
    deleteButton.addEventListener("click", () => {
      if (typeof onDelete === "function") {
        onDelete();
      }
    });

    const cancelButton = createElement("button", "panel-button secondary", TEXT.cancel);
    cancelButton.type = "button";
    cancelButton.addEventListener("click", () => {
      if (typeof onCancel === "function") {
        onCancel();
      }
    });

    const saveButton = createElement("button", "panel-button primary", TEXT.saveParcel);
    saveButton.type = "submit";

    actions.append(deleteButton, cancelButton, saveButton);

    form.append(message, area, nameLabel, cropLabel, varietyLabel, dateLabel, actions);
    form.addEventListener("submit", (event) => {
      event.preventDefault();

      if (typeof onSave === "function") {
        onSave({
          parcelName: nameInput.value,
          cropType: cropInput.value,
          riceVariety: varietyInput.value,
          plantingDate: dateInput.value,
          setMessage(text) {
            message.textContent = text || TEXT.empty;
          },
          setBusy(isBusy) {
            saveButton.disabled = Boolean(isBusy);
            cancelButton.disabled = Boolean(isBusy);
            deleteButton.disabled = Boolean(isBusy);
          },
        });
      }
    });

    header.append(title, subtitle);
    card.append(header, form);
    return card;
  }

  function showParcelDraftForm(config) {
    const panel = ensureResultPanel();
    const content = panel.querySelector("#result-panel-content");
    content.replaceChildren(renderParcelDraftForm(config));
    panel.classList.add("is-open");
    return panel;
  }

  function getSoilSuitabilityDisplay(data) {
    const soilSuitability = data.soilSuitability || {};
    const soilClass = soilSuitability.class;

    if (soilClass && suitabilityLabels[soilClass]) {
      return {
        grade: soilClass,
        label: soilSuitability.label || suitabilityLabels[soilClass],
        detail: "ผลความเหมาะสมด้านดินเท่านั้น",
        className: suitabilityClasses[soilClass] || "status-not-evaluated",
      };
    }

    return {
      grade: "ด้านดิน",
      label: soilSuitability.label || "ยังไม่มีเกณฑ์ประเมินสำหรับชุดดินนี้",
      detail: TEXT.notEvaluated,
      className: "status-not-evaluated",
    };
  }

  function formatRiceType(value) {
    if (value === "NON_GLUTINOUS") {
      return "ข้าวเจ้า";
    }

    if (value === "GLUTINOUS") {
      return "ข้าวเหนียว";
    }

    return formatters.formatValue(value);
  }

  function formatWaterRegime(value) {
    const labels = {
      RAINFED: "อาศัยน้ำฝน",
      IRRIGATED: "นาชลประทาน",
      ADEQUATE_WATER: "มีน้ำเพียงพอ",
      UNKNOWN: "ยังไม่ทราบเงื่อนไขน้ำ",
    };

    return labels[value] || formatters.formatValue(value);
  }

  function appendRecommendationMessage(parent, data) {
    const soilClass = data.soilSuitability?.class;
    const ruleStatus = data.soilSuitability?.ruleStatus;
    let message =
      "ยังไม่สามารถแนะนำพันธุ์ข้าวได้ ต้องมีผลความเหมาะสมด้านดินและข้อมูลสภาพน้ำที่เพียงพอก่อน";

    if (soilClass === "N") {
      message = "ไม่แนะนำพันธุ์ข้าวสำหรับพื้นที่นี้ เนื่องจากข้อจำกัดด้านดิน";
    } else if (ruleStatus === "NO_DATA") {
      message = "ยังไม่สามารถแนะนำพันธุ์ข้าวได้ ต้องมีข้อมูลดินที่เพียงพอก่อน";
    }

    parent.appendChild(createElement("p", "summary-card-message", message));
  }

  function appendRiceVarietyRecommendations(parent, data) {
    const varieties = data.recommendedRiceVarieties || [];

    if (!varieties.length) {
      appendRecommendationMessage(parent, data);
      return;
    }

    varieties.forEach((variety) => {
      appendSummaryGroup(parent, "พันธุ์ข้าวที่ควรพิจารณา", [
        { label: "พันธุ์ข้าว", value: variety.varietyNameThai },
        { label: "ประเภทข้าว", value: variety.riceType, formatter: formatRiceType },
        {
          label: "เงื่อนไขน้ำ",
          value: variety.waterRegime,
          formatter: formatWaterRegime,
        },
        { label: "เหตุผล", value: variety.recommendation },
        { label: "ข้อควรระวัง", value: variety.caution },
        { label: "แหล่งข้อมูล", value: variety.sourceName },
      ]);
    });
  }

  function appendEvaluatedFactors(parent, factors) {
    const evaluatedFactors = Array.isArray(factors) ? factors : [];

    if (!evaluatedFactors.length) {
      return;
    }

    evaluatedFactors.forEach((factor) => {
      appendSummaryGroup(parent, "ปัจจัยที่ประเมินแล้ว", [
        { label: "ปัจจัย", value: factor.factorLabel },
        { label: "ค่าที่ใช้", value: factor.inputValue },
        {
          label: "ผล",
          value: factor.class && suitabilityLabels[factor.class]
            ? `${factor.class} — ${suitabilityLabels[factor.class]}`
            : factor.class,
        },
        { label: "ข้อจำกัด", value: factor.limitation },
      ]);
    });
  }

  function renderSuitabilitySummaryCard(data) {
    const card = createElement("article", "suitability-summary-card");
    const suitabilityDisplay = getSoilSuitabilityDisplay(data);
    const header = createElement(
      "header",
      `suitability-card-header ${suitabilityDisplay.className}`,
    );
    const grade = createElement("div", "suitability-grade", suitabilityDisplay.grade);
    const label = createElement("div", "suitability-label", suitabilityDisplay.label);
    const body = createElement("section", "suitability-card-body");
    const footer = createElement("footer", "suitability-card-footer");
    const soil = data.soil || null;
    const soilSuitability = data.soilSuitability || {};
    const water = data.water || {};
    const nearestStream = water.nearestStream || {};
    const nearestIrrigationCanal = water.nearestIrrigationCanal || {};
    const clickedPoint = data.clickedPoint || {};
    const hasPointSummary = Boolean(
      data.clickedPoint ||
        data.location?.province ||
        data.location?.amphoe ||
        data.location?.tambon ||
        data.location?.basin ||
        data.location?.subBasin ||
        data.soil ||
        data.water?.nearestStream ||
        data.water?.nearestIrrigationCanal,
    );
    const coordinateText = `${formatters.formatCoordinate(
      clickedPoint.latitude,
    )}, ${formatters.formatCoordinate(clickedPoint.longitude)}`;

    header.append(grade, label);

    appendSummaryGroup(body, "ผลความเหมาะสมด้านดินสำหรับปลูกข้าว", [
      {
        label: "ผลด้านดิน",
        value: soilSuitability.class && suitabilityLabels[soilSuitability.class]
          ? `${soilSuitability.class} — ${soilSuitability.label}`
          : soilSuitability.label,
      },
      { label: "ข้อจำกัดสำคัญ", value: soilSuitability.limitation },
      { label: "คำแนะนำ", value: soilSuitability.recommendation },
      {
        label: "สถานะเกณฑ์",
        value: soilSuitability.status || soilSuitability.ruleStatus,
        formatter: formatters.formatRuleStatus,
      },
      { label: "ข้อมูลที่ยังขาด", value: soilSuitability.missingFields, formatter: formatters.formatMissingFields },
      { label: "แหล่งเกณฑ์", value: soilSuitability.sourceName },
      { label: "เอกสารอ้างอิง", value: soilSuitability.sourceReference },
      { label: "เวอร์ชันเกณฑ์", value: soilSuitability.ruleVersion },
    ]);

    appendEvaluatedFactors(body, soilSuitability.evaluatedFactors);

    if (hasPointSummary) {
      appendSummaryGroup(
        body,
        "พื้นที่",
        [
          {
            label: "ตำแหน่ง",
            value: formatAdministrativeLocation(data.location || {}),
          },
          { label: "ลุ่มน้ำหลัก", value: data.location?.basin },
          { label: "ลุ่มน้ำย่อย", value: data.location?.subBasin },
        ],
      );

      if (soil) {
        appendSummaryGroup(body, "ข้อมูลชุดดิน", [
          { label: "ชื่อชุดดิน", value: soil.soilNameThai },
          { label: "สัญลักษณ์ชุดดิน", value: soil.soilSymbol },
          { label: "รหัสชุดดิน", value: soil.seriesNo },
          {
            label: "การระบายน้ำ",
            value: soil.drainageDescriptionThai,
            formatter: formatters.formatDrainage,
          },
          {
            label: "ความลึกของดิน",
            value: soil.depthDescriptionThai,
            formatter: formatters.formatSoilDepth,
          },
          { label: "เนื้อดินชั้นบน", value: soil.surfaceTextureThai },
          { label: "ข้อมูลที่ยังขาด", value: soil.missingFields, formatter: formatters.formatMissingFields },
          { label: "สถานะข้อมูล", value: soil.dataStatus, formatter: formatters.formatStatus },
          { label: "ข้อจำกัดสำคัญ", value: soilSuitability.limitation },
        ]);
      } else {
        const soilMessage = createElement(
          "p",
          "summary-card-message",
          "ไม่พบข้อมูลชุดดินสำหรับตำแหน่งนี้",
        );
        body.appendChild(soilMessage);
      }

      appendSummaryGroup(body, "แหล่งน้ำ", [
        { label: "ลำน้ำใกล้ที่สุด", value: nearestStream.streamName },
        {
          label: "ระยะจากลำน้ำ",
          value: nearestStream.distanceM,
          formatter: formatters.formatDistance,
        },
        {
          label: "คลองชลประทานใกล้ที่สุด",
          value: nearestIrrigationCanal.canalName,
        },
        {
          label: "ระยะจากคลอง",
          value: nearestIrrigationCanal.distanceM,
          formatter: formatters.formatDistance,
        },
      ]);
    }

    appendRiceVarietyRecommendations(body, data);

    footer.append(createElement("span", "suitability-status-pill", suitabilityDisplay.detail));

    if (hasPointSummary) {
      footer.append(createElement("span", "summary-coordinate", `พิกัด ${coordinateText}`));
    }

    card.append(header, body, footer);
    return card;
  }

  function createPanel(id, className, titleText) {
    const panel = createElement("aside", className);
    panel.id = id;
    panel.setAttribute("aria-live", "polite");

    const header = createElement("div", "panel-header");
    const title = createElement("h2", null, titleText);
    header.appendChild(title);

    const content = createElement("div", "panel-content");
    content.id = `${id}-content`;

    panel.append(header, content);
    document.body.appendChild(panel);

    return panel;
  }

  function ensureLocationPanel() {
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

    const drawParcelButton = createElement("button", "panel-button secondary", TEXT.drawParcel);
    drawParcelButton.type = "button";
    drawParcelButton.id = "draw-parcel-button";

    const confirmButton = createElement("button", "panel-button primary", TEXT.confirm);
    confirmButton.type = "button";
    confirmButton.id = "confirm-location-button";
    confirmButton.disabled = true;

    actions.append(locateButton, drawParcelButton, confirmButton);
    content.append(status, instruction, list, actions);

    return panel;
  }

  function updateLocationList(list, location) {
    list.replaceChildren();
    appendField(list, "Latitude", location?.lat, formatters.formatCoordinate);
    appendField(list, "Longitude", location?.lng, formatters.formatCoordinate);
    appendField(list, "แหล่งที่มาของตำแหน่ง", location?.source, formatSource);
    appendField(list, "ความแม่นยำ GPS", location?.accuracy, formatters.formatAccuracy);
  }

  function updateLocationValues(location) {
    const values = document.getElementById("location-values");

    if (!values) {
      return;
    }

    updateLocationList(values, location);
  }

  function setLocationStatus(message, instruction) {
    ensureLocationPanel();
    document.getElementById("location-status").textContent = message;
    document.getElementById("location-instruction").textContent =
      instruction || TEXT.instruction;
  }

  function setConfirmEnabled(isEnabled) {
    ensureLocationPanel();
    document.getElementById("confirm-location-button").disabled = !isEnabled;
  }

  function setupLocationPanel({ onLocate, onConfirm, onDrawParcel }) {
    const panel = ensureLocationPanel();
    panel.querySelector("#locate-button").addEventListener("click", onLocate);
    panel.querySelector("#draw-parcel-button").addEventListener("click", onDrawParcel);
    panel
      .querySelector("#confirm-location-button")
      .addEventListener("click", onConfirm);
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

  function renderResultPanel(data, selectedParcel) {
    const panel = ensureResultPanel();
    const content = panel.querySelector("#result-panel-content");
    const payload = data || {};
    const location = payload.location || {};
    const soil = payload.soil || {};
    const water = payload.water || {};
    const nearestStream = water.nearestStream || {};
    const nearestIrrigationCanal = water.nearestIrrigationCanal || {};
    const clickedPoint = payload.clickedPoint || {};
    const pointSectionTitle = selectedParcel
      ? "ข้อมูลจากตำแหน่งที่ยืนยัน"
      : "ข้อมูลตำแหน่ง";

    content.replaceChildren();

    if (selectedParcel) {
      content.appendChild(renderParcelSummaryCard(selectedParcel));
    }

    if (!payload || payload.found === false) {
      if (payload && payload.found === false) {
        content.appendChild(createElement("p", "result-message", TEXT.noGisData));
        content.appendChild(createElement("p", "result-message", TEXT.phayaoCoverage));
      } else if (!selectedParcel) {
        content.appendChild(createElement("p", "result-message", TEXT.notEvaluated));
      }
      panel.classList.add("is-open");
      return;
    }

    content.appendChild(renderSuitabilitySummaryCard(data));

    appendSection(content, pointSectionTitle, [
      { label: "จังหวัด", value: location.province },
      { label: "อำเภอ", value: location.amphoe },
      { label: "ตำบล", value: location.tambon },
      { label: "ลุ่มน้ำหลัก", value: location.basin },
      { label: "ลุ่มน้ำย่อย", value: location.subBasin },
      { label: "Latitude", value: clickedPoint.latitude, formatter: formatters.formatCoordinate },
      { label: "Longitude", value: clickedPoint.longitude, formatter: formatters.formatCoordinate },
    ]);

    appendSection(content, "ข้อมูลดิน", [
      { label: "รหัสชุดดิน", value: soil.seriesNo },
      { label: "ชื่อชุดดิน", value: soil.soilNameThai },
      {
        label: "การระบายน้ำ",
        value: soil.drainageDescriptionThai,
        formatter: formatters.formatDrainage,
      },
      {
        label: "ความลึกของดิน",
        value: soil.depthDescriptionThai,
        formatter: formatters.formatSoilDepth,
      },
      { label: "เนื้อดินชั้นบน", value: soil.surfaceTextureThai },
      { label: "จำนวนชั้นดินที่พบ", value: soil.horizonCount },
      {
        label: "ความลึกโปรไฟล์ดิน",
        value: soil.profileMaxDepthCm,
        formatter: formatters.formatCentimeters,
      },
      { label: "ข้อมูลที่ยังขาด", value: soil.missingFields, formatter: formatters.formatMissingFields },
      { label: "สถานะข้อมูล", value: soil.dataStatus, formatter: formatters.formatStatus },
    ]);

    appendSection(content, "ข้อมูลน้ำ", [
      { label: "ลำน้ำใกล้ที่สุด", value: nearestStream.streamName },
      { label: "ประเภทลำน้ำ", value: nearestStream.streamType },
      {
        label: "ระยะห่างจากลำน้ำ",
        value: nearestStream.distanceM,
        formatter: formatters.formatDistance,
      },
      {
        label: "คลองชลประทานใกล้ที่สุด",
        value: nearestIrrigationCanal.canalName,
      },
      {
        label: "ระยะห่างจากคลอง",
        value: nearestIrrigationCanal.distanceM,
        formatter: formatters.formatDistance,
      },
    ]);

    appendSection(content, "ความเหมาะสม", [
      {
        label: "ผลความเหมาะสมด้านดิน",
        value: data.soilSuitability?.class && suitabilityLabels[data.soilSuitability.class]
          ? `${data.soilSuitability.class} — ${data.soilSuitability.label}`
          : data.soilSuitability?.label,
      },
      {
        label: "สถานะเกณฑ์",
        value: data.soilSuitability?.status || data.soilSuitability?.ruleStatus,
        formatter: formatters.formatRuleStatus,
      },
      { label: "ข้อจำกัดสำคัญ", value: data.soilSuitability?.mainLimitation },
      { label: "แหล่งเกณฑ์", value: data.soilSuitability?.sourceName },
      { label: "เวอร์ชันเกณฑ์", value: data.soilSuitability?.ruleVersion },
      { label: "ผลความเหมาะสมรวม", value: TEXT.notEvaluated },
    ]);

    panel.classList.add("is-open");
  }

  function createPopupContent(data) {
    const container = createElement("div", "map-popup");
    const title = createElement("h3", null, "ข้อมูลตำแหน่ง");
    const location = data.location || {};
    const soil = data.soil || {};
    const soilSuitability = data.soilSuitability || {};
    const riceVarieties = data.recommendedRiceVarieties || [];
    const list = createElement("dl", "popup-list");

    appendField(list, "ตำบล", location.tambon);
    appendField(list, "อำเภอ", location.amphoe);
    appendField(list, "ชุดดิน", soil.soilNameThai);
    appendField(
      list,
      "ความเหมาะสมด้านดิน",
      soilSuitability.class && suitabilityLabels[soilSuitability.class]
        ? `${soilSuitability.class} — ${soilSuitability.label}`
        : soilSuitability.label,
    );
    appendField(
      list,
      "พันธุ์ข้าว",
      riceVarieties.length ? "มีพันธุ์ที่ควรพิจารณา" : "ยังไม่แนะนำ",
    );
    container.append(title, list);

    return container;
  }

  function createParcelPopupContent(parcel) {
    const container = createElement("div", "map-popup");
    const title = createElement("h3", null, "ข้อมูลแปลง");
    const list = createElement("dl", "popup-list");

    appendField(list, "รหัสแปลง", parcel?.parcelCode);
    appendField(list, "ชื่อแปลง", parcel?.parcelName);
    appendField(list, "พื้นที่", parcel, (value) => formatParcelArea(value?.areaRai, value?.areaSqm));
    appendField(list, "ชนิดพืช", parcel?.cropType);

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
    renderParcelDraftForm,
    showParcelDraftForm,
    renderResultPanel,
    createPopupContent,
    createParcelPopupContent,
    text: TEXT,
  };
})(window);
