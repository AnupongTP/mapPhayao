(function () {
  const REQUEST_TIMEOUT_MS = 30000;
  const EMPTY_TEXT = "ไม่มีข้อมูล";
  const TEXT = {
    riceTitle: "ความเหมาะสมของที่ดินสำหรับปลูกข้าว",
    maizeTitle: "ความเหมาะสมของที่ดินสำหรับปลูกข้าวโพด",
    riceNoCoverage: "ไม่พบข้อมูลความเหมาะสมของที่ดินสำหรับปลูกข้าว ณ จุดนี้",
    maizeNoCoverage: "ไม่พบข้อมูลความเหมาะสมของที่ดินสำหรับปลูกข้าวโพด ณ จุดนี้",
    suitabilitySource: "ผลจากชั้นข้อมูลความเหมาะสมของที่ดินของกรมพัฒนาที่ดิน",
    incompleteEvaluation: "ยังไม่ได้ประเมินครบทุกปัจจัย",
    notEvaluated: "ยังไม่มีผลการตรวจสอบ",
  };
  const suitabilityLabels = {
    S1: "เหมาะสมมาก",
    S2: "เหมาะสมปานกลาง",
    S3: "เหมาะสมน้อย",
    N: "ไม่เหมาะสม",
    NO_DATA: "ไม่พบข้อมูลดินที่เพียงพอ",
    NO_COVERAGE: "ไม่พบข้อมูลครอบคลุมตำแหน่งนี้",
  };
  const suitabilityClasses = {
    S1: "status-s1",
    S2: "status-s2",
    S3: "status-s3",
    N: "status-n",
    NO_DATA: "status-no-coverage",
    NO_COVERAGE: "status-no-coverage",
  };

  const state = {
    latitude: null,
    longitude: null,
    locating: false,
    analyzing: false,
    analysisController: null,
    idToken: "",
  };

  const elements = {
    liffStatus: document.getElementById("liff-status"),
    useLocationButton: document.getElementById("use-location-button"),
    analyzeButton: document.getElementById("analyze-button"),
    latitudeField: document.getElementById("latitude-field"),
    longitudeField: document.getElementById("longitude-field"),
    statusMessage: document.getElementById("status-message"),
    suitabilityResults: document.getElementById("suitability-results"),
  };

  function setStatus(message, type) {
    elements.statusMessage.textContent = message;
    elements.statusMessage.classList.toggle("is-error", type === "error");
  }

  function setButtons() {
    elements.useLocationButton.disabled = state.locating;
    elements.analyzeButton.disabled =
      state.analyzing ||
      state.locating ||
      !isValidCoordinate(state.latitude, state.longitude);
  }

  function isValidCoordinate(latitude, longitude) {
    return (
      Number.isFinite(latitude) &&
      Number.isFinite(longitude) &&
      latitude >= -90 &&
      latitude <= 90 &&
      longitude >= -180 &&
      longitude <= 180
    );
  }

  function formatCoordinate(value) {
    return Number.isFinite(value) ? value.toFixed(6) : "";
  }

  function formatValue(value) {
    if (value === null || value === undefined || String(value).trim() === "") {
      return EMPTY_TEXT;
    }
    if (typeof value === "object") {
      return EMPTY_TEXT;
    }
    return String(value).trim();
  }

  function createElement(tagName, className, text) {
    const element = document.createElement(tagName);
    if (className) {
      element.className = className;
    }
    if (text !== undefined && text !== null) {
      element.textContent = text;
    }
    return element;
  }

  function normalizeClass(value) {
    if (value === null || value === undefined || String(value).trim() === "") {
      return "";
    }
    return String(value).trim().toUpperCase();
  }

  function resetResults() {
    elements.suitabilityResults.replaceChildren(
      createElement("p", "summary-card-message", TEXT.notEvaluated),
    );
  }

  function formatSuitabilityClass(classValue, label) {
    if (!classValue) {
      return EMPTY_TEXT;
    }
    return `${classValue} - ${label || suitabilityLabels[classValue] || classValue}`;
  }

  function getSuitabilityDisplay(item, noCoverageText) {
    const classValue = normalizeClass(item?.class);
    const status = normalizeClass(item?.status || item?.ruleStatus);

    if (classValue) {
      return {
        grade: classValue,
        label: formatSuitabilityClass(classValue, item.label),
        className: suitabilityClasses[classValue] || suitabilityClasses.NO_COVERAGE,
      };
    }

    if (status === "NO_DATA") {
      return {
        grade: "ไม่มีข้อมูล",
        label: suitabilityLabels.NO_DATA,
        className: suitabilityClasses.NO_COVERAGE,
      };
    }

    return {
      grade: "ไม่มีข้อมูล",
      label: noCoverageText,
      className: suitabilityClasses.NO_COVERAGE,
    };
  }

  function appendSummaryGroup(parent, title, rows) {
    const visibleRows = rows.filter((row) => formatValue(row.value) !== EMPTY_TEXT);
    if (!visibleRows.length) {
      return;
    }

    const group = createElement("section", "summary-card-group");
    const list = createElement("dl", "summary-card-list");
    group.append(createElement("h4", null, title), list);

    visibleRows.forEach((row) => {
      const item = createElement("div", "summary-card-row");
      item.append(
        createElement("dt", "summary-card-label", row.label),
        createElement("dd", "summary-card-value", formatValue(row.value)),
      );
      list.appendChild(item);
    });

    parent.appendChild(group);
  }

  function createCropSummary(title, display) {
    const section = createElement("article", `crop-suitability-summary ${display.className}`);
    section.append(
      createElement("h3", "crop-suitability-summary-title", title),
      createElement("div", "crop-suitability-summary-grade", display.grade),
      createElement("p", "crop-suitability-summary-label", display.label),
    );
    return section;
  }

  function renderSuitabilitySummary(data) {
    const payload = data || {};
    const card = createElement("article", "suitability-summary-card");
    const summaryGrid = createElement("div", "crop-suitability-summary-grid");
    const body = createElement("section", "suitability-card-body");
    const footer = createElement("footer", "suitability-card-footer");
    const riceDisplay = getSuitabilityDisplay(payload.riceLandSuitability, TEXT.riceNoCoverage);
    const maizeDisplay = getSuitabilityDisplay(payload.maizeLandSuitability, TEXT.maizeNoCoverage);

    summaryGrid.append(
      createCropSummary(TEXT.riceTitle, riceDisplay),
      createCropSummary(TEXT.maizeTitle, maizeDisplay),
    );

    appendSummaryGroup(body, TEXT.riceTitle, [
      { label: "ผลที่จุดนี้", value: riceDisplay.label },
      { label: "วิธีประเมิน", value: payload.riceLandSuitability?.evaluationMethod },
      { label: "แหล่งข้อมูล", value: payload.riceLandSuitability?.sourceName },
      { label: "ชุดข้อมูล", value: payload.riceLandSuitability?.sourceDataset },
    ]);

    appendSummaryGroup(body, TEXT.maizeTitle, [
      { label: "ผลที่จุดนี้", value: maizeDisplay.label },
      { label: "วิธีประเมิน", value: payload.maizeLandSuitability?.evaluationMethod },
      { label: "แหล่งข้อมูล", value: payload.maizeLandSuitability?.sourceName },
      { label: "ชุดข้อมูล", value: payload.maizeLandSuitability?.sourceDataset },
    ]);

    appendSummaryGroup(body, "หมายเหตุ", [
      { label: "คำอธิบาย", value: TEXT.suitabilitySource },
    ]);

    footer.append(createElement("span", "suitability-status-pill", TEXT.incompleteEvaluation));
    card.append(summaryGrid, body, footer);
    elements.suitabilityResults.replaceChildren(card);
  }

  function renderAnalysis(data) {
    if (!data || data.found === false) {
      renderSuitabilitySummary({
        riceLandSuitability: {
          status: "NO_COVERAGE",
        },
        maizeLandSuitability: {
          status: "NO_COVERAGE",
        },
      });
      return;
    }

    renderSuitabilitySummary(data);
  }

  function getPositionErrorMessage(error) {
    if (!error) {
      return "ไม่สามารถอ่านตำแหน่งได้";
    }
    if (error.code === error.PERMISSION_DENIED) {
      return "ไม่ได้รับอนุญาตให้ใช้ตำแหน่ง กรุณาอนุญาตการเข้าถึงตำแหน่ง";
    }
    if (error.code === error.POSITION_UNAVAILABLE) {
      return "ไม่พบตำแหน่งปัจจุบัน กรุณาลองใหม่";
    }
    if (error.code === error.TIMEOUT) {
      return "ใช้เวลาค้นหาตำแหน่งนานเกินไป กรุณาลองใหม่";
    }
    return "ไม่สามารถอ่านตำแหน่งได้";
  }

  function requestCurrentLocation() {
    if (state.locating) {
      return;
    }
    if (!navigator.geolocation) {
      setStatus("เบราว์เซอร์นี้ไม่รองรับการระบุตำแหน่ง", "error");
      return;
    }

    state.locating = true;
    setButtons();
    setStatus("กำลังค้นหาตำแหน่งปัจจุบัน...");

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const latitude = Number(position.coords.latitude);
        const longitude = Number(position.coords.longitude);
        state.locating = false;

        if (!isValidCoordinate(latitude, longitude)) {
          state.latitude = null;
          state.longitude = null;
          elements.latitudeField.value = "";
          elements.longitudeField.value = "";
          setStatus("พิกัดไม่ถูกต้อง กรุณาลองใหม่", "error");
          setButtons();
          return;
        }

        state.latitude = latitude;
        state.longitude = longitude;
        elements.latitudeField.value = formatCoordinate(latitude);
        elements.longitudeField.value = formatCoordinate(longitude);
        setStatus("พร้อมตรวจสอบพื้นที่");
        setButtons();
      },
      (error) => {
        state.locating = false;
        setStatus(getPositionErrorMessage(error), "error");
        setButtons();
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      },
    );
  }

  function getAnalysisErrorMessage(error) {
    if (error.statusCode === 400) {
      return "ข้อมูลตำแหน่งไม่ถูกต้อง";
    }
    if (error.statusCode === 401) {
      return "ไม่สามารถยืนยันตัวตนกับ LINE ได้ กรุณาปิดแล้วเปิดใหม่";
    }
    if (error.statusCode === 502) {
      return "ไม่สามารถติดต่อบริการ LINE ได้ กรุณาลองใหม่";
    }
    if (error.name === "AbortError") {
      return "การตรวจสอบใช้เวลานานเกินไป กรุณาลองใหม่";
    }
    if (error.isNetworkError) {
      return "ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้";
    }
    return error.message || "ตรวจสอบพื้นที่ไม่สำเร็จ กรุณาลองใหม่";
  }

  async function fetchJsonWithTimeout(url, options, controller) {
    const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      let response;
      try {
        response = await fetch(url, {
          ...options,
          signal: controller.signal,
        });
      } catch (error) {
        if (error.name === "AbortError") {
          throw error;
        }
        error.isNetworkError = true;
        throw error;
      }

      const text = await response.text();
      let data;

      try {
        data = text ? JSON.parse(text) : null;
      } catch (error) {
        throw new Error("รูปแบบข้อมูลจาก API ไม่ถูกต้อง");
      }

      if (!response.ok) {
        const error = new Error(data?.error || `API ตอบกลับผิดพลาด (${response.status})`);
        error.statusCode = response.status;
        throw error;
      }

      return data;
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  async function analyzeCurrentLocation() {
    if (!isValidCoordinate(state.latitude, state.longitude)) {
      setStatus("พิกัดไม่ถูกต้อง กรุณาใช้ตำแหน่งปัจจุบันอีกครั้ง", "error");
      setButtons();
      return;
    }

    if (!state.idToken) {
      setStatus("กรุณาเปิดหน้านี้ผ่านแอป LINE แล้วลองใหม่อีกครั้ง", "error");
      setButtons();
      return;
    }

    if (state.analysisController) {
      state.analysisController.abort();
    }

    const controller = new AbortController();
    state.analysisController = controller;
    state.analyzing = true;
    setButtons();
    setStatus("กำลังตรวจสอบพื้นที่...");

    const apiBaseUrl = window.LiffConfig?.apiBaseUrl || "";
    const url = `${apiBaseUrl}/line/location-analysis`;

    try {
      const data = await fetchJsonWithTimeout(
        url,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            idToken: state.idToken,
            lat: state.latitude,
            lng: state.longitude,
          }),
        },
        controller,
      );
      if (state.analysisController !== controller) {
        return;
      }
      renderAnalysis(data);
      setStatus(data?.found === false ? "ไม่พบข้อมูลครอบคลุมตำแหน่งนี้" : "ตรวจสอบพื้นที่สำเร็จ");
    } catch (error) {
      if (state.analysisController !== controller) {
        return;
      }
      setStatus(getAnalysisErrorMessage(error), "error");
    } finally {
      if (state.analysisController === controller) {
        state.analysisController = null;
        state.analyzing = false;
        setButtons();
      }
    }
  }

  async function initializeLiffIfConfigured() {
    const liffId = window.LiffConfig?.liffId;
    if (!liffId) {
      elements.liffStatus.textContent = "เว็บทั่วไป";
      return;
    }
    if (!window.liff) {
      elements.liffStatus.textContent = "LIFF ไม่พร้อมใช้งาน";
      return;
    }

    await window.liff.init({ liffId });
    state.idToken = window.liff.getIDToken() || "";
    elements.liffStatus.textContent = "LIFF";
    elements.liffStatus.classList.add("is-ready");
  }

  function initialize() {
    resetResults();
    setButtons();
    elements.useLocationButton.addEventListener("click", requestCurrentLocation);
    elements.analyzeButton.addEventListener("click", analyzeCurrentLocation);
    initializeLiffIfConfigured().catch(() => {
      elements.liffStatus.textContent = "LIFF เริ่มต้นไม่สำเร็จ";
    });
  }

  initialize();
})();
