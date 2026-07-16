const NO_DATA_TEXT = "ไม่มีข้อมูล";
const EMPTY_TEXT = "—";
const HEADER_TITLE = "ผลตรวจความเหมาะสมของพื้นที่";
const HEADER_COLOR = "#287A12";
const LOCATION_FALLBACK = "ไม่พบข้อมูลตำแหน่ง";
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
    mainColor: "#15803D",
    scoreColor: "#166534",
    cardBackground: "#F0FDF4",
    border: "#86D69A",
  },
  S2: {
    code: "S2",
    label: "เหมาะสมปานกลาง",
    mainColor: "#A16207",
    scoreColor: "#92400E",
    cardBackground: "#FFFBEA",
    border: "#EACD69",
  },
  S3: {
    code: "S3",
    label: "เหมาะสมน้อย",
    mainColor: "#AF4B08",
    scoreColor: "#9B3305",
    cardBackground: "#FFF9EE",
    border: "#F1C974",
  },
  N: {
    code: "N",
    label: "ไม่เหมาะสม",
    mainColor: "#B42323",
    scoreColor: "#A71919",
    cardBackground: "#FFF7F7",
    border: "#F3B8B8",
  },
  NO_DATA: {
    code: EMPTY_TEXT,
    label: "ยังไม่มีผลประเมิน",
    mainColor: "#4B5563",
    scoreColor: "#374151",
    cardBackground: "#F7F8FA",
    border: "#D1D5DB",
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

function formatAdministrativeSubtitle(analysis) {
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

  return parts.join(" ");
}

function formatLocation(analysis) {
  return formatAdministrativeSubtitle(analysis) || LOCATION_FALLBACK;
}

function normalizeSuitabilityResult(value) {
  const code = normalizeText(value?.class).toUpperCase();
  return SUITABILITY_STYLES[code] || SUITABILITY_STYLES.NO_DATA;
}

function getSuitabilityStyle(suitability) {
  return suitability && typeof suitability === "object" ? suitability : SUITABILITY_STYLES.NO_DATA;
}

function getSoilInfo(analysis) {
  const soil = analysis && typeof analysis === "object" ? analysis.soil || {} : {};
  const name = normalizeText(soil.soilNameThai || soil.name || soil.soilSeries, "", { maxLength: 80 });
  const code = normalizeText(
    soil.soilSymbol || soil.soilCode || soil.seriesCode || (!name ? soil.seriesNo : ""),
    "",
    { maxLength: 24 },
  );
  const detail = normalizeText(
    soil.drainageDescriptionThai ||
      soil.depthDescriptionThai ||
      soil.surfaceTextureThai ||
      soil.description ||
      soil.condition,
    "",
    { maxLength: 120 },
  );

  if (!name && !code) {
    return {
      title: "",
      detail,
      hasData: Boolean(detail),
    };
  }
  if (!name) {
    return { title: code, detail, hasData: true };
  }
  if (!code) {
    return { title: name, detail, hasData: true };
  }

  const escapedCode = code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (
    new RegExp(`\\(${escapedCode}\\)`, "iu").test(name) ||
    new RegExp(`(?:^|\\s)${escapedCode}(?:\\s|$)`, "iu").test(name)
  ) {
    return { title: name, detail, hasData: true };
  }

  return { title: `${name} (${code})`, detail, hasData: true };
}

function formatSoilSeries(analysis) {
  const soil = getSoilInfo(analysis);
  return soil.title || soil.detail || NO_DATA_TEXT;
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
  return formatFloodHazard(flood).summary;
}

function formatFloodHazard(flood) {
  const status = normalizeHazardStatus(flood);

  if (status === HAZARD_STATUS.UNAVAILABLE) {
    return { summary: "ยังไม่สามารถตรวจสอบประวัติน้ำท่วมซ้ำซากได้ในขณะนี้", detail: "" };
  }
  if (status === HAZARD_STATUS.NO_HISTORY) {
    return { summary: "ไม่พบประวัติน้ำท่วมซ้ำซากในพื้นที่นี้", detail: "" };
  }
  if (status === HAZARD_STATUS.NO_COVERAGE) {
    return { summary: "ไม่มีข้อมูลครอบคลุมพื้นที่นี้", detail: "" };
  }

  if (status === HAZARD_STATUS.AVAILABLE) {
    const detectedYears = Array.isArray(flood.yearsDetected) ? flood.yearsDetected.length : null;
    const frequency = toFiniteNumber(flood.frequency);
    const detectedCount = detectedYears !== null ? detectedYears : frequency;
    const yearRange = formatHazardYearRange(flood.dataPeriod);

    if (detectedCount > 0) {
      return {
        summary: `พบประวัติน้ำท่วมซ้ำซาก ${detectedCount} ปี`,
        detail: yearRange ? `จากข้อมูลย้อนหลังช่วงปี ${yearRange}` : "",
      };
    }
    return { summary: "พบประวัติน้ำท่วมซ้ำซาก", detail: "" };
  }

  return { summary: HAZARD_UNKNOWN_TEXT, detail: "" };
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
  return formatDroughtHazard(drought).summary;
}

function formatDroughtHazard(drought) {
  const status = normalizeHazardStatus(drought);

  if (status === HAZARD_STATUS.UNAVAILABLE) {
    return { summary: "ยังไม่สามารถตรวจสอบประวัติภัยแล้งซ้ำซากได้ในขณะนี้", detail: "" };
  }
  if (status === HAZARD_STATUS.NO_HISTORY) {
    return { summary: "ไม่พบประวัติภัยแล้งซ้ำซากในพื้นที่นี้", detail: "" };
  }
  if (status === HAZARD_STATUS.NO_COVERAGE) {
    return { summary: "ไม่มีข้อมูลครอบคลุมพื้นที่นี้", detail: "" };
  }

  if (status === HAZARD_STATUS.AVAILABLE) {
    const explicitLevel = formatDroughtLevel(drought.level || drought.severity || drought.riskLevel);
    const count = getDroughtOccurrenceCount(drought);
    const windowYears = getPeriodYears(drought.dataPeriod);
    const level = explicitLevel || getDroughtLevelFromOccurrences(count, windowYears);
    const yearRange = formatHazardYearRange(drought.dataPeriod);

    if (count !== null && count > 0) {
      return {
        summary: `พบประวัติภัยแล้งซ้ำซาก ${count} ปี`,
        detail: yearRange ? `จากข้อมูลย้อนหลังช่วงปี ${yearRange}` : "",
      };
    }
    if (level) {
      return { summary: `พบประวัติภัยแล้งซ้ำซากระดับ${level}`, detail: "" };
    }
    return { summary: "พบประวัติภัยแล้งซ้ำซากระดับตำบล", detail: "" };
  }

  return { summary: HAZARD_UNKNOWN_TEXT, detail: "" };
}

function formatTemperature(analysis) {
  const weather = analysis?.weather;
  if (!weather || weather.status !== "AVAILABLE") {
    return EMPTY_TEXT;
  }

  const number = toFiniteNumber(weather.temperatureC);
  if (number === null) {
    return EMPTY_TEXT;
  }

  return `${Number.isInteger(number) ? number.toFixed(0) : number.toFixed(1)} °C`;
}

function formatRainProbability(analysis) {
  const weather = analysis?.weather;
  if (!weather || weather.status !== "AVAILABLE") {
    return EMPTY_TEXT;
  }

  const number = toFiniteNumber(weather.nextHourPrecipitationProbabilityPercent);
  if (number === null || number < 0 || number > 100) {
    return EMPTY_TEXT;
  }

  return `${Math.round(number)}%`;
}

function createCropCard(title, suitability) {
  const style = getSuitabilityStyle(suitability);
  return {
    type: "box",
    layout: "vertical",
    flex: 1,
    backgroundColor: style.cardBackground,
    borderColor: style.border,
    borderWidth: "1px",
    cornerRadius: "12px",
    paddingAll: "12px",
    contents: [
      createText(title, {
        size: "md",
        weight: "bold",
        color: style.mainColor,
        align: "center",
      }),
      createText(style.code, {
        size: style.code === EMPTY_TEXT ? "xl" : "3xl",
        weight: "bold",
        color: style.scoreColor,
        align: "center",
        margin: "md",
      }),
      createText(style.label, {
        size: "sm",
        weight: "bold",
        color: style.mainColor,
        align: "center",
        margin: "sm",
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
    backgroundColor: "#F7F8FA",
    cornerRadius: "10px",
    paddingAll: "12px",
    contents: [
      createText(title, {
        size: "sm",
        weight: "bold",
        color: "#1F2937",
      }),
      createText(value, {
        size: "sm",
        color: "#374151",
        margin: "sm",
      }),
    ],
  };
}

function createHazardCard(title, hazard) {
  const contents = [
    createText(title, {
      size: "sm",
      weight: "bold",
      color: "#1F2937",
    }),
    createText(hazard.summary, {
      size: "sm",
      color: "#374151",
      margin: "sm",
    }),
  ];

  if (hazard.detail) {
    contents.push(createText(hazard.detail, {
      size: "xs",
      color: "#6B7280",
      margin: "sm",
    }));
  }

  return {
    type: "box",
    layout: "vertical",
    backgroundColor: "#F7F8FA",
    cornerRadius: "10px",
    paddingAll: "12px",
    contents,
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

function createSoilSection(analysis) {
  const soil = getSoilInfo(analysis);
  const contents = [
    createText("ข้อมูลดิน", {
      weight: "bold",
      size: "md",
      color: "#1F2937",
    }),
  ];

  if (soil.hasData) {
    if (soil.title) {
      contents.push(createText(soil.title, {
        weight: "bold",
        size: "sm",
        color: "#111827",
        margin: "md",
      }));
    }
    if (soil.detail) {
      contents.push(createText(soil.detail, {
        size: "sm",
        color: "#4B5563",
        margin: "sm",
      }));
    }
  } else {
    contents.push(createText("ยังไม่มีข้อมูลดินสำหรับตำแหน่งนี้", {
      size: "sm",
      color: "#4B5563",
      margin: "md",
    }));
  }

  return {
    type: "box",
    layout: "vertical",
    backgroundColor: "#F7F8FA",
    cornerRadius: "12px",
    paddingAll: "14px",
    contents,
  };
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
        size: "md",
        weight: "bold",
        color: "#1F2937",
      }),
      createHazardCard("ข้อมูลน้ำท่วม", formatFloodHazard(flood)),
      createHazardCard("ข้อมูลภัยแล้ง", formatDroughtHazard(drought)),
      ...meta.map((text) => createText(text, {
        size: "xs",
        color: "#6B7280",
        margin: "sm",
      })),
    ],
  };
}

function createWeatherRow(label, value) {
  return {
    type: "box",
    layout: "horizontal",
    contents: [
      createText(label, {
        size: "sm",
        color: "#6B7280",
        flex: 1,
      }),
      createText(value, {
        size: "sm",
        weight: "bold",
        color: "#111827",
        align: "end",
        flex: 1,
      }),
    ],
  };
}

function createWeatherSection(analysis) {
  return {
    type: "box",
    layout: "vertical",
    spacing: "sm",
    contents: [
      createText("สภาพอากาศ", {
        weight: "bold",
        size: "md",
        color: "#1F2937",
      }),
      createWeatherRow("อุณหภูมิ", formatTemperature(analysis)),
      createWeatherRow("ฝนในอีก 1 ชม.", formatRainProbability(analysis)),
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

function createAltText() {
  return HEADER_TITLE;
}

function createLocationSummaryFlexMessage(analysis, options = {}) {
  const detailUrl = validateDetailUrl(options.detailUrl);
  const subtitle = formatAdministrativeSubtitle(analysis);
  const rice = normalizeSuitabilityResult(analysis?.riceLandSuitability);
  const maize = normalizeSuitabilityResult(analysis?.maizeLandSuitability);
  const altText = createAltText();
  const headerContents = [
    createText(HEADER_TITLE, {
      color: "#FFFFFF",
      size: "xl",
      weight: "bold",
    }),
  ];

  if (subtitle) {
    headerContents.push(createText(subtitle, {
      color: "#E8F5E5",
      size: "sm",
      margin: "sm",
    }));
  }

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
        paddingAll: "18px",
        contents: headerContents,
      },
      body: {
        type: "box",
        layout: "vertical",
        paddingAll: "16px",
        spacing: "md",
        contents: [
          {
            type: "box",
            layout: "horizontal",
            spacing: "sm",
            contents: [
              createCropCard("ข้าว", rice),
              createCropCard("ข้าวโพด", maize),
            ],
          },
          {
            type: "separator",
            margin: "md",
            color: "#E5E7EB",
          },
          createSoilSection(analysis),
          createHazardHistorySection(analysis),
          {
            type: "separator",
            margin: "md",
            color: "#E5E7EB",
          },
          createWeatherSection(analysis),
        ],
      },
      footer: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "button",
            style: "primary",
            height: "md",
            color: HEADER_COLOR,
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
