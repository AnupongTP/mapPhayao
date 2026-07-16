const NO_DATA_TEXT = "ไม่มีข้อมูล";
const HEADER_TITLE = "ผลตรวจความเหมาะสมของพื้นที่";
const HEADER_COLOR = "#2F6F10";
const LOCATION_FALLBACK = "ไม่พบข้อมูลตำแหน่ง";
const DROUGHT_NOTE = "ข้อมูลภัยแล้งเป็นข้อมูลสรุประดับตำบล";
const HAZARD_UNKNOWN_TEXT = "ยังไม่สามารถแสดงผลการตรวจสอบได้ในขณะนี้";
const HAZARD_SOURCE_FALLBACK = "GISTDA";
const HAZARD_STATUS = {
  AVAILABLE: "AVAILABLE",
  NO_HISTORY: "NO_HISTORY",
  UNAVAILABLE: "UNAVAILABLE",
  NO_COVERAGE: "NO_COVERAGE",
  UNKNOWN: "UNKNOWN",
};

const SUITABILITY_STYLES = {
  S1: {
    code: "S1",
    label: "เหมาะสมมาก",
    mainColor: "#2F6F10",
    badgeBackground: "#DCFCE7",
    badgeText: "#166534",
    cardBackground: "#F7FAF5",
    border: "#D8E5D2",
  },
  S2: {
    code: "S2",
    label: "เหมาะสมปานกลาง",
    mainColor: "#B45309",
    badgeBackground: "#FEF3C7",
    badgeText: "#92400E",
    cardBackground: "#FFFBEB",
    border: "#FDE68A",
  },
  S3: {
    code: "S3",
    label: "เหมาะสมน้อย",
    mainColor: "#C2410C",
    badgeBackground: "#FFEDD5",
    badgeText: "#9A3412",
    cardBackground: "#FFF7ED",
    border: "#FED7AA",
  },
  N: {
    code: "N",
    label: "ไม่เหมาะสม",
    mainColor: "#B91C1C",
    badgeBackground: "#FEE2E2",
    badgeText: "#991B1B",
    cardBackground: "#FEF2F2",
    border: "#FECACA",
  },
  NO_DATA: {
    code: NO_DATA_TEXT,
    label: "ไม่พบข้อมูลความเหมาะสม",
    mainColor: "#475569",
    badgeBackground: "#E2E8F0",
    badgeText: "#334155",
    cardBackground: "#F8FAFC",
    border: "#CBD5E1",
  },
};

function normalizeText(value, fallback = "", options = {}) {
  if (value === null || value === undefined || typeof value === "object") {
    return fallback;
  }

  const text = String(value).trim().replace(/\s+/g, " ");
  if (!text || text === "NaN" || text === "undefined" || text === "null" || text === "[object Object]") {
    return fallback;
  }

  const maxLength = options.maxLength || 120;
  const characters = Array.from(text);
  if (characters.length <= maxLength) {
    return text;
  }

  return `${characters.slice(0, Math.max(0, maxLength - 3)).join("")}...`;
}

function toFiniteNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function createText(text, options = {}) {
  return {
    type: "text",
    text,
    wrap: true,
    ...options,
  };
}

function normalizeAdminName(value, type) {
  const text = normalizeText(value, "", { maxLength: 80 });
  if (!text) {
    return "";
  }

  const prefixPattern = type === "tambon"
    ? /^(?:ตำบล|ต\.?)\s*/u
    : /^(?:อำเภอ|อ\.?)\s*/u;
  return text.replace(prefixPattern, "").trim();
}

function formatLocation(analysis) {
  const location = analysis && typeof analysis === "object" ? analysis.location || {} : {};
  const tambon = normalizeAdminName(location.tambon, "tambon");
  const amphoe = normalizeAdminName(location.amphoe, "amphoe");
  const parts = [];

  if (tambon) {
    parts.push(`ต.${tambon}`);
  }
  if (amphoe) {
    parts.push(`อ.${amphoe}`);
  }

  return parts.length ? parts.join(" ") : LOCATION_FALLBACK;
}

function normalizeSuitabilityResult(value) {
  const code = normalizeText(value?.class).toUpperCase();
  return SUITABILITY_STYLES[code] || SUITABILITY_STYLES.NO_DATA;
}

function formatSoilSeries(analysis) {
  const soil = analysis && typeof analysis === "object" ? analysis.soil || {} : {};
  const name = normalizeText(soil.soilNameThai || soil.name || soil.soilSeries, "", { maxLength: 80 });
  const code = normalizeText(
    soil.soilSymbol || soil.soilCode || soil.seriesCode || (!name ? soil.seriesNo : ""),
    "",
    { maxLength: 24 },
  );

  if (!name && !code) {
    return NO_DATA_TEXT;
  }
  if (!name) {
    return code;
  }
  if (!code) {
    return name;
  }

  const escapedCode = code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (
    new RegExp(`\\(${escapedCode}\\)`, "iu").test(name) ||
    new RegExp(`(?:^|\\s)${escapedCode}(?:\\s|$)`, "iu").test(name)
  ) {
    return name;
  }

  return `${name} (${code})`;
}

function getPeriodYears(dataPeriod) {
  const totalYears = toFiniteNumber(dataPeriod?.totalYears);
  if (Number.isInteger(totalYears) && totalYears > 0) {
    return totalYears;
  }

  const startYear = toFiniteNumber(dataPeriod?.startYear);
  const endYear = toFiniteNumber(dataPeriod?.endYear);
  if (
    Number.isInteger(startYear) &&
    Number.isInteger(endYear) &&
    endYear >= startYear
  ) {
    return endYear - startYear + 1;
  }

  return null;
}

function formatThaiDateTime(value) {
  if (typeof value !== "string" && !(value instanceof Date)) {
    return "";
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat("th-TH-u-ca-buddhist", {
    timeZone: "Asia/Bangkok",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date).replace(",", "");
}

function normalizeHazardStatus(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return HAZARD_STATUS.UNKNOWN;
  }

  const status = normalizeText(value.status).toLowerCase();
  if (status === "detected" || status === "available") {
    return HAZARD_STATUS.AVAILABLE;
  }
  if (status === "none_detected" || status === "no_history" || status === "not_detected") {
    return HAZARD_STATUS.NO_HISTORY;
  }
  if (status === "unavailable") {
    return HAZARD_STATUS.UNAVAILABLE;
  }
  if (status === "no_coverage" || status === "outside_service_area" || status === "unsupported") {
    return HAZARD_STATUS.NO_COVERAGE;
  }

  return HAZARD_STATUS.UNKNOWN;
}

function formatHazardYearRange(dataPeriod) {
  const startYear = toFiniteNumber(dataPeriod?.startYear);
  const endYear = toFiniteNumber(dataPeriod?.endYear);
  if (
    Number.isInteger(startYear) &&
    Number.isInteger(endYear) &&
    endYear >= startYear
  ) {
    return `${startYear}-${endYear}`;
  }
  return "";
}

function formatFloodSummary(analysis) {
  const flood = analysis?.hazardHistory?.floodRecurrence;
  const status = normalizeHazardStatus(flood);

  if (status === HAZARD_STATUS.UNAVAILABLE) {
    return "ยังไม่สามารถตรวจสอบประวัติน้ำท่วมซ้ำซากได้ในขณะนี้";
  }
  if (status === HAZARD_STATUS.NO_HISTORY) {
    return "ไม่พบประวัติน้ำท่วมซ้ำซากในพื้นที่นี้";
  }
  if (status === HAZARD_STATUS.NO_COVERAGE) {
    return "ยังไม่มีข้อมูลประวัติน้ำท่วมซ้ำซากสำหรับพื้นที่นี้";
  }

  if (status === HAZARD_STATUS.AVAILABLE) {
    const detectedYears = Array.isArray(flood.yearsDetected) ? flood.yearsDetected.length : null;
    const frequency = toFiniteNumber(flood.frequency);
    const detectedCount = detectedYears !== null ? detectedYears : frequency;
    const yearRange = formatHazardYearRange(flood.dataPeriod);

    if (detectedCount > 0) {
      return yearRange
        ? `พบประวัติน้ำท่วมซ้ำซาก ${detectedCount} ปี จากข้อมูลย้อนหลังช่วงปี ${yearRange}`
        : `พบประวัติน้ำท่วมซ้ำซาก ${detectedCount} ปี`;
    }
    return "พบประวัติน้ำท่วมซ้ำซาก";
  }

  return HAZARD_UNKNOWN_TEXT;
}

function getDroughtOccurrenceCount(drought) {
  const total = toFiniteNumber(drought?.totalOccurrences);
  if (total !== null) {
    return total;
  }
  if (Array.isArray(drought?.yearsDetected)) {
    return drought.yearsDetected.length;
  }
  return null;
}

function formatDroughtLevel(value) {
  const level = normalizeText(value, "", { maxLength: 40 });
  if (!level) {
    return "";
  }
  return level.replace(/^ระดับ\s*/u, "");
}

function getDroughtLevelFromOccurrences(count, windowYears) {
  if (!Number.isFinite(count) || count <= 0) {
    return "";
  }

  const denominator = Number.isFinite(windowYears) && windowYears > 0 ? windowYears : 10;
  const ratio = count / denominator;
  if (ratio >= 0.6) {
    return "สูง";
  }
  if (ratio >= 0.3) {
    return "ปานกลาง";
  }
  return "ต่ำ";
}

function formatDroughtSummary(analysis) {
  const drought = analysis?.hazardHistory?.droughtRecurrence;
  const status = normalizeHazardStatus(drought);

  if (status === HAZARD_STATUS.UNAVAILABLE) {
    return "ยังไม่สามารถตรวจสอบประวัติภัยแล้งซ้ำซากได้ในขณะนี้";
  }
  if (status === HAZARD_STATUS.NO_HISTORY) {
    return "ไม่พบประวัติภัยแล้งซ้ำซากในพื้นที่นี้";
  }
  if (status === HAZARD_STATUS.NO_COVERAGE) {
    return "ยังไม่มีข้อมูลประวัติภัยแล้งซ้ำซากสำหรับพื้นที่นี้";
  }

  if (status === HAZARD_STATUS.AVAILABLE) {
    const explicitLevel = formatDroughtLevel(drought.level || drought.severity || drought.riskLevel);
    const count = getDroughtOccurrenceCount(drought);
    const windowYears = getPeriodYears(drought.dataPeriod);
    const level = explicitLevel || getDroughtLevelFromOccurrences(count, windowYears);
    const yearRange = formatHazardYearRange(drought.dataPeriod);

    if (count !== null && count > 0) {
      return yearRange
        ? `พบประวัติภัยแล้งซ้ำซาก ${count} ปี จากข้อมูลย้อนหลังช่วงปี ${yearRange}`
        : `พบประวัติภัยแล้งซ้ำซาก ${count} ปี`;
    }
    if (level) {
      return `พบประวัติภัยแล้งซ้ำซากระดับ${level}`;
    }
    return "พบประวัติภัยแล้งซ้ำซากระดับตำบล";
  }

  return HAZARD_UNKNOWN_TEXT;
}

function formatTemperature(analysis) {
  const weather = analysis?.weather;
  if (!weather || weather.status !== "AVAILABLE") {
    return NO_DATA_TEXT;
  }

  const number = toFiniteNumber(weather.temperatureC);
  if (number === null) {
    return NO_DATA_TEXT;
  }

  return `${Number.isInteger(number) ? number.toFixed(0) : number.toFixed(1)} °C`;
}

function formatRainProbability(analysis) {
  const weather = analysis?.weather;
  if (!weather || weather.status !== "AVAILABLE") {
    return NO_DATA_TEXT;
  }

  const number = toFiniteNumber(weather.nextHourPrecipitationProbabilityPercent);
  if (number === null || number < 0 || number > 100) {
    return NO_DATA_TEXT;
  }

  return `${Math.round(number)}%`;
}

function createCropCard(title, suitability) {
  const codeSize = suitability.code === NO_DATA_TEXT ? "xl" : "3xl";
  return {
    type: "box",
    layout: "vertical",
    backgroundColor: suitability.cardBackground,
    borderColor: suitability.border,
    borderWidth: "normal",
    cornerRadius: "md",
    paddingAll: "12px",
    spacing: "sm",
    contents: [
      createText(title, {
        size: "md",
        weight: "bold",
        color: suitability.mainColor,
        align: "center",
      }),
      {
        type: "box",
        layout: "vertical",
        backgroundColor: suitability.badgeBackground,
        cornerRadius: "xl",
        paddingAll: "8px",
        contents: [
          createText(suitability.code, {
            size: codeSize,
            weight: "bold",
            color: suitability.badgeText,
            align: "center",
          }),
        ],
      },
      createText(suitability.label, {
        size: "sm",
        weight: "bold",
        color: suitability.mainColor,
        align: "center",
      }),
    ],
  };
}

function createDetailRow(label, value) {
  return {
    type: "box",
    layout: "horizontal",
    spacing: "md",
    contents: [
      createText(label, {
        size: "sm",
        color: "#6B7280",
        flex: 4,
      }),
      createText(value, {
        size: "sm",
        weight: "bold",
        color: "#111827",
        align: "end",
        flex: 5,
      }),
    ],
  };
}

function createHazardBlock(title, value) {
  return {
    type: "box",
    layout: "vertical",
    spacing: "xs",
    contents: [
      createText(title, {
        size: "sm",
        weight: "bold",
        color: "#374151",
      }),
      createText(value, {
        size: "sm",
        color: "#111827",
      }),
    ],
  };
}

function collectHazardSources(flood, drought) {
  return [flood, drought]
    .map((item) => normalizeText(item?.source, HAZARD_SOURCE_FALLBACK, { maxLength: 40 }))
    .filter(Boolean)
    .filter((source, index, sources) => sources.indexOf(source) === index);
}

function getHazardCheckedAt(flood, drought) {
  return formatThaiDateTime(flood?.checkedAt) || formatThaiDateTime(drought?.checkedAt);
}

function createHazardHistorySection(analysis) {
  const flood = analysis?.hazardHistory?.floodRecurrence;
  const drought = analysis?.hazardHistory?.droughtRecurrence;
  const sources = collectHazardSources(flood, drought);
  const checkedAt = getHazardCheckedAt(flood, drought);
  const meta = [];

  if (sources.length === 1) {
    meta.push(`แหล่งข้อมูล: ${sources[0]}`);
  } else if (sources.length > 1) {
    meta.push(`แหล่งข้อมูลน้ำท่วม: ${sources[0]}`);
    meta.push(`แหล่งข้อมูลภัยแล้ง: ${sources[1]}`);
  }
  if (checkedAt) {
    meta.push(`ตรวจสอบเมื่อ: ${checkedAt}`);
  }

  return {
    type: "box",
    layout: "vertical",
    spacing: "sm",
    margin: "md",
    contents: [
      createText("ประวัติภัยของพื้นที่", {
        size: "sm",
        weight: "bold",
        color: "#111827",
      }),
      createHazardBlock("ข้อมูลน้ำท่วม", formatFloodSummary(analysis)),
      createHazardBlock("ข้อมูลภัยแล้ง", formatDroughtSummary(analysis)),
      createText(DROUGHT_NOTE, {
        size: "xs",
        color: "#64748B",
        margin: "xs",
      }),
      ...meta.map((text) => createText(text, {
        size: "xs",
        color: "#64748B",
        margin: "xs",
      })),
    ],
  };
}

function validateDetailUrl(value) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) {
    throw new TypeError("detailUrl must be a non-empty absolute HTTPS URL");
  }

  let parsed;
  try {
    parsed = new URL(text);
  } catch (error) {
    throw new TypeError("detailUrl must be a non-empty absolute HTTPS URL");
  }

  if (parsed.protocol !== "https:") {
    throw new TypeError("detailUrl must be a non-empty absolute HTTPS URL");
  }

  return text;
}

function createAltText({ locationText, rice, maize }) {
  return normalizeText(
    `ผลความเหมาะสมพื้นที่ ${locationText}: ข้าว ${rice.code}, ข้าวโพด ${maize.code}`,
    "ผลสรุปความเหมาะสมของพื้นที่",
    { maxLength: 250 },
  );
}

function createLocationSummaryFlexMessage(analysis, options = {}) {
  const detailUrl = validateDetailUrl(options.detailUrl);
  const locationText = formatLocation(analysis);
  const rice = normalizeSuitabilityResult(analysis?.riceLandSuitability);
  const maize = normalizeSuitabilityResult(analysis?.maizeLandSuitability);
  const altText = createAltText({ locationText, rice, maize });

  return {
    type: "flex",
    altText,
    contents: {
      type: "bubble",
      size: "mega",
      header: {
        type: "box",
        layout: "vertical",
        backgroundColor: HEADER_COLOR,
        paddingAll: "16px",
        contents: [
          createText(HEADER_TITLE, {
            color: "#FFFFFF",
            size: "lg",
            weight: "bold",
          }),
          createText(locationText, {
            color: "#E7F5DF",
            size: "sm",
            margin: "sm",
          }),
        ],
      },
      body: {
        type: "box",
        layout: "vertical",
        paddingAll: "16px",
        spacing: "md",
        contents: [
          createCropCard("ข้าว", rice),
          createCropCard("ข้าวโพด", maize),
          {
            type: "separator",
            margin: "lg",
          },
          {
            type: "box",
            layout: "vertical",
            spacing: "sm",
            margin: "lg",
            contents: [
              createDetailRow("ชุดดิน", formatSoilSeries(analysis)),
              createHazardHistorySection(analysis),
              createDetailRow("อุณหภูมิ", formatTemperature(analysis)),
              createDetailRow("ฝนในอีก 1 ชม.", formatRainProbability(analysis)),
            ],
          },
        ],
      },
      footer: {
        type: "box",
        layout: "vertical",
        backgroundColor: HEADER_COLOR,
        paddingAll: "8px",
        contents: [
          {
            type: "button",
            style: "link",
            height: "sm",
            color: "#FFFFFF",
            action: {
              type: "uri",
              label: "ดูรายละเอียดพื้นที่",
              uri: detailUrl,
            },
          },
        ],
      },
    },
  };
}

module.exports = {
  createLocationSummaryFlexMessage,
};
