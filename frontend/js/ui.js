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
    lineSummary: "รับสรุปข้อมูลทาง LINE",
    lineSummarySendingShort: "กำลังส่ง...",
    lineSummarySentShort: "ส่งข้อมูลแล้ว",
    gpsLoading: "กำลังค้นหาตำแหน่งปัจจุบัน...",
    gpsReady: "พบตำแหน่งปัจจุบันแล้ว กรุณาตรวจสอบหมุดและกดยืนยันตำแหน่ง",
    apiLoading: "กำลังตรวจสอบข้อมูลพื้นที่...",
    unsupported:
      "อุปกรณ์หรือเบราว์เซอร์นี้ไม่รองรับการระบุตำแหน่ง กรุณาเลือกตำแหน่งจากแผนที่",
    permissionDenied:
      "ไม่สามารถเข้าถึงตำแหน่งได้ กรุณาอนุญาตการใช้ตำแหน่ง หรือเลือกตำแหน่งจากแผนที่",
    positionUnavailable: "ไม่พบตำแหน่งปัจจุบัน กรุณาลองใหม่หรือเลือกตำแหน่งจากแผนที่",
    timeout: "ใช้เวลาค้นหาตำแหน่งนานเกินไป กรุณาลองใหม่",
    secureContext:
      "เบราว์เซอร์ไม่อนุญาตให้เข้าถึงตำแหน่ง กรุณาใช้งานผ่าน HTTPS หรือ localhost",
    apiError: "ไม่สามารถโหลดข้อมูลพื้นที่ได้ กรุณาลองใหม่",
    noGisData: "ไม่พบข้อมูล GIS สำหรับตำแหน่งนี้",
    phayaoCoverage: "ข้อมูลปัจจุบันครอบคลุมเฉพาะพื้นที่จังหวัดพะเยา",
    pointResultTitle: "ผลการตรวจสอบตำแหน่ง",
    parcelResultTitle: "ผลการตรวจสอบพื้นที่แปลง",
    mapSource: "เลือกจากแผนที่",
    dragSource: "ลากหมุด",
    gpsSource: "ตำแหน่งปัจจุบัน",
    detailLinkSource: "ลิงก์รายละเอียด",
    riceSuitabilityTitle: "ความเหมาะสมของที่ดินสำหรับปลูกข้าว",
    maizeSuitabilityTitle: "ความเหมาะสมของที่ดินสำหรับปลูกข้าวโพด",
    riceSuitabilitySource:
      "ผลจากชั้นข้อมูลความเหมาะสมของที่ดินของกรมพัฒนาที่ดิน",
    temporaryParcelTitle: "พื้นที่แปลงชั่วคราว",
    drawParcel: "วาดพื้นที่แปลง",
    saveEdit: "บันทึกแก้ไข",
    saveBoundary: "บันทึกขอบเขต",
    cancelEdit: "ยกเลิกแก้ไข",
    cancel: "ยกเลิก",
    parcelLoading: "กำลังวิเคราะห์พื้นที่แปลง...",
    parcelAnalyzeError: "ไม่สามารถวิเคราะห์พื้นที่แปลงได้ กรุณาลองใหม่",
    parcelNameRequired: "ชื่อพื้นที่แปลงต้องไม่เป็นค่าว่าง",
    parcelNameField: "ชื่อพื้นที่แปลง",
    parcelNoRiceCoverage:
      "ไม่พบข้อมูลความเหมาะสมของที่ดินสำหรับปลูกข้าวในพื้นที่แปลงนี้",
    parcelNoMaizeCoverage:
      "ไม่พบข้อมูลความเหมาะสมของที่ดินสำหรับปลูกข้าวโพดในพื้นที่แปลงนี้",
    pointNoMaizeCoverage:
      "ไม่พบข้อมูลความเหมาะสมของที่ดินสำหรับปลูกข้าวโพด ณ จุดนี้",
    pointNoRiceCoverage:
      "ไม่พบข้อมูลความเหมาะสมของที่ดินสำหรับปลูกข้าว ณ จุดนี้",
    parcelEditLocked:
      "กำลังวาดหรือแก้ไขพื้นที่แปลง กรุณาดำเนินการให้เสร็จก่อน",
    parcelSummaryTitle: "สรุปผลจากชั้นข้อมูลความเหมาะสมของที่ดิน",
    parcelSummaryNote:
      "ผลนี้ได้จากการซ้อนทับพื้นที่แปลงกับชั้นข้อมูลความเหมาะสมของที่ดินของกรมพัฒนาที่ดิน โดยแสดงผลของข้าวและข้าวโพดแยกกัน และยังไม่ใช่คำแนะนำว่าควรเลือกปลูกพืชชนิดใด",
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

  const parcelControlState = {
    drawButton: null,
    saveButton: null,
    cancelButton: null,
    savedParcelButton: null,
    temporaryParcelButton: null,
    hasSavedParcels: false,
    hasTemporaryParcels: false,
    hideParcelButtons: false,
    parcelPanel: null,
    parcelList: null,
  };
  const mobileLayoutMediaQuery = window.matchMedia
    ? window.matchMedia("(max-width: 700px)")
    : null;
  let mobileLocationLauncherAction = null;
  let expandedTemporaryParcelId = null;
  let resultPanelCloseHandler = null;
  let lineSummaryClickHandler = null;
  let latestLineSummaryButtonState = {
    visible: false,
    enabled: false,
    text: TEXT.lineSummary,
    busy: false,
  };

  function syncSidebarLayoutState() {
    const sidebar = ensureSidebar();
    const resultPanel = document.getElementById("result-panel");
    const hasResultPanel = Boolean(resultPanel && resultPanel.classList.contains("is-open"));
    sidebar.classList.toggle("has-result-panel", hasResultPanel);
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

  function isMobileLayout() {
    return mobileLayoutMediaQuery ? mobileLayoutMediaQuery.matches : window.innerWidth <= 700;
  }

  function ensureMobileLocationLauncher() {
    let launcher = document.getElementById("mobile-location-launcher");
    if (launcher) {
      return launcher;
    }

    launcher = createElement("button", "mobile-location-launcher");
    launcher.id = "mobile-location-launcher";
    launcher.type = "button";
    launcher.setAttribute("aria-controls", "location-panel");
    launcher.setAttribute("aria-label", "หาตำแหน่งปัจจุบัน");
    launcher.append(
      createElement("span", "mobile-location-launcher-icon", "⌖"),
      createElement("span", "mobile-location-launcher-text", "หาตำแหน่ง"),
    );
    launcher.addEventListener("click", () => {
      if (typeof mobileLocationLauncherAction === "function") {
        mobileLocationLauncherAction();
      } else {
        openMobileLocationPanel();
      }
    });
    document.body.appendChild(launcher);
    return launcher;
  }

  function setMobileLocationLauncherLoading(isLoading) {
    const launcher = ensureMobileLocationLauncher();
    const text = launcher.querySelector(".mobile-location-launcher-text");
    launcher.disabled = Boolean(isLoading);
    launcher.setAttribute("aria-busy", isLoading ? "true" : "false");
    if (text) {
      text.textContent = isLoading ? "กำลังค้นหา..." : "หาตำแหน่ง";
    }
  }

  function ensureMobilePointConfirmButton() {
    const actionBar = ensureMobilePointActionBar();
    let button = document.getElementById("mobile-point-confirm");
    if (button) {
      if (button.parentElement !== actionBar) {
        actionBar.appendChild(button);
      }
      return button;
    }

    button = createElement("button", "mobile-point-confirm", "ยืนยันตำแหน่ง");
    button.id = "mobile-point-confirm";
    button.type = "button";
    button.hidden = true;
    button.setAttribute("aria-controls", "result-panel");
    button.setAttribute("aria-label", "ยืนยันตำแหน่งที่เลือก");
    button.setAttribute("aria-busy", "false");
    actionBar.appendChild(button);
    return button;
  }

  function ensureMobilePointActionBar() {
    let actionBar = document.getElementById("mobile-point-actions");
    if (actionBar) {
      return actionBar;
    }

    actionBar = createElement("div", "mobile-point-actions");
    actionBar.id = "mobile-point-actions";
    actionBar.hidden = true;
    document.body.appendChild(actionBar);
    return actionBar;
  }

  function bindLineSummaryButton(button) {
    if (!button) {
      return;
    }
    button.onclick =
      typeof lineSummaryClickHandler === "function" ? lineSummaryClickHandler : null;
  }

  function ensureMobileLineSummaryButton() {
    const actionBar = ensureMobilePointActionBar();
    let button = document.getElementById("mobile-line-summary-button");
    if (button) {
      if (button.parentElement !== actionBar) {
        actionBar.appendChild(button);
      }
      bindLineSummaryButton(button);
      return button;
    }

    button = createElement(
      "button",
      "mobile-point-confirm mobile-line-summary-button",
      TEXT.lineSummary,
    );
    button.id = "mobile-line-summary-button";
    button.type = "button";
    button.hidden = true;
    button.disabled = true;
    button.dataset.lineSummaryButton = "true";
    button.setAttribute("aria-controls", "mobile-line-summary-status");
    button.setAttribute("aria-label", TEXT.lineSummary);
    button.setAttribute("aria-busy", "false");
    bindLineSummaryButton(button);
    actionBar.appendChild(button);
    return button;
  }

  function ensureMobileLineSummaryStatus() {
    const actionBar = ensureMobilePointActionBar();
    let status = document.getElementById("mobile-line-summary-status");
    if (status) {
      if (status.parentElement !== actionBar) {
        actionBar.appendChild(status);
      }
      return status;
    }

    status = createElement("p", "mobile-line-summary-status");
    status.id = "mobile-line-summary-status";
    status.hidden = true;
    status.setAttribute("aria-live", "polite");
    status.setAttribute("role", "status");
    actionBar.appendChild(status);
    return status;
  }

  function syncMobilePointActionBarVisibility() {
    const actionBar = ensureMobilePointActionBar();
    const confirmButton = document.getElementById("mobile-point-confirm");
    const summaryButton = document.getElementById("mobile-line-summary-button");
    const summaryStatus = document.getElementById("mobile-line-summary-status");
    const hasVisibleContent =
      isMobileLayout() &&
      ((confirmButton && !confirmButton.hidden) ||
        (summaryButton && !summaryButton.hidden) ||
        (summaryStatus && !summaryStatus.hidden));

    actionBar.hidden = !hasVisibleContent;
  }

  function syncMobilePanelState() {
    const panel = document.getElementById("location-panel");
    const resultPanel = document.getElementById("result-panel");
    const launcher = document.getElementById("mobile-location-launcher");
    const isMobile = isMobileLayout();
    const isLocationOpen = Boolean(panel && panel.classList.contains("is-mobile-open"));
    const isResultOpen = Boolean(resultPanel && resultPanel.classList.contains("is-open"));

    if (panel) {
      panel.querySelector("#location-panel-content").hidden = false;
      if (!isMobile) {
        panel.classList.remove("is-mobile-open");
      } else if (isResultOpen) {
        panel.classList.remove("is-mobile-open");
      }
    }

    if (launcher) {
      launcher.hidden = !isMobile || isLocationOpen || isResultOpen;
      launcher.setAttribute("aria-expanded", isLocationOpen ? "true" : "false");
    }

    syncSidebarLayoutState();
  }

  function openMobileLocationPanel() {
    ensureLocationPanel();
    const panel = document.getElementById("location-panel");
    const resultPanel = document.getElementById("result-panel");
    if (!isMobileLayout() || !panel) {
      syncMobilePanelState();
      return;
    }

    if (resultPanel) {
      resultPanel.classList.remove("is-open");
    }
    panel.classList.add("is-mobile-open");
    syncMobilePanelState();
  }

  function closeMobileLocationPanel() {
    const panel = document.getElementById("location-panel");
    if (panel) {
      panel.classList.remove("is-mobile-open");
    }
    syncMobilePanelState();
  }

  function openResultPanel(panel) {
    const locationPanel = document.getElementById("location-panel");
    panel.hidden = false;
    panel.classList.add("is-open");
    if (isMobileLayout() && locationPanel) {
      locationPanel.classList.remove("is-mobile-open");
    }
    syncMobilePanelState();
  }

  function closeResultPanel(panel) {
    panel.classList.remove("is-open");
    panel.hidden = true;
    if (typeof resultPanelCloseHandler === "function") {
      resultPanelCloseHandler();
    }
    syncMobilePanelState();
  }

  function closeCurrentResultPanel() {
    const panel = document.getElementById("result-panel");
    if (panel) {
      closeResultPanel(panel);
    }
  }

  function handleMobileLayoutChange() {
    syncMobilePanelState();
    applyLineSummaryButtonState();
    syncMobilePointActionBarVisibility();
  }

  if (mobileLayoutMediaQuery?.addEventListener) {
    mobileLayoutMediaQuery.addEventListener("change", handleMobileLayoutChange);
  } else if (mobileLayoutMediaQuery?.addListener) {
    mobileLayoutMediaQuery.addListener(handleMobileLayoutChange);
  } else {
    window.addEventListener("resize", handleMobileLayoutChange);
  }

  function appendField(parent, label, value, formatter) {
    const row = createElement("div", "result-field");
    row.append(
      createElement("dt", "result-label", label),
      createElement(
        "dd",
        "result-value",
        formatter ? formatter(value) : formatters.formatValue(value),
      ),
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

  function formatCoordinatePair(value) {
    return `${formatters.formatCoordinate(value?.lat)}, ${formatters.formatCoordinate(value?.lng)}`;
  }

  function formatYearRange(dataPeriod) {
    if (!dataPeriod || !dataPeriod.startYear || !dataPeriod.endYear) {
      return TEXT.empty;
    }
    return `${dataPeriod.startYear}–${dataPeriod.endYear}`;
  }

  function formatYears(years) {
    return Array.isArray(years) && years.length ? years.join(", ") : TEXT.empty;
  }

  function formatCheckedAt(value) {
    if (!value) {
      return TEXT.empty;
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return TEXT.empty;
    }
    return new Intl.DateTimeFormat("th-TH", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date);
  }

  function formatWeatherTemperature(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return TEXT.empty;
    }
    return `${Number.isInteger(number) ? number.toFixed(0) : number.toFixed(1)} °C`;
  }

  function formatWeatherProbability(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return TEXT.empty;
    }
    return `${Math.round(Math.min(Math.max(number, 0), 100))}%`;
  }

  function formatWeatherUpdatedAt(value) {
    if (!value) {
      return TEXT.empty;
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return TEXT.empty;
    }
    const parts = new Intl.DateTimeFormat("th-TH-u-ca-buddhist", {
      timeZone: "Asia/Bangkok",
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(date);
    const getPart = (type) => parts.find((part) => part.type === type)?.value || "";
    return `${getPart("day")} ${getPart("month")} ${getPart("year")} ${getPart("hour")}:${getPart("minute")} น.`;
  }

  function createAgriculturalWeatherCard(weather) {
    const card = createElement("section", "parcel-result-card agricultural-weather-card");
    card.appendChild(createElement("h3", "parcel-result-card-title", "พยากรณ์อากาศวันนี้"));
    const body = createElement("div", "parcel-result-card-body");

    if (!weather || weather.status !== "AVAILABLE") {
      body.appendChild(createElement("p", "result-message", "ไม่สามารถโหลดข้อมูลสภาพอากาศได้ในขณะนี้"));
      card.appendChild(body);
      return card;
    }

    const currentGroup = createElement("section", "summary-card-group");
    currentGroup.appendChild(createElement("h4", null, "สภาพอากาศขณะนี้"));
    const currentList = createElement("dl", "summary-card-list");
    currentList.appendChild(createSummaryRow("อุณหภูมิ", weather.temperatureC, formatWeatherTemperature));
    currentGroup.appendChild(currentList);

    const trendGroup = createElement("section", "summary-card-group");
    trendGroup.appendChild(createElement("h4", null, "อีก 1 ชั่วโมงข้างหน้า"));
    const trendList = createElement("dl", "summary-card-list");
    trendList.appendChild(
      createSummaryRow(
        "โอกาสฝนตก",
        weather.nextHourPrecipitationProbabilityPercent,
        formatWeatherProbability,
      ),
    );
    trendGroup.appendChild(trendList);

    const metaList = createElement("dl", "summary-card-list");
    metaList.append(
      createSummaryRow("อัปเดตล่าสุด", weather.updatedAt, formatWeatherUpdatedAt),
      createSummaryRow("แหล่งข้อมูล", weather.source || "Open-Meteo"),
    );

    body.append(currentGroup, trendGroup, metaList);
    card.appendChild(body);
    return card;
  }

  function buildFloodHazardSummary(flood) {
    if (!flood || flood.status === "unavailable") {
      return "ยังไม่สามารถตรวจสอบประวัติน้ำท่วมซ้ำซากได้ในขณะนี้";
    }
    if (flood.status === "detected") {
      return `พบประวัติน้ำท่วมซ้ำซาก ${flood.yearsDetected?.length || 0} ปี จากข้อมูลย้อนหลังช่วงปี ${formatYearRange(flood.dataPeriod)}`;
    }
    return "ไม่พบประวัติน้ำท่วมซ้ำซาก ณ ตำแหน่งนี้ในชุดข้อมูล GISTDA";
  }

  function buildDroughtHazardSummary(drought) {
    if (!drought || drought.status === "unavailable") {
      return "ยังไม่สามารถตรวจสอบประวัติภัยแล้งซ้ำซากได้ในขณะนี้";
    }
    if (drought.status === "detected") {
      return `พบประวัติภัยแล้งซ้ำซาก ${drought.yearsDetected?.length || 0} ปี จากข้อมูลย้อนหลังช่วงปี ${formatYearRange(drought.dataPeriod)}`;
    }
    return "ไม่พบประวัติภัยแล้งซ้ำซาก ณ ตำแหน่งนี้ในชุดข้อมูล GISTDA";
  }

  function appendHazardSubsection(parent, title, fields, className) {
    const section = createElement("section", className || "summary-card-group");
    section.append(createElement("h4", null, title));
    const list = createElement("dl", "summary-card-list");
    fields
      .filter((field) => field.value !== null && field.value !== undefined && field.value !== "")
      .forEach((field) => list.appendChild(createSummaryRow(field.label, field.value, field.formatter)));
    section.appendChild(list);
    parent.appendChild(section);
  }

  function renderHazardHistorySection(hazardHistory) {
    if (!hazardHistory) {
      return null;
    }

    const section = createElement("section", "parcel-result-card hazard-history-section");
    const body = createElement("div", "parcel-result-card-body parcel-hazard-card-body");
    const flood = hazardHistory.floodRecurrence || {};
    const drought = hazardHistory.droughtRecurrence || {};
    const floodYearsCount = flood.yearsDetected?.length || 0;
    const droughtYearsCount = drought.yearsDetected?.length || 0;
    const floodFields = [
      { label: "ผลตรวจสอบ", value: buildFloodHazardSummary(flood) },
      { label: "ปีที่พบ", value: flood.status === "detected" ? formatYears(flood.yearsDetected) : null },
      {
        label: "ค่าความถี่จากชุดข้อมูล",
        value: flood.status === "detected" && flood.frequency !== floodYearsCount ? flood.frequency : null,
      },
      { label: "แหล่งข้อมูล", value: flood.source || "GISTDA" },
      { label: "ตรวจสอบเมื่อ", value: flood.checkedAt, formatter: formatCheckedAt },
    ];
    const droughtFields = [
      { label: "ผลตรวจสอบ", value: buildDroughtHazardSummary(drought) },
      { label: "ปีที่พบ", value: drought.status === "detected" ? formatYears(drought.yearsDetected) : null },
      {
        label: "จำนวนเหตุการณ์ตามชุดข้อมูล",
        value: drought.status === "detected" && drought.totalOccurrences !== droughtYearsCount
          ? drought.totalOccurrences
          : null,
      },
      { label: "แหล่งข้อมูล", value: drought.source || "GISTDA" },
      { label: "ตรวจสอบเมื่อ", value: drought.checkedAt, formatter: formatCheckedAt },
    ];

    section.append(createElement("h3", "parcel-result-card-title", "ประวัติภัยของพื้นที่"));
    appendHazardSubsection(body, "พื้นที่น้ำท่วมซ้ำซาก (10 ปีล่าสุด)", floodFields, "summary-card-group parcel-hazard-subcard");
    appendHazardSubsection(body, "ประวัติภัยแล้งซ้ำซากระดับตำบล", droughtFields, "summary-card-group parcel-hazard-subcard");
    section.appendChild(body);
    return section;
  }

  function createSummaryRow(label, value, formatter) {
    const row = createElement("div", "summary-card-row");
    row.append(
      createElement("dt", "summary-card-label", label),
      createElement(
        "dd",
        "summary-card-value",
        formatter ? formatter(value) : formatters.formatValue(value),
      ),
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
    if (source === "detail-link") {
      return TEXT.detailLinkSource;
    }
    return TEXT.empty;
  }

  function formatSuitabilityClass(classValue, label) {
    if (!classValue) {
      return null;
    }
    return `${classValue} — ${label || suitabilityLabels[classValue] || classValue}`;
  }

  function getPointSuitabilityText(data, crop) {
    const item = crop === "maize" ? data.maizeLandSuitability || {} : data.riceLandSuitability || {};
    if (!item.class) {
      return crop === "maize" ? TEXT.pointNoMaizeCoverage : TEXT.pointNoRiceCoverage;
    }
    return formatSuitabilityClass(item.class, item.label);
  }

  function describeSuitabilityCoverage(data, noCoverageText) {
    if (!data || !Array.isArray(data.classes) || data.classes.length === 0) {
      return {
        headline: noCoverageText,
        items: [],
      };
    }

    const classes = data.classes.slice().sort((left, right) => {
      return (right.percentOfParcel || 0) - (left.percentOfParcel || 0);
    });
    const primary = classes[0];
    const primaryPercent = formatters.formatPercent(primary.percentOfParcel);

    if (classes.length === 1 && Number(primary.percentOfParcel) >= 99.995) {
      return {
        headline: `พื้นที่ทั้งหมดอยู่ในระดับ ${formatSuitabilityClass(primary.class, primary.label)} (${primaryPercent})`,
        items: classes,
      };
    }

    return {
      headline: `พื้นที่ส่วนใหญ่อยู่ในระดับ ${formatSuitabilityClass(primary.class, primary.label)} (${primaryPercent})`,
      secondary:
        classes.length > 1
          ? `รองลงมา ${formatSuitabilityClass(classes[1].class, classes[1].label)} (${formatters.formatPercent(classes[1].percentOfParcel)})`
          : null,
      items: classes,
    };
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
    return panel;
  }

  function ensureSidebar() {
    let sidebar = document.getElementById("app-sidebar");
    if (sidebar) {
      return sidebar;
    }

    sidebar = createElement("div", "app-sidebar");
    sidebar.id = "app-sidebar";
    document.body.appendChild(sidebar);
    syncSidebarLayoutState();
    return sidebar;
  }

  function ensureLocationPanel() {
    let panel = document.getElementById("location-panel");
    if (panel) {
      return panel;
    }

    const sidebar = ensureSidebar();
    panel = createPanel("location-panel", "location-panel is-open", TEXT.locationTitle);
    const header = panel.querySelector(".panel-header");
    const closeButton = createElement("button", "panel-close panel-close-danger location-panel-close", "ปิด");
    closeButton.type = "button";
    closeButton.setAttribute("aria-label", "ปิดหน้าต่างเลือกตำแหน่ง");
    closeButton.addEventListener("click", closeMobileLocationPanel);
    header.appendChild(closeButton);
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
    const lineSummaryButton = createElement(
      "button",
      "panel-button secondary line-summary-button",
      TEXT.lineSummary,
    );
    lineSummaryButton.type = "button";
    lineSummaryButton.id = "line-summary-button";
    lineSummaryButton.hidden = true;
    lineSummaryButton.disabled = true;
    lineSummaryButton.dataset.lineSummaryButton = "true";
    lineSummaryButton.setAttribute("aria-controls", "line-summary-status");
    lineSummaryButton.setAttribute("aria-label", TEXT.lineSummary);
    lineSummaryButton.setAttribute("aria-busy", "false");
    bindLineSummaryButton(lineSummaryButton);
    const lineSummaryStatus = createElement("p", "line-summary-status");
    lineSummaryStatus.id = "line-summary-status";
    lineSummaryStatus.hidden = true;
    lineSummaryStatus.setAttribute("aria-live", "polite");
    lineSummaryStatus.setAttribute("role", "status");
    actions.append(locateButton, confirmButton, lineSummaryButton);

    content.append(status, instruction, list, actions, lineSummaryStatus);
    sidebar.appendChild(panel);
    ensureMobileLocationLauncher();
    syncMobilePanelState();
    return panel;
  }

  function ensureResultPanel() {
    let panel = document.getElementById("result-panel");
    if (panel) {
      return panel;
    }

    const sidebar = ensureSidebar();
    panel = createPanel("result-panel", "result-panel", TEXT.pointResultTitle);
    panel.hidden = true;
    const header = panel.querySelector(".panel-header");
    const closeButton = createElement("button", "panel-close panel-close-danger result-panel-close", "ปิด");
    closeButton.type = "button";
    closeButton.setAttribute("aria-label", "ปิดหน้าต่างผลการตรวจสอบ");
    closeButton.addEventListener("click", () => {
      closeResultPanel(panel);
    });
    header.appendChild(closeButton);
    sidebar.appendChild(panel);
    syncSidebarLayoutState();
    return panel;
  }

  function setResultPanelTitle(panel, title) {
    const heading = panel?.querySelector(".panel-header h2");
    if (heading) {
      heading.textContent = title;
    }
  }

  function updateLocationList(list, location) {
    list.replaceChildren();
    appendField(list, "Latitude", location?.lat, formatters.formatCoordinate);
    appendField(list, "Longitude", location?.lng, formatters.formatCoordinate);
    appendField(list, "แหล่งที่มา", location?.source, formatSource);
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

  function setLocationActionsEnabled(isEnabled) {
    ensureLocationPanel();
    document.getElementById("locate-button").disabled = !isEnabled;
    document.getElementById("confirm-location-button").disabled = !isEnabled;
  }

  function getLineSummaryButton() {
    const panel = ensureLocationPanel();
    return panel.querySelector("#line-summary-button");
  }

  function getLineSummaryStatus() {
    const panel = ensureLocationPanel();
    return panel.querySelector("#line-summary-status");
  }

  function applyLineSummaryButtonState() {
    const panel = ensureLocationPanel();
    const actions = panel.querySelector(".location-actions");
    const desktopButton = getLineSummaryButton();
    const mobileButton = ensureMobileLineSummaryButton();
    const isVisible = Boolean(latestLineSummaryButtonState.visible);
    const text = latestLineSummaryButtonState.text || TEXT.lineSummary;
    const isEnabled = Boolean(latestLineSummaryButtonState.enabled);
    const isBusy = Boolean(latestLineSummaryButtonState.busy);
    const isMobile = isMobileLayout();

    if (actions) {
      actions.classList.toggle("has-line-summary", isVisible && !isMobile);
    }

    [desktopButton, mobileButton].forEach((button) => {
      button.hidden =
        !isVisible ||
        (button === desktopButton && isMobile) ||
        (button === mobileButton && !isMobile);
      button.disabled = !isEnabled;
      button.textContent = text;
      button.setAttribute("aria-busy", isBusy ? "true" : "false");
      bindLineSummaryButton(button);
    });

    if (!isVisible) {
      clearLineSummaryStatus();
    }

    syncMobilePointActionBarVisibility();
  }

  function setLineSummaryButtonState(options = {}) {
    latestLineSummaryButtonState = {
      visible: Boolean(options.visible),
      enabled: Boolean(options.enabled),
      text: options.text || TEXT.lineSummary,
      busy: Boolean(options.busy),
    };
    applyLineSummaryButtonState();
  }

  function setLineSummaryHandler(handler) {
    lineSummaryClickHandler = typeof handler === "function" ? handler : null;
    bindLineSummaryButton(getLineSummaryButton());
    bindLineSummaryButton(ensureMobileLineSummaryButton());
  }

  function showLineSummaryStatus(message, tone) {
    [getLineSummaryStatus(), ensureMobileLineSummaryStatus()].forEach((status) => {
      status.textContent = message || "";
      status.hidden = !message || (status.id === "mobile-line-summary-status" && !isMobileLayout());
      status.classList.toggle("is-success", tone === "success");
      status.classList.toggle("is-error", tone === "error");
    });
    syncMobilePointActionBarVisibility();
  }

  function clearLineSummaryStatus() {
    showLineSummaryStatus("");
  }

  function setupLocationPanel({ onLocate, onConfirm }) {
    const panel = ensureLocationPanel();
    mobileLocationLauncherAction = onLocate;
    panel.querySelector("#locate-button").addEventListener("click", onLocate);
    panel.querySelector("#confirm-location-button").addEventListener("click", onConfirm);
    const mobileConfirmButton = ensureMobilePointConfirmButton();
    mobileConfirmButton.addEventListener("click", onConfirm);
    return panel;
  }

  function syncMobilePointConfirmButton(options = {}) {
    const button = ensureMobilePointConfirmButton();
    const resultPanel = document.getElementById("result-panel");
    const isResultOpen = Boolean(resultPanel && resultPanel.classList.contains("is-open"));
    const isLoading = Boolean(options.isLoading);
    const isLiffMode = Boolean(options.isLiffMode);
    const shouldShow =
      isMobileLayout() &&
      !Boolean(options.isBlocked) &&
      (isLiffMode
        ? Boolean(options.hasSelectedPoint)
        : Boolean(options.hasPendingPoint) && !isResultOpen);

    button.hidden = !shouldShow;
    button.disabled = isLoading;
    button.textContent = isLoading ? "กำลังตรวจสอบ..." : "ยืนยันตำแหน่ง";
    button.setAttribute("aria-busy", isLoading ? "true" : "false");
    syncMobilePointActionBarVisibility();
  }

  function setResultPanelState(messages) {
    const panel = ensureResultPanel();
    setResultPanelTitle(panel, TEXT.pointResultTitle);
    const content = panel.querySelector("#result-panel-content");
    const messageList = Array.isArray(messages) ? messages : [messages];
    content.replaceChildren();
    content.scrollTop = 0;
    messageList.forEach((message) => {
      content.appendChild(createElement("p", "result-message", message));
    });
    openResultPanel(panel);
  }

  function showGpsLoading() {
    setMobileLocationLauncherLoading(true);
    setLocationStatus(TEXT.gpsLoading);
  }

  function showGpsReady(location) {
    setMobileLocationLauncherLoading(false);
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
    setMobileLocationLauncherLoading(false);
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

  function showAnalysisLoading() {
    setResultPanelState(TEXT.apiLoading);
  }

  function showApiError() {
    if (isMobileLayout()) {
      const resultPanel = document.getElementById("result-panel");
      if (resultPanel) {
        resultPanel.classList.remove("is-open");
      }
      setLocationStatus(TEXT.apiError);
      openMobileLocationPanel();
      return;
    }
    setResultPanelState(TEXT.apiError);
  }

  function showNoDataResult() {
    setResultPanelState([TEXT.noGisData, TEXT.phayaoCoverage]);
  }

  function getPointSuitabilityDisplay(item, noCoverageText) {
    if (!item || !item.class) {
      return {
        grade: "ไม่มีข้อมูล",
        label: noCoverageText,
        className: suitabilityClasses.NO_COVERAGE,
      };
    }

    return {
      grade: item.class,
      label: formatSuitabilityClass(item.class, item.label),
      className: suitabilityClasses[item.class] || suitabilityClasses.NO_COVERAGE,
    };
  }

  function hasPointSuitabilityData(item) {
    return Boolean(item && item.class);
  }

  function legacyRenderPointSuitabilitySummaryCard(data) {
    const card = createElement("article", "suitability-summary-card");
    const header = createElement(
      "header",
      `suitability-card-header ${getPointSuitabilityDisplay(
        data.riceLandSuitability,
        TEXT.pointNoRiceCoverage,
      ).className}`,
    );
    const body = createElement("section", "suitability-card-body");
    const riceDisplay = getPointSuitabilityDisplay(
      data.riceLandSuitability,
      TEXT.pointNoRiceCoverage,
    );
    const maizeDisplay = getPointSuitabilityDisplay(
      data.maizeLandSuitability,
      TEXT.pointNoMaizeCoverage,
    );

    header.append(
      createElement("div", "suitability-grade", riceDisplay.grade),
      createElement("div", "suitability-label", TEXT.riceSuitabilityTitle),
    );

    appendSummaryGroup(body, TEXT.riceSuitabilityTitle, [
      { label: "แหล่งข้อมูล", value: data.riceLandSuitability?.sourceName },
    ]);

    appendSummaryGroup(body, TEXT.maizeSuitabilityTitle, [
      { label: "แหล่งข้อมูล", value: data.maizeLandSuitability?.sourceName },
    ]);

    appendSummaryGroup(body, "หมายเหตุ", [
      { label: "คำอธิบาย", value: TEXT.riceSuitabilitySource },
    ]);

    card.append(header, body);
    return card;
  }

  function legacyRenderResultPanel(data) {
    const panel = ensureResultPanel();
    setResultPanelTitle(panel, TEXT.pointResultTitle);
    const content = panel.querySelector("#result-panel-content");
    const payload = data || {};
    const location = payload.location || {};
    const soil = payload.soil || {};
    const water = payload.water || {};
    const nearestStream = water.nearestStream || {};
    const nearestIrrigationCanal = water.nearestIrrigationCanal || {};
    const clickedPoint = payload.clickedPoint || {};

    content.replaceChildren();
    content.scrollTop = 0;

    if (!payload || payload.found === false) {
      if (payload && payload.found === false) {
        content.appendChild(createElement("p", "result-message", TEXT.noGisData));
        content.appendChild(createElement("p", "result-message", TEXT.phayaoCoverage));
      } else {
        content.appendChild(createElement("p", "result-message", TEXT.notEvaluated));
      }
      const hazardSection = renderHazardHistorySection(payload.hazardHistory);
      if (hazardSection) {
        content.appendChild(hazardSection);
      }
      openResultPanel(panel);
      return;
    }

    content.appendChild(renderPointSuitabilitySummaryCard(payload));
    const hazardSection = renderHazardHistorySection(payload.hazardHistory);
    if (hazardSection) {
      content.appendChild(hazardSection);
    }

    appendSection(content, "ข้อมูลตำแหน่ง", [
      { label: "จังหวัด", value: location.province },
      { label: "อำเภอ", value: location.amphoe },
      { label: "ตำบล", value: location.tambon },
      { label: "ลุ่มน้ำหลัก", value: location.basin },
      { label: "ลุ่มน้ำย่อย", value: location.subBasin },
      { label: "พิกัด", value: { lat: clickedPoint.latitude, lng: clickedPoint.longitude }, formatter: formatCoordinatePair },
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

    appendSection(content, "ข้อมูลน้ำ", [
      { label: "ลำน้ำใกล้ที่สุด", value: nearestStream.streamName },
      { label: "ประเภทลำน้ำ", value: nearestStream.streamType },
      { label: "ระยะห่างจากลำน้ำ", value: nearestStream.distanceM, formatter: formatters.formatDistance },
      { label: "คลองชลประทานใกล้ที่สุด", value: nearestIrrigationCanal.canalName },
      { label: "ระยะห่างจากคลอง", value: nearestIrrigationCanal.distanceM, formatter: formatters.formatDistance },
    ]);

    openResultPanel(panel);
  }

  function createPopupContent(data, options = {}) {
    const container = createElement("div", "map-popup");
    const title = createElement("h3", null, "ข้อมูลตำแหน่ง");
    const location = data.location || {};
    const soil = data.soil || {};
    const list = createElement("dl", "popup-list");

    appendField(list, "ตำบล", location.tambon);
    appendField(list, "อำเภอ", location.amphoe);
    appendField(list, "ชุดดิน", soil.soilNameThai);
    appendField(list, "ข้าว", getPointSuitabilityText(data, "rice"));
    appendField(list, "ข้าวโพด", getPointSuitabilityText(data, "maize"));

    if (typeof options.onOpenResult === "function") {
      const button = createElement("button", "point-popup-result-button", "ดูผลการตรวจสอบตำแหน่ง");
      button.type = "button";
      button.setAttribute("aria-label", "เปิดผลการตรวจสอบตำแหน่ง");
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        options.onOpenResult();
      });
      container.append(title, list, button);
      return container;
    }

    container.append(title, list);
    return container;
  }

  function isTemporaryParcelPanelOpen() {
    return Boolean(parcelControlState.parcelPanel && !parcelControlState.parcelPanel.hidden);
  }

  function openTemporaryParcelPanel() {
    if (!parcelControlState.parcelPanel || !parcelControlState.temporaryParcelButton) {
      return;
    }

    if (window.MapParcelManagement && typeof window.MapParcelManagement.closeMyParcelsSheet === "function") {
      window.MapParcelManagement.closeMyParcelsSheet();
    }
    expandedTemporaryParcelId = null;
    collapseRenderedTemporaryParcelCards();
    parcelControlState.parcelPanel.hidden = false;
    parcelControlState.temporaryParcelButton.setAttribute("aria-expanded", "true");
  }

  function closeTemporaryParcelPanel() {
    if (!parcelControlState.parcelPanel || !parcelControlState.temporaryParcelButton) {
      return;
    }

    expandedTemporaryParcelId = null;
    collapseRenderedTemporaryParcelCards();
    parcelControlState.parcelPanel.hidden = true;
    parcelControlState.temporaryParcelButton.setAttribute("aria-expanded", "false");
    if (!parcelControlState.temporaryParcelButton.hidden) {
      parcelControlState.temporaryParcelButton.focus({ preventScroll: true });
    }
  }

  function toggleTemporaryParcelPanel() {
    if (isTemporaryParcelPanelOpen()) {
      closeTemporaryParcelPanel();
      return;
    }

    openTemporaryParcelPanel();
  }

  function updateParcelButtonVisibility() {
    const shouldHideControls = Boolean(parcelControlState.hideParcelButtons);
    if (parcelControlState.savedParcelButton) {
      parcelControlState.savedParcelButton.hidden =
        shouldHideControls || !parcelControlState.hasSavedParcels;
    }
    if (parcelControlState.temporaryParcelButton) {
      parcelControlState.temporaryParcelButton.hidden =
        shouldHideControls || !parcelControlState.hasTemporaryParcels;
    }
  }

  function setSavedParcelsControlVisible(hasSavedParcels) {
    parcelControlState.hasSavedParcels = Boolean(hasSavedParcels);
    updateParcelButtonVisibility();
  }

  function syncTemporaryParcelsUI(parcelCount) {
    parcelControlState.hasTemporaryParcels = parcelCount > 0;
    updateParcelButtonVisibility();

    if (!parcelControlState.hasTemporaryParcels) {
      closeTemporaryParcelPanel();
    }
  }

  function collapseRenderedTemporaryParcelCards() {
    const container = parcelControlState.parcelList || document.getElementById("temporary-parcel-list");
    if (!container) {
      return;
    }

    container.querySelectorAll(".parcel-item").forEach((item) => {
      item.classList.remove("is-expanded");
    });
    container.querySelectorAll(".parcel-item-toggle").forEach((button) => {
      button.setAttribute("aria-expanded", "false");
    });
    container.querySelectorAll(".parcel-item-actions").forEach((actions) => {
      actions.hidden = true;
    });
    container.querySelectorAll(".parcel-item-chevron").forEach((chevron) => {
      chevron.textContent = "⌄";
    });
  }

  function renderTemporaryParcelList(parcels, handlers) {
    const container = parcelControlState.parcelList || document.getElementById("temporary-parcel-list");
    if (!container) {
      return;
    }
    const parcelCount = Array.isArray(parcels) ? parcels.length : 0;
    const hasParcels = parcelCount > 0;
    syncTemporaryParcelsUI(parcelCount);
    container.replaceChildren();

    if (!hasParcels) {
      container.appendChild(createElement("p", "parcel-empty", "ยังไม่มีพื้นที่แปลงชั่วคราว"));
      return;
    }

    if (expandedTemporaryParcelId && !parcels.some((parcel) => parcel.id === expandedTemporaryParcelId)) {
      expandedTemporaryParcelId = null;
    }

    parcels.forEach((parcel, index) => {
      const isExpanded = parcel.id === expandedTemporaryParcelId;
      const automaticName = `แปลงที่ ${index + 1}`;
      const parcelName = typeof parcel.name === "string" ? parcel.name.trim() : "";
      const hasCustomName = parcelName && parcelName !== automaticName;
      const item = createElement(
        "article",
        `parcel-item${parcel.isSelected ? " is-selected" : ""}${isExpanded ? " is-expanded" : ""}`,
      );
      const header = createElement("button", "parcel-item-header parcel-item-toggle");
      const actionsId = `temporary-parcel-actions-${parcel.id}`;
      const titleWrap = createElement("span", "parcel-item-title");
      const titleLine = createElement("span", "parcel-item-main");
      const chevron = createElement("span", "parcel-item-chevron", isExpanded ? "⌃" : "⌄");
      header.type = "button";
      header.setAttribute("aria-expanded", isExpanded ? "true" : "false");
      header.setAttribute("aria-controls", actionsId);
      header.addEventListener("click", () => {
        expandedTemporaryParcelId = isExpanded ? null : parcel.id;
        renderTemporaryParcelList(parcels, handlers);
      });
      titleLine.appendChild(createElement("span", "parcel-item-index", automaticName));
      if (hasCustomName) {
        titleLine.appendChild(createElement("span", "parcel-item-name", parcelName));
      }
      titleWrap.append(titleLine, createElement("span", "parcel-item-status", parcel.statusText));
      header.append(titleWrap, chevron);

      const actions = createElement("div", "parcel-item-actions");
      actions.id = actionsId;
      actions.hidden = !isExpanded;
      const makeButton = (label, onClick) => {
        const button = createElement("button", "parcel-action", label);
        button.type = "button";
        button.addEventListener("click", (event) => {
          event.stopPropagation();
          onClick();
        });
        return button;
      };

      actions.append(
        makeButton("เลือก", () => handlers.onSelect(parcel.id)),
        makeButton("ซูม", () => handlers.onFocus(parcel.id)),
        makeButton("เปลี่ยนชื่อ", () => handlers.onRename(parcel.id)),
        makeButton("แก้ไขขอบเขต", () => handlers.onEdit(parcel.id)),
        makeButton("วิเคราะห์ใหม่", () => handlers.onRetry(parcel.id)),
        makeButton("ลบ", () => handlers.onDelete(parcel.id)),
      );

      item.append(header, actions);
      container.appendChild(item);
    });
  }

  function promptParcelName(options) {
    return new Promise((resolve) => {
      const backdrop = createElement("div", "parcel-modal-backdrop");
      const modal = createElement("div", "parcel-modal");
      const title = createElement("h3", null, options?.title || TEXT.parcelNameField);
      const label = createElement("label");
      label.appendChild(createElement("span", null, TEXT.parcelNameField));
      const input = document.createElement("input");
      input.type = "text";
      input.value = options?.initialValue || "";
      input.maxLength = 120;
      label.appendChild(input);
      const error = createElement("p", "parcel-modal-error", "");
      const actions = createElement("div", "parcel-modal-actions");
      const cancelButton = createElement("button", "panel-button secondary", "ยกเลิก");
      cancelButton.type = "button";
      const confirmButton = createElement(
        "button",
        "panel-button",
        options?.confirmText || "บันทึก",
      );
      confirmButton.type = "button";

      const close = (result) => {
        backdrop.remove();
        resolve(result);
      };

      const submit = () => {
        const value = input.value.trim();
        if (!value) {
          error.textContent = TEXT.parcelNameRequired;
          input.focus();
          return;
        }
        close(value);
      };

      cancelButton.addEventListener("click", () => close(null));
      confirmButton.addEventListener("click", submit);
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          submit();
        }
        if (event.key === "Escape") {
          event.preventDefault();
          close(null);
        }
      });

      actions.append(cancelButton, confirmButton);
      modal.append(title, label, error, actions);
      backdrop.appendChild(modal);
      document.body.appendChild(backdrop);
      input.focus();
      input.select();
    });
  }

  function appendSuitabilityAreaSection(parent, title, data, noCoverageText) {
    const section = createElement("section", "result-section");
    section.appendChild(createElement("h3", null, title));

    const summary = describeSuitabilityCoverage(data, noCoverageText);
    section.appendChild(createElement("p", "result-message", summary.headline));
    if (summary.secondary) {
      section.appendChild(createElement("p", "result-message", summary.secondary));
    }

    if (!summary.items.length) {
      parent.appendChild(section);
      return;
    }

    const list = createElement("dl", "result-list");
    summary.items.forEach((item) => {
      appendField(list, formatSuitabilityClass(item.class, item.label), null, () => {
        return `${formatters.formatAreaRai(item.areaRai)} คิดเป็น ${formatters.formatPercent(item.percentOfParcel)} ของพื้นที่แปลง`;
      });
    });
    appendField(list, "แหล่งข้อมูล", data.sourceName);
    section.appendChild(list);
    parent.appendChild(section);
  }

  function legacyRenderParcelResult(parcelState) {
    const panel = ensureResultPanel();
    setResultPanelTitle(panel, TEXT.parcelResultTitle);
    const content = panel.querySelector("#result-panel-content");
    content.replaceChildren();
    content.scrollTop = 0;

    if (!parcelState) {
      content.appendChild(createElement("p", "result-message", TEXT.notEvaluated));
      openResultPanel(panel);
      return;
    }

    if (parcelState.analysisStatus === "loading") {
      content.appendChild(createElement("p", "result-message", TEXT.parcelLoading));
      openResultPanel(panel);
      return;
    }

    if (parcelState.analysisStatus === "error") {
      content.appendChild(createElement("p", "result-message", TEXT.parcelAnalyzeError));
      if (parcelState.analysisError) {
        content.appendChild(createElement("p", "result-message", parcelState.analysisError));
      }
      openResultPanel(panel);
      return;
    }

    if (parcelState.analysisStatus === "stale") {
      content.appendChild(
        createElement(
          "p",
          "result-message",
          "พื้นที่แปลงมีการแก้ไขขอบเขต กรุณากดวิเคราะห์ใหม่เพื่ออัปเดตผล",
        ),
      );
      openResultPanel(panel);
      return;
    }

    const analysis = parcelState.analysis || {};
    const parcel = analysis.parcel || {};
    const location = analysis.location || {};
    const soilSummary = analysis.soilSummary || {};
    const water = analysis.water || {};

    appendSection(content, "ข้อมูลพื้นที่แปลง", [
      { label: "ชื่อแปลง", value: analysis.name || parcelState.name },
      { label: "พื้นที่ตารางเมตร", value: parcel.areaSquareMeters, formatter: formatters.formatAreaSqm },
      { label: "พื้นที่ไร่", value: parcel.areaRai, formatter: formatters.formatAreaRai },
      { label: "ตำบล", value: location.tambons, formatter: formatters.formatList },
      { label: "อำเภอ", value: location.amphoes, formatter: formatters.formatList },
      { label: "ลุ่มน้ำหลัก", value: location.mainBasins, formatter: formatters.formatList },
      { label: "ลุ่มน้ำย่อย", value: location.subBasins, formatter: formatters.formatList },
    ]);

    appendSuitabilityAreaSection(
      content,
      TEXT.riceSuitabilityTitle,
      analysis.riceLandSuitability,
      TEXT.parcelNoRiceCoverage,
    );
    appendSuitabilityAreaSection(
      content,
      TEXT.maizeSuitabilityTitle,
      analysis.maizeLandSuitability,
      TEXT.parcelNoMaizeCoverage,
    );

    appendSection(
      content,
      "ข้อมูลดิน",
      (soilSummary.items || []).map((item, index) => ({
        label: `ชุดดิน ${index + 1}`,
        value: `${formatters.formatValue(item.soilNameThai)} / ${formatters.formatAreaRai(item.areaRai)} / ${formatters.formatPercent(item.percentOfParcel)}`,
      })),
    );

    appendSection(content, "ข้อมูลน้ำ", [
      { label: "ลำน้ำใกล้ที่สุด", value: water.nearestStream?.streamName },
      { label: "ประเภทลำน้ำ", value: water.nearestStream?.streamType },
      { label: "ระยะห่างลำน้ำ", value: water.nearestStream?.distanceM, formatter: formatters.formatDistance },
      { label: "คลองชลประทานใกล้ที่สุด", value: water.nearestIrrigationCanal?.canalName },
      { label: "ระยะห่างคลอง", value: water.nearestIrrigationCanal?.distanceM, formatter: formatters.formatDistance },
    ]);

    const summarySection = createElement("section", "result-section");
    summarySection.appendChild(createElement("h3", null, TEXT.parcelSummaryTitle));
    summarySection.appendChild(
      createElement(
        "p",
        "result-message",
        describeSuitabilityCoverage(
          analysis.riceLandSuitability,
          TEXT.parcelNoRiceCoverage,
        ).headline,
      ),
    );
    summarySection.appendChild(
      createElement(
        "p",
        "result-message",
        describeSuitabilityCoverage(
          analysis.maizeLandSuitability,
          TEXT.parcelNoMaizeCoverage,
        ).headline,
      ),
    );
    summarySection.appendChild(createElement("p", "result-message", TEXT.parcelSummaryNote));
    content.appendChild(summarySection);

    openResultPanel(panel);
  }

  function createParcelPopupContent(parcelState, options = {}) {
    const analysis = parcelState.analysis || {};
    const parcel = analysis.parcel || {};
    const container = createElement("div", "map-popup");
    const title = createElement("p", "parcel-popup-title", parcelState.name);
    const list = createElement("dl", "popup-list");
    const buttonRow = createElement("div");
    const detailsButton = createElement(
      "button",
      "parcel-popup-details-button",
      "เปิดรายละเอียด",
    );
    detailsButton.type = "button";

    appendField(list, "พื้นที่", parcel.areaSquareMeters, formatters.formatThaiLandArea);
    appendField(
      list,
      "ข้าว",
      getParcelPopupSuitabilityText(
        analysis.riceLandSuitability,
        TEXT.parcelNoRiceCoverage,
      ),
    );
    appendField(
      list,
      "ข้าวโพด",
      getParcelPopupSuitabilityText(
        analysis.maizeLandSuitability,
        TEXT.parcelNoMaizeCoverage,
      ),
    );

    if (typeof options.onOpenDetails === "function") {
      detailsButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        options.onOpenDetails(parcelState.id);
      });
      detailsButton.addEventListener("keydown", (event) => {
        if (event.key === " " || event.key === "Spacebar") {
          event.preventDefault();
          detailsButton.click();
        }
      });
    }

    buttonRow.appendChild(detailsButton);
    L.DomEvent.disableClickPropagation(container);
    L.DomEvent.disableScrollPropagation(container);
    container.append(title, list, buttonRow);
    return container;
  }

  function createPointCropSummary(title, display) {
    const section = createElement(
      "section",
      `crop-suitability-summary ${display.className}`,
    );
    section.append(
      createElement("h3", "crop-suitability-summary-title", title),
      createElement("div", "crop-suitability-summary-grade", display.grade),
      createElement("p", "crop-suitability-summary-label", display.label),
    );
    return section;
  }

  function createPointCropResultSummary(display) {
    const section = createElement(
      "section",
      `crop-suitability-summary ${display.className}`,
    );
    section.append(
      createElement("div", "crop-suitability-summary-grade", display.grade),
      createElement("p", "crop-suitability-summary-label", display.label),
    );
    return section;
  }

  function renderPointSuitabilitySummaryCard(data) {
    const card = createElement("article", "suitability-summary-card");
    const summaryGrid = createElement("div", "crop-suitability-summary-grid");
    const body = createElement("section", "suitability-card-body");
    const riceDisplay = getPointSuitabilityDisplay(
      data.riceLandSuitability,
      TEXT.pointNoRiceCoverage,
    );
    const maizeDisplay = getPointSuitabilityDisplay(
      data.maizeLandSuitability,
      TEXT.pointNoMaizeCoverage,
    );

    summaryGrid.append(
      createPointCropSummary(TEXT.riceSuitabilityTitle, riceDisplay),
      createPointCropSummary(TEXT.maizeSuitabilityTitle, maizeDisplay),
    );

    appendSummaryGroup(body, TEXT.riceSuitabilityTitle, [
      { label: "แหล่งข้อมูล", value: data.riceLandSuitability?.sourceName },
    ]);

    appendSummaryGroup(body, TEXT.maizeSuitabilityTitle, [
      { label: "แหล่งข้อมูล", value: data.maizeLandSuitability?.sourceName },
    ]);

    appendSummaryGroup(body, "หมายเหตุ", [
      { label: "คำอธิบาย", value: TEXT.riceSuitabilitySource },
    ]);

    card.append(summaryGrid, body);
    return card;
  }

  function createPointCropResultCard(title, suitability, display) {
    const card = createElement("section", "parcel-result-card point-crop-result-card");
    card.appendChild(createElement("h3", "parcel-result-card-title", title));
    const body = createElement("div", "parcel-result-card-body");
    const summary = createPointCropResultSummary(display);

    if (!hasPointSuitabilityData(suitability)) {
      body.appendChild(summary);
      card.appendChild(body);
      return card;
    }

    const details = createElement("dl", "summary-card-list");

    [
      { label: "แหล่งข้อมูล", value: suitability?.sourceName },
      { label: "คำอธิบาย", value: TEXT.riceSuitabilitySource },
    ].forEach((field) => {
      if (field.value !== null && field.value !== undefined && field.value !== "") {
        details.appendChild(createSummaryRow(field.label, field.value));
      }
    });

    body.append(summary, details);
    card.appendChild(body);
    return card;
  }

  function setResultPanelState(messages) {
    const panel = ensureResultPanel();
    setResultPanelTitle(panel, TEXT.pointResultTitle);
    const content = panel.querySelector("#result-panel-content");
    const messageList = Array.isArray(messages) ? messages : [messages];
    content.replaceChildren();
    content.scrollTop = 0;
    messageList.forEach((message) => {
      content.appendChild(createElement("p", "result-message", message));
    });
    openResultPanel(panel);
  }

  function renderResultPanel(data) {
    const panel = ensureResultPanel();
    setResultPanelTitle(panel, TEXT.pointResultTitle);
    const content = panel.querySelector("#result-panel-content");
    const payload = data || {};
    const location = payload.location || {};
    const soil = payload.soil || {};
    const water = payload.water || {};
    const nearestStream = water.nearestStream || {};
    const nearestIrrigationCanal = water.nearestIrrigationCanal || {};
    const clickedPoint = payload.clickedPoint || {};

    content.replaceChildren();
    content.scrollTop = 0;

    if (!payload || payload.found === false) {
      if (payload && payload.found === false) {
        content.appendChild(createElement("p", "result-message", TEXT.noGisData));
        content.appendChild(createElement("p", "result-message", TEXT.phayaoCoverage));
      } else {
        content.appendChild(createElement("p", "result-message", TEXT.notEvaluated));
      }
      const hazardSection = renderHazardHistorySection(payload.hazardHistory);
      if (hazardSection) {
        content.appendChild(hazardSection);
      }
      openResultPanel(panel);
      return;
    }

    const riceDisplay = getPointSuitabilityDisplay(
      payload.riceLandSuitability,
      TEXT.pointNoRiceCoverage,
    );
    const maizeDisplay = getPointSuitabilityDisplay(
      payload.maizeLandSuitability,
      TEXT.pointNoMaizeCoverage,
    );

    appendParcelResultCard(content, "ข้อมูลตำแหน่ง", [
      { label: "จังหวัด", value: location.province },
      { label: "อำเภอ", value: location.amphoe },
      { label: "ตำบล", value: location.tambon },
      { label: "ลุ่มน้ำหลัก", value: location.basin },
      { label: "ลุ่มน้ำย่อย", value: location.subBasin },
      { label: "พิกัด", value: { lat: clickedPoint.latitude, lng: clickedPoint.longitude }, formatter: formatCoordinatePair },
    ]);

    content.appendChild(
      createPointCropResultCard(
        TEXT.riceSuitabilityTitle,
        payload.riceLandSuitability,
        riceDisplay,
      ),
    );
    content.appendChild(
      createPointCropResultCard(
        TEXT.maizeSuitabilityTitle,
        payload.maizeLandSuitability,
        maizeDisplay,
      ),
    );

    const hazardSection = renderHazardHistorySection(payload.hazardHistory);
    if (hazardSection) {
      content.appendChild(hazardSection);
    }

    appendParcelResultCard(content, "ข้อมูลดิน", [
      { label: "รหัสชุดดิน", value: soil.seriesNo },
      { label: "ชื่อชุดดิน", value: soil.soilNameThai },
      { label: "การระบายน้ำ", value: soil.drainageDescriptionThai, formatter: formatters.formatDrainage },
      { label: "ความลึกของดิน", value: soil.depthDescriptionThai, formatter: formatters.formatSoilDepth },
      { label: "เนื้อดินชั้นบน", value: soil.surfaceTextureThai },
      { label: "ข้อมูลที่ยังขาด", value: soil.missingFields, formatter: formatters.formatMissingFields },
      { label: "สถานะข้อมูล", value: soil.dataStatus, formatter: formatters.formatStatus },
    ]);

    appendParcelResultCard(content, "ข้อมูลน้ำ", [
      { label: "ลำน้ำใกล้ที่สุด", value: nearestStream.streamName },
      { label: "ประเภทลำน้ำ", value: nearestStream.streamType },
      { label: "ระยะห่างจากลำน้ำ", value: nearestStream.distanceM, formatter: formatters.formatDistance },
      { label: "คลองชลประทานใกล้ที่สุด", value: nearestIrrigationCanal.canalName },
      { label: "ระยะห่างจากคลอง", value: nearestIrrigationCanal.distanceM, formatter: formatters.formatDistance },
    ]);

    content.appendChild(createAgriculturalWeatherCard(payload.weather));

    openResultPanel(panel);
  }

  function getSortedSuitabilityItems(data) {
    if (!data || !Array.isArray(data.classes) || data.classes.length === 0) {
      return [];
    }

    return data.classes
      .slice()
      .sort((left, right) => {
        const percentDiff = (right.percentOfParcel || 0) - (left.percentOfParcel || 0);
        if (percentDiff !== 0) {
          return percentDiff;
        }
        return (right.areaRai || 0) - (left.areaRai || 0);
      });
  }

  function isFullParcelClass(item, items) {
    return items.length === 1 && Number(item?.percentOfParcel) >= 99.995;
  }

  function createSuitabilityBadge(classValue) {
    return createElement(
      "span",
      `parcel-suitability-badge ${suitabilityClasses[classValue] || suitabilityClasses.NO_COVERAGE}`,
      classValue || formatters.EMPTY_TEXT,
    );
  }

  function createParcelCropPrimaryLine(item, percentText) {
    const line = createElement("div", "parcel-crop-result__primary-line");
    line.append(
      createSuitabilityBadge(item.class),
      createElement("span", "parcel-crop-result__primary-label", item.label || item.class),
    );

    if (percentText) {
      line.appendChild(createElement("span", "parcel-crop-result__primary-percent", `· ${percentText}`));
    }

    return line;
  }

  function createParcelCropSection(title, data, noCoverageText) {
    const section = createElement("section", "parcel-crop-result");
    const items = getSortedSuitabilityItems(data);
    section.appendChild(createElement("h3", "parcel-crop-result__title", title));

    if (!items.length) {
      section.appendChild(createPointCropResultSummary({
        grade: "ไม่มีข้อมูล",
        label: noCoverageText,
        className: suitabilityClasses.NO_COVERAGE,
      }));
      return section;
    }

    const primary = items[0];
    const fullParcel = isFullParcelClass(primary, items);
    const primaryWrap = createElement("div", "parcel-crop-result__primary");

    if (items.length > 1) {
      primaryWrap.appendChild(
        createElement("p", "parcel-crop-result__summary-label", "พื้นที่ส่วนใหญ่อยู่ในระดับ"),
      );
      primaryWrap.appendChild(
        createParcelCropPrimaryLine(primary, formatters.formatPercent(primary.percentOfParcel)),
      );
    } else {
      primaryWrap.appendChild(createParcelCropPrimaryLine(primary, null));
      primaryWrap.appendChild(
        createElement(
          "p",
          "parcel-crop-result__primary-metrics",
          formatters.formatAreaPercentLine(primary.areaRai, primary.percentOfParcel, {
            includeParcelSuffix: fullParcel,
          }),
        ),
      );
    }

    section.appendChild(primaryWrap);

    if (items.length > 1) {
      const distribution = createElement("div", "parcel-crop-result__distribution");
      distribution.appendChild(
        createElement("p", "parcel-crop-result__distribution-title", "สัดส่วนพื้นที่"),
      );
      const list = createElement("div", "parcel-crop-result__distribution-list");
      items.forEach((item) => {
        const row = createElement("div", "parcel-crop-result__distribution-item");
        row.append(
          createElement(
            "span",
            "parcel-crop-result__distribution-class",
            `${item.class} — ${item.label || item.class}`,
          ),
          createElement(
            "span",
            "parcel-crop-result__distribution-metrics",
            formatters.formatAreaPercentLine(item.areaRai, item.percentOfParcel),
          ),
        );
        list.appendChild(row);
      });
      distribution.appendChild(list);
      section.appendChild(distribution);
    }

    return section;
  }

  function collectSuitabilitySources(items) {
    const map = new Map();
    items.forEach((item) => {
      const sourceName = formatters.formatValue(item?.sourceName);
      if (sourceName === formatters.EMPTY_TEXT) {
        return;
      }

      if (!map.has(sourceName)) {
        map.set(sourceName, []);
      }
      map.get(sourceName).push(item.title);
    });
    return [...map.entries()];
  }

  function createSuitabilitySourceLine(items) {
    const sourceEntries = collectSuitabilitySources(items);
    if (!sourceEntries.length) {
      return null;
    }

    const container = createElement("div", "parcel-suitability-source");
    const texts = sourceEntries.map(([sourceName, titles]) => {
      if (sourceEntries.length === 1) {
        return sourceName;
      }
      return `${titles.join(", ")}: ${sourceName}`;
    });
    container.textContent = `แหล่งข้อมูลความเหมาะสมของที่ดิน: ${texts.join(" | ")}`;
    return container;
  }

  function getParcelPopupSuitabilityText(data, noCoverageText) {
    const items = getSortedSuitabilityItems(data);
    if (!items.length) {
      return noCoverageText;
    }

    const primary = items[0];
    const percentText = formatters.formatPercent(primary.percentOfParcel);
    if (items.length > 1) {
      return `พื้นที่ส่วนใหญ่อยู่ในระดับ ${primary.class} (${percentText})`;
    }

    return `${primary.class} — ${primary.label || primary.class} (${percentText})`;
  }

  function formatParcelHazardPeriod(startYear, endYear) {
    const start = Number(startYear);
    const end = Number(endYear);
    if (!Number.isInteger(start) || !Number.isInteger(end)) {
      return TEXT.empty;
    }
    return `${start}–${end}`;
  }

  function normalizeParcelHazardYears(years) {
    if (!Array.isArray(years)) {
      return [];
    }

    return [...new Set(
      years
        .map((year) => Number(year))
        .filter((year) => Number.isInteger(year)),
    )].sort((left, right) => left - right);
  }

  function formatParcelHazardYears(years) {
    const normalized = normalizeParcelHazardYears(years);
    return normalized.length ? normalized.join(", ") : TEXT.empty;
  }

  function formatParcelHazardPercent(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return TEXT.empty;
    }
    const clamped = Math.min(Math.max(number, 0), 100);
    return formatters.formatPercent(Object.is(clamped, -0) ? 0 : clamped);
  }

  function createHazardDetailList(fields) {
    const list = createElement("dl", "summary-card-list");
    fields.forEach((field) => {
      if (field.value === null || field.value === undefined || field.value === "") {
        return;
      }
      list.appendChild(createSummaryRow(field.label, field.value, field.formatter));
    });
    return list;
  }

  function appendParcelResultCard(parent, title, fields) {
    const card = createElement("section", "parcel-result-card");
    card.append(createElement("h3", "parcel-result-card-title", title));
    const body = createElement("div", "parcel-result-card-body");
    const list = createElement("dl", "result-list");
    fields.forEach((field) => appendField(list, field.label, field.value, field.formatter));
    if (fields.length) {
      body.appendChild(list);
    } else {
      body.appendChild(createElement("p", "result-message", TEXT.empty));
    }
    card.appendChild(body);
    parent.appendChild(card);
    return card;
  }

  function createParcelFloodHazardCard(flood) {
    const card = createElement("section", "summary-card-group parcel-hazard-subcard parcel-hazard-subcard--flood");
    card.appendChild(createElement("h4", null, "พื้นที่น้ำท่วมซ้ำซาก (10 ปีล่าสุด)"));

    const periodText = formatParcelHazardPeriod(flood?.startYear, flood?.endYear);
    const years = normalizeParcelHazardYears(flood?.yearsDetected);

    if (flood?.found) {
      card.appendChild(createHazardDetailList([
        { label: "ช่วงข้อมูล", value: periodText },
        { label: "จำนวนปีที่พบ", value: `${Number(flood.frequency) || years.length} ปี` },
        { label: "ปีที่พบ", value: formatParcelHazardYears(years) },
        { label: "พื้นที่ทับซ้อน", value: flood.affectedAreaRai, formatter: formatters.formatAreaRai },
        {
          label: "คิดเป็น",
          value: `${formatParcelHazardPercent(flood.affectedPercent)} ของพื้นที่แปลง`,
        },
        { label: "แหล่งข้อมูล", value: flood.source || "GISTDA" },
      ]));
      return card;
    }

    card.appendChild(
      createElement(
        "p",
        "result-message",
        periodText === TEXT.empty
          ? "ไม่พบพื้นที่น้ำท่วมซ้ำซากในชุดข้อมูล"
          : `ไม่พบพื้นที่น้ำท่วมซ้ำซากในชุดข้อมูลช่วง ${periodText}`,
      ),
    );
    card.appendChild(createHazardDetailList([
      { label: "แหล่งข้อมูล", value: flood?.source || "GISTDA" },
    ]));
    return card;
  }

  function createParcelDroughtHazardCard(drought) {
    const card = createElement("section", "summary-card-group parcel-hazard-subcard parcel-hazard-subcard--drought");
    card.appendChild(createElement("h4", null, "ประวัติภัยแล้งซ้ำซากระดับตำบล"));

    const tambons = Array.isArray(drought?.tambons) ? drought.tambons : [];
    if (!tambons.length) {
      card.appendChild(
        createElement("p", "result-message", "ไม่พบข้อมูลประวัติภัยแล้งของตำบลนี้ในชุดข้อมูล"),
      );
      return card;
    }

    tambons.forEach((tambon, index) => {
      const group = createElement("div", "summary-card-list parcel-hazard-tambon");
      const years = normalizeParcelHazardYears(tambon.yearsDetected);
      group.appendChild(createElement("h5", null, `ตำบลที่ ${index + 1}`));
      group.appendChild(createHazardDetailList([
        { label: "ตำบล", value: tambon.tambon },
        { label: "อำเภอ", value: tambon.district },
        { label: "ช่วงข้อมูล", value: formatParcelHazardPeriod(tambon.startYear, tambon.endYear) },
        { label: "จำนวนปีที่พบ", value: `${years.length} ปี` },
        { label: "ปีที่พบ", value: years.length ? formatParcelHazardYears(years) : "ไม่พบข้อมูลประวัติภัยแล้งของตำบลนี้ในชุดข้อมูล" },
        { label: "แหล่งข้อมูล", value: tambon.source || drought.source || "GISTDA" },
      ]));
      card.appendChild(group);
    });

    return card;
  }

  function renderParcelHistoricalHazardsSection(historicalHazards) {
    if (!historicalHazards) {
      return null;
    }

    const section = createElement("section", "parcel-result-card parcel-hazard-history-section");
    const body = createElement("div", "parcel-result-card-body parcel-hazard-card-body");
    section.appendChild(createElement("h3", "parcel-result-card-title", "ประวัติภัยของพื้นที่แปลง"));
    body.append(
      createParcelFloodHazardCard(historicalHazards.floodRecurrence || null),
      createParcelDroughtHazardCard(historicalHazards.droughtRecurrence || null),
    );
    section.appendChild(body);
    return section;
  }

  function renderParcelResult(parcelState) {
    const panel = ensureResultPanel();
    setResultPanelTitle(panel, TEXT.parcelResultTitle);
    const content = panel.querySelector("#result-panel-content");
    content.replaceChildren();
    content.scrollTop = 0;

    if (!parcelState) {
      content.appendChild(createElement("p", "result-message", TEXT.notEvaluated));
      openResultPanel(panel);
      return;
    }

    if (parcelState.analysisStatus === "loading") {
      content.appendChild(createElement("p", "result-message", TEXT.parcelLoading));
      openResultPanel(panel);
      return;
    }

    if (parcelState.analysisStatus === "error") {
      content.appendChild(createElement("p", "result-message", TEXT.parcelAnalyzeError));
      if (parcelState.analysisError) {
        content.appendChild(createElement("p", "result-message", parcelState.analysisError));
      }
      openResultPanel(panel);
      return;
    }

    if (parcelState.analysisStatus === "stale") {
      content.appendChild(
        createElement(
          "p",
          "result-message",
          "พื้นที่แปลงมีการแก้ไขขอบเขต กรุณากดวิเคราะห์ใหม่เพื่ออัปเดตผล",
        ),
      );
      openResultPanel(panel);
      return;
    }

    const analysis = parcelState.analysis || {};
    const parcel = analysis.parcel || {};
    const location = analysis.location || {};
    const soilSummary = analysis.soilSummary || {};
    const water = analysis.water || {};

    appendParcelResultCard(content, "ข้อมูลพื้นที่แปลง", [
      { label: "ชื่อแปลง", value: analysis.name || parcelState.name },
      { label: "พื้นที่", value: parcel.areaSquareMeters, formatter: formatters.formatThaiLandArea },
      { label: "พื้นที่ตารางเมตร", value: parcel.areaSquareMeters, formatter: formatters.formatAreaSqm },
      { label: "ตำบล", value: location.tambons, formatter: formatters.formatList },
      { label: "อำเภอ", value: location.amphoes, formatter: formatters.formatList },
      { label: "ลุ่มน้ำหลัก", value: location.mainBasins, formatter: formatters.formatList },
      { label: "ลุ่มน้ำย่อย", value: location.subBasins, formatter: formatters.formatList },
    ]);

    const riceSection = createParcelCropSection(
      TEXT.riceSuitabilityTitle,
      analysis.riceLandSuitability,
      TEXT.parcelNoRiceCoverage,
    );
    riceSection.classList.add("parcel-result-card");
    const maizeSection = createParcelCropSection(
      TEXT.maizeSuitabilityTitle,
      analysis.maizeLandSuitability,
      TEXT.parcelNoMaizeCoverage,
    );
    maizeSection.classList.add("parcel-result-card");

    const riceSourceLine = createSuitabilitySourceLine([
      { title: "ข้าว", sourceName: analysis.riceLandSuitability?.sourceName },
    ]);
    const maizeSourceLine = createSuitabilitySourceLine([
      { title: "ข้าวโพด", sourceName: analysis.maizeLandSuitability?.sourceName },
    ]);
    if (getSortedSuitabilityItems(analysis.riceLandSuitability).length && riceSourceLine) {
      riceSection.appendChild(riceSourceLine);
    }
    if (getSortedSuitabilityItems(analysis.maizeLandSuitability).length && maizeSourceLine) {
      maizeSection.appendChild(maizeSourceLine);
    }
    content.append(riceSection, maizeSection);

    const parcelHazardSection = renderParcelHistoricalHazardsSection(analysis.historicalHazards);
    if (parcelHazardSection) {
      content.appendChild(parcelHazardSection);
    }

    appendParcelResultCard(
      content,
      "ข้อมูลดิน",
      (soilSummary.items || []).map((item, index) => ({
        label: `ชุดดิน ${index + 1}`,
        value: `${formatters.formatValue(item.soilNameThai)} / ${formatters.formatAreaRai(item.areaRai)} / ${formatters.formatPercent(item.percentOfParcel)}`,
      })),
    );

    appendParcelResultCard(content, "ข้อมูลน้ำ", [
      { label: "ลำน้ำใกล้ที่สุด", value: water.nearestStream?.streamName },
      { label: "ประเภทลำน้ำ", value: water.nearestStream?.streamType },
      { label: "ระยะห่างลำน้ำ", value: water.nearestStream?.distanceM, formatter: formatters.formatDistance },
      { label: "คลองชลประทานใกล้ที่สุด", value: water.nearestIrrigationCanal?.canalName },
      { label: "ระยะห่างคลอง", value: water.nearestIrrigationCanal?.distanceM, formatter: formatters.formatDistance },
    ]);

    content.appendChild(createAgriculturalWeatherCard(analysis.weather));

    openResultPanel(panel);
  }

  function renderSavedParcelDetail(parcel, message) {
    const panel = ensureResultPanel();
    setResultPanelTitle(panel, "ข้อมูลแปลงที่บันทึกไว้");
    const content = panel.querySelector("#result-panel-content");
    content.replaceChildren();
    content.scrollTop = 0;

    if (message) {
      content.appendChild(createElement("p", "result-message", message));
    }

    appendParcelResultCard(content, "ข้อมูลแปลง", [
      { label: "ชื่อแปลง", value: parcel?.parcelName || parcel?.parcelCode },
      { label: "รหัสแปลง", value: parcel?.parcelCode },
      { label: "ชนิดพืช", value: parcel?.cropType, formatter: formatters.getCropTypeLabel },
      { label: "พันธุ์", value: parcel?.riceVariety },
      { label: "วันที่ปลูก", value: parcel?.plantingDate, formatter: formatters.formatThaiDateOnly },
      { label: "พื้นที่", value: parcel?.areaSqm, formatter: formatters.formatThaiLandArea },
      { label: "พื้นที่ไร่", value: parcel?.areaRai, formatter: formatters.formatAreaRai },
      { label: "อัปเดตล่าสุด", value: parcel?.updatedAt || parcel?.createdAt, formatter: formatters.formatThaiDateTime },
    ]);

    openResultPanel(panel);
  }

  function addParcelDrawControl(map, handlers) {
    const ParcelDrawControl = L.Control.extend({
      options: {
        position: "topleft",
      },
      onAdd() {
        const container = createElement("div", "parcel-draw-control leaflet-bar");
        const drawButton = createElement("button", "panel-button parcel-draw-button", TEXT.drawParcel);
        drawButton.type = "button";
        drawButton.setAttribute("aria-pressed", "false");
        const saveButton = createElement("button", "panel-button", TEXT.saveEdit);
        saveButton.type = "button";
        saveButton.hidden = true;
        const cancelButton = createElement("button", "panel-button secondary", TEXT.cancelEdit);
        cancelButton.type = "button";
        cancelButton.hidden = true;
        const savedParcelButton = createElement(
          "button",
          "panel-button secondary saved-parcels-control-button",
          "แปลงของฉัน",
        );
        savedParcelButton.id = "saved-parcels-control-button";
        savedParcelButton.type = "button";
        savedParcelButton.hidden = true;
        savedParcelButton.setAttribute("aria-controls", "my-parcels-sheet");
        savedParcelButton.setAttribute("aria-label", "เปิดรายการแปลงที่บันทึกไว้");
        savedParcelButton.title = "เปิดรายการแปลงที่บันทึกไว้";

        const temporaryParcelButton = createElement(
          "button",
          "mobile-temporary-parcels-button",
          "แปลงชั่วคราว",
        );
        temporaryParcelButton.id = "mobile-temporary-parcels-button";
        temporaryParcelButton.type = "button";
        temporaryParcelButton.hidden = true;
        temporaryParcelButton.setAttribute("aria-controls", "temporary-parcel-panel");
        temporaryParcelButton.setAttribute("aria-expanded", "false");
        temporaryParcelButton.setAttribute("aria-label", "เปิดรายการแปลงชั่วคราวที่ยังไม่ได้บันทึก");
        temporaryParcelButton.title = "เปิดรายการแปลงชั่วคราวที่ยังไม่ได้บันทึก";

        const parcelPanel = createElement("aside", "temporary-parcel-panel");
        parcelPanel.id = "temporary-parcel-panel";
        parcelPanel.hidden = true;
        parcelPanel.setAttribute("aria-label", "พื้นที่แปลง");
        const parcelHeader = createElement("div", "temporary-parcel-panel-header");
        parcelHeader.appendChild(createElement("h2", null, "พื้นที่แปลง"));
        const closeButton = createElement("button", "panel-close panel-close-danger", "ปิด");
        closeButton.type = "button";
        closeButton.setAttribute("aria-label", "ปิดแผงพื้นที่แปลง");
        parcelHeader.appendChild(closeButton);
        const parcelList = createElement("div", "parcel-list temporary-parcel-panel-list");
        parcelList.id = "temporary-parcel-list";
        parcelList.appendChild(createElement("p", "parcel-empty", TEXT.empty));
        const parcelNote = createElement(
          "p",
          "parcel-note",
          "รีเฟรชหรือปิดหน้าเว็บ พื้นที่แปลงชั่วคราวจะหายทั้งหมด",
        );
        parcelPanel.append(parcelHeader, parcelList, parcelNote);

        L.DomEvent.disableClickPropagation(container);
        L.DomEvent.disableScrollPropagation(container);
        L.DomEvent.disableClickPropagation(parcelPanel);
        L.DomEvent.disableScrollPropagation(parcelPanel);

        drawButton.addEventListener("click", handlers.onDraw);
        saveButton.addEventListener("click", handlers.onSaveEdit);
        cancelButton.addEventListener("click", handlers.onCancelEdit);
        savedParcelButton.addEventListener("click", () => {
          closeTemporaryParcelPanel();
          handlers.onOpenSavedParcels?.();
        });
        temporaryParcelButton.addEventListener("click", toggleTemporaryParcelPanel);
        closeButton.addEventListener("click", closeTemporaryParcelPanel);

        container.append(drawButton, saveButton, cancelButton, savedParcelButton, parcelPanel);
        document.body.appendChild(temporaryParcelButton);

        parcelControlState.drawButton = drawButton;
        parcelControlState.saveButton = saveButton;
        parcelControlState.cancelButton = cancelButton;
        parcelControlState.savedParcelButton = savedParcelButton;
        parcelControlState.temporaryParcelButton = temporaryParcelButton;
        parcelControlState.parcelPanel = parcelPanel;
        parcelControlState.parcelList = parcelList;
        updateParcelButtonVisibility();

        return container;
      },
    });

    return new ParcelDrawControl().addTo(map);
  }

  function setParcelControlState(options) {
    const isEditing = Boolean(options?.isEditing);
    const drawDisabled = Boolean(options?.drawDisabled);
    const isDrawing = Boolean(options?.isDrawing);
    const isSaving = Boolean(options?.isSaving);
    const hideDraw = Boolean(options?.hideDraw);
    const hideParcelList = Boolean(options?.hideParcelList);
    const saveText = options?.saveText || TEXT.saveEdit;
    const cancelText = options?.cancelText || TEXT.cancelEdit;

    parcelControlState.hideParcelButtons = hideParcelList;

    if (parcelControlState.drawButton) {
      parcelControlState.drawButton.hidden = hideDraw;
      parcelControlState.drawButton.disabled = drawDisabled;
      parcelControlState.drawButton.textContent = isDrawing ? "ยกเลิกการวาด" : TEXT.drawParcel;
      parcelControlState.drawButton.classList.toggle("is-active", isDrawing);
      parcelControlState.drawButton.setAttribute("aria-pressed", isDrawing ? "true" : "false");
    }
    if (parcelControlState.saveButton) {
      parcelControlState.saveButton.hidden = !isEditing;
      parcelControlState.saveButton.disabled = !isEditing || isSaving;
      parcelControlState.saveButton.textContent = saveText;
    }
    if (parcelControlState.cancelButton) {
      parcelControlState.cancelButton.hidden = !isEditing;
      parcelControlState.cancelButton.disabled = !isEditing || isSaving;
      parcelControlState.cancelButton.textContent = cancelText;
    }
    updateParcelButtonVisibility();
  }

  return (window.MapUi = {
    addLayerControl: function (map, baseLayers, overlayLayers) {
      const layerControlBaseLayers = {
        GoogleSatellite: baseLayers.googleSatellite,
        OpenStreetMap: baseLayers.openStreetMap,
      };

      const layerControlOverlayLayers = {};
      const addOverlay = (label, layer) => {
        if (layer) {
          layerControlOverlayLayers[label] = layer;
        }
      };

      addOverlay("ขอบเขตประเทศไทย", overlayLayers.thailandProvince);
      addOverlay("ขอบเขตตำบล", overlayLayers.tambonLayer);
      addOverlay("ขอบเขตอำเภอ", overlayLayers.amphoeLayer);
      addOverlay("ขอบเขตลุ่มน้ำหลัก", overlayLayers.mainBasinLayer);
      addOverlay("ขอบเขตลุ่มน้ำย่อย", overlayLayers.subBasinLayer);
      addOverlay("แม่น้ำและลำห้วย", overlayLayers.streamLayer);
      addOverlay("คลองชลประทาน", overlayLayers.irrigationCanalLayer);
      addOverlay("ความเหมาะสมปลูกข้าว — ทุกระดับ", overlayLayers.ricePotentialAllLayer);
      addOverlay("ความเหมาะสมปลูกข้าวโพด — ทุกระดับ", overlayLayers.maizePotentialAllLayer);
      addOverlay(
        "พื้นที่น้ำท่วมซ้ำซาก",
        overlayLayers.floodRecurrenceLayer,
      );
      addOverlay(
        "พื้นที่ภัยแล้งซ้ำซาก",
        overlayLayers.droughtRecurrenceLayer,
      );

      return L.control
        .layers(layerControlBaseLayers, layerControlOverlayLayers, {
          position: "topleft",
          collapsed: true,
        })
        .addTo(map);
    },
    isMobileLayout,
    addParcelDrawControl,
    setParcelControlState,
    setSavedParcelsControlVisible,
    setupLocationPanel,
    setConfirmEnabled,
    setLocationActionsEnabled,
    setLineSummaryButtonState,
    setLineSummaryHandler,
    showLineSummaryStatus,
    clearLineSummaryStatus,
    syncMobilePointConfirmButton,
    closeCurrentResultPanel,
    closeTemporaryParcelPanel,
    setResultPanelCloseHandler: function (handler) {
      resultPanelCloseHandler = typeof handler === "function" ? handler : null;
    },
    renderTemporaryParcelList,
    promptParcelName,
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
    renderParcelResult,
    renderSavedParcelDetail,
    createPopupContent,
    createParcelPopupContent,
    text: TEXT,
  });
})(window);
