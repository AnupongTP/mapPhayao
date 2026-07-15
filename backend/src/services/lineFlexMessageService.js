const NO_DATA_TEXT = "ไม่มีข้อมูล";
const HEADER_TITLE = "ผลตรวจความเหมาะสมของพื้นที่";
const HEADER_COLOR = "#2F6F10";
const LOCATION_FALLBACK = "ไม่พบข้อมูลตำแหน่ง";
const DROUGHT_NOTE = "ข้อมูลภัยแล้งเป็นข้อมูลสรุประดับตำบล";

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

function formatYearWindowText(prefix, windowYears) {
  return windowYears ? `${prefix}ใน ${windowYears} ปี` : prefix.trim();
}

function formatFloodSummary(analysis) {
  const flood = analysis?.hazardHistory?.floodRecurrence;
  if (!flood || flood.status === "unavailable") {
    return NO_DATA_TEXT;
  }

  const windowYears = getPeriodYears(flood.dataPeriod);
  const detectedYears = Array.isArray(flood.yearsDetected) ? flood.yearsDetected.length : null;
  const frequency = toFiniteNumber(flood.frequency);
  const detectedCount = detectedYears !== null ? detectedYears : frequency;

  if (flood.status === "detected" && detectedCount > 0) {
    return formatYearWindowText(`พบ ${detectedCount} ปี`, windowYears);
  }

  if (flood.status === "none_detected" || detectedCount === 0) {
    return formatYearWindowText("ไม่พบ", windowYears);
  }

  return NO_DATA_TEXT;
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
  if (!drought || drought.status === "unavailable") {
    return NO_DATA_TEXT;
  }

  const explicitLevel = formatDroughtLevel(drought.level || drought.severity || drought.riskLevel);
  const count = getDroughtOccurrenceCount(drought);
  const windowYears = getPeriodYears(drought.dataPeriod);
  const level = explicitLevel || getDroughtLevelFromOccurrences(count, windowYears);

  if (!level) {
    return NO_DATA_TEXT;
  }

  return `ระดับ${level}`;
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
              createDetailRow("ข้อมูลน้ำท่วม", formatFloodSummary(analysis)),
              createDetailRow("ข้อมูลภัยแล้ง", formatDroughtSummary(analysis)),
              createDetailRow("อุณหภูมิ", formatTemperature(analysis)),
              createDetailRow("ฝนในอีก 1 ชม.", formatRainProbability(analysis)),
              createText(DROUGHT_NOTE, {
                size: "xs",
                color: "#64748B",
                margin: "sm",
              }),
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
