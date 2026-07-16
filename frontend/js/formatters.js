(function (window) {
  const EMPTY_TEXT = "ไม่มีข้อมูล";
  const NOT_EVALUATED_TEXT = "ยังไม่ได้ประเมิน";
  const PARCEL_EMPTY_TEXT = "—";
  const THAI_SHORT_MONTHS = [
    "ม.ค.",
    "ก.พ.",
    "มี.ค.",
    "เม.ย.",
    "พ.ค.",
    "มิ.ย.",
    "ก.ค.",
    "ส.ค.",
    "ก.ย.",
    "ต.ค.",
    "พ.ย.",
    "ธ.ค.",
  ];

  const drainageLabels = {
    "ดีมาก": "ระบายน้ำได้ดีมาก",
    ดี: "ระบายน้ำได้ดี",
    "ค่อนข้างดี": "ระบายน้ำได้ค่อนข้างดี",
    ปานกลาง: "ระบายน้ำได้ปานกลาง",
    "ค่อนข้างเลว": "ระบายน้ำได้ค่อนข้างแย่",
    เลว: "ระบายน้ำได้แย่",
    "เลวมาก": "ระบายน้ำได้แย่มาก",
  };

  const statusLabels = {
    AVAILABLE: "มีข้อมูลพร้อมใช้งาน",
    PARTIAL_DATA: "มีข้อมูลดินบางส่วน",
    NO_DATA: "ไม่พบข้อมูลดินที่เพียงพอ",
    NOT_EVALUATED: NOT_EVALUATED_TEXT,
    PARTIALLY_EVALUATED: "ประเมินบางส่วน",
  };

  const ruleStatusLabels = {
    EVALUATED: "ประเมินด้วยเกณฑ์ที่ผ่านการตรวจสอบแล้ว",
    VERIFIED: "ตรวจสอบแล้ว",
    NOT_EVALUATED: "ยังไม่สามารถประเมินได้",
    PARTIAL_DATA: "ข้อมูลดินบางส่วนยังไม่ครบ",
    NO_DATA: "ไม่พบข้อมูลดินที่เพียงพอ",
    NO_RULE: "ยังไม่มีเกณฑ์ที่ตรวจสอบแล้ว",
    RULE_SET_INACTIVE: "มีเกณฑ์ในระบบแต่ยังไม่ได้เปิดใช้งาน",
  };

  function formatValue(value) {
    if (
      value === null ||
      value === undefined ||
      String(value).trim() === "" ||
      String(value).trim() === "NaN"
    ) {
      return EMPTY_TEXT;
    }

    if (typeof value === "object") {
      return EMPTY_TEXT;
    }

    return String(value).trim().replace(/\s+/g, " ");
  }

  function formatCoordinate(value) {
    const coordinate = Number(value);
    if (!Number.isFinite(coordinate)) {
      return EMPTY_TEXT;
    }
    return coordinate.toFixed(6);
  }

  function formatDistance(value) {
    const distance = Number(value);
    if (!Number.isFinite(distance)) {
      return EMPTY_TEXT;
    }

    if (distance >= 1000) {
      return `${(distance / 1000).toFixed(2)} กิโลเมตร`;
    }

    return `${distance.toFixed(2)} เมตร`;
  }

  function formatPercent(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return EMPTY_TEXT;
    }

    return `${number.toLocaleString("th-TH", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    })}%`;
  }

  function formatList(value) {
    if (!Array.isArray(value) || value.length === 0) {
      return EMPTY_TEXT;
    }

    const items = value
      .map((item) => formatValue(item))
      .filter((item) => item !== EMPTY_TEXT);

    return items.length ? items.join(", ") : EMPTY_TEXT;
  }

  function formatCentimeters(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return EMPTY_TEXT;
    }

    return `${number.toLocaleString("th-TH", {
      maximumFractionDigits: 0,
    })} ซม.`;
  }

  function formatAccuracy(value) {
    const accuracy = Number(value);
    if (!Number.isFinite(accuracy)) {
      return "ไม่ได้ใช้ข้อมูล GPS";
    }

    if (accuracy >= 1000) {
      return `${(accuracy / 1000).toFixed(2)} กิโลเมตร`;
    }

    return `${accuracy.toFixed(2)} เมตร`;
  }

  function formatDrainage(value) {
    if (value === null || value === undefined) {
      return EMPTY_TEXT;
    }

    const original = String(value).trim().replace(/\s+/g, " ");
    if (!original) {
      return EMPTY_TEXT;
    }

    const normalized = original.replace(/^การระบายน้ำ\s*/u, "").trim();
    return drainageLabels[normalized] || original;
  }

  function formatSoilDepth(value) {
    const text = formatValue(value);
    if (
      text === EMPTY_TEXT ||
      text === "ไม่มีข้อมูลความลึกดิน" ||
      text === "ไม่มีข้อมูลความลึกของดิน"
    ) {
      return EMPTY_TEXT;
    }

    return text;
  }

  function formatMissingFields(value) {
    const labels = {
      soilName: "ชื่อชุดดิน",
      drainage: "การระบายน้ำ",
      effectiveDepth: "ความลึกของดิน",
    };

    const fields = Array.isArray(value) ? value : [];
    const formatted = fields
      .map((field) => labels[field] || formatValue(field))
      .filter((field) => field && field !== EMPTY_TEXT);

    return formatted.length ? formatted.join(", ") : EMPTY_TEXT;
  }

  function formatStatus(value) {
    const status = formatValue(value);
    if (status === EMPTY_TEXT) {
      return EMPTY_TEXT;
    }
    return statusLabels[status] || status;
  }

  function formatRuleStatus(value) {
    const status = formatValue(value);
    if (status === EMPTY_TEXT) {
      return EMPTY_TEXT;
    }
    return ruleStatusLabels[status] || status;
  }

  function formatAreaSqm(value) {
    const area = Number(value);
    if (!Number.isFinite(area)) {
      return EMPTY_TEXT;
    }

    return `${area.toLocaleString("th-TH", {
      maximumFractionDigits: 2,
      minimumFractionDigits: 0,
    })} ตร.ม.`;
  }

  function formatAreaRai(value) {
    const area = Number(value);
    if (!Number.isFinite(area)) {
      return EMPTY_TEXT;
    }

    return `${area.toLocaleString("th-TH", {
      maximumFractionDigits: 2,
      minimumFractionDigits: 2,
    })} ไร่`;
  }

  function formatAreaRaiCompact(value) {
    const area = Number(value);
    if (!Number.isFinite(area)) {
      return EMPTY_TEXT;
    }

    return `${area.toLocaleString("th-TH", {
      maximumFractionDigits: 2,
      minimumFractionDigits: 0,
    })} ไร่`;
  }

  function formatThaiLandArea(value) {
    const areaSquareMeters = Number(value);
    if (!Number.isFinite(areaSquareMeters) || areaSquareMeters < 0) {
      return EMPTY_TEXT;
    }

    const totalSquareWahHundredths = Math.round(areaSquareMeters * 25);
    const raiUnit = 40000;
    const nganUnit = 10000;

    const rai = Math.floor(totalSquareWahHundredths / raiUnit);
    let remainder = totalSquareWahHundredths - (rai * raiUnit);
    const ngan = Math.floor(remainder / nganUnit);
    remainder -= ngan * nganUnit;

    const squareWah = remainder / 100;
    const squareWahText = squareWah.toLocaleString("th-TH", {
      maximumFractionDigits: 2,
      minimumFractionDigits: 0,
    });

    return `${rai.toLocaleString("th-TH")} ไร่ ${ngan.toLocaleString("th-TH")} งาน ${squareWahText} ตร.ว.`;
  }

  function formatAreaPercentLine(areaRai, percent, options = {}) {
    const areaText = formatAreaRaiCompact(areaRai);
    const percentText = formatPercent(percent);

    if (areaText === EMPTY_TEXT && percentText === EMPTY_TEXT) {
      return EMPTY_TEXT;
    }
    if (areaText === EMPTY_TEXT) {
      return percentText;
    }
    if (percentText === EMPTY_TEXT) {
      return areaText;
    }

    const suffix = options.includeParcelSuffix ? " ของพื้นที่แปลง" : "";
    return `${areaText} · ${percentText}${suffix}`;
  }

  function formatAreaDetail(areaRai, areaSqm) {
    const raiText = formatAreaRai(areaRai);
    const sqmText = formatAreaSqm(areaSqm);

    if (raiText === EMPTY_TEXT) {
      return sqmText;
    }
    if (sqmText === EMPTY_TEXT) {
      return raiText;
    }
    return `${raiText} (${sqmText})`;
  }

  function formatThaiDate(value) {
    const text = formatValue(value);
    if (text === EMPTY_TEXT) {
      return EMPTY_TEXT;
    }

    const parts = text.split("-");
    if (parts.length !== 3) {
      return text;
    }

    const year = Number(parts[0]);
    const month = Number(parts[1]);
    const day = Number(parts[2]);
    if (!year || month < 1 || month > 12 || day < 1 || day > 31) {
      return text;
    }

    const monthNames = [
      "มกราคม",
      "กุมภาพันธ์",
      "มีนาคม",
      "เมษายน",
      "พฤษภาคม",
      "มิถุนายน",
      "กรกฎาคม",
      "สิงหาคม",
      "กันยายน",
      "ตุลาคม",
      "พฤศจิกายน",
      "ธันวาคม",
    ];

    return `${day} ${monthNames[month - 1]} ${year + 543}`;
  }

  function getCropTypeLabel(value) {
    if (value === null || value === undefined) {
      return PARCEL_EMPTY_TEXT;
    }

    const text = String(value).trim().replace(/\s+/g, " ");
    if (!text) {
      return PARCEL_EMPTY_TEXT;
    }

    const normalized = text.toLowerCase();
    if (normalized === "rice") {
      return "ข้าว";
    }
    if (normalized === "maize") {
      return "ข้าวโพด";
    }

    return text;
  }

  function formatThaiDateOnly(value) {
    if (value === null || value === undefined) {
      return PARCEL_EMPTY_TEXT;
    }

    const text = String(value).trim();
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    if (!match) {
      return PARCEL_EMPTY_TEXT;
    }

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
      !Number.isInteger(year) ||
      !Number.isInteger(month) ||
      !Number.isInteger(day) ||
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day
    ) {
      return PARCEL_EMPTY_TEXT;
    }

    return `${day} ${THAI_SHORT_MONTHS[month - 1]} ${year + 543}`;
  }

  function formatThaiDateTime(value) {
    if (value === null || value === undefined || String(value).trim() === "") {
      return PARCEL_EMPTY_TEXT;
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return PARCEL_EMPTY_TEXT;
    }

    return new Intl.DateTimeFormat("th-TH-u-ca-buddhist-nu-latn", {
      timeZone: "Asia/Bangkok",
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(date);
  }

  window.MapFormatters = {
    EMPTY_TEXT,
    NOT_EVALUATED_TEXT,
    PARCEL_EMPTY_TEXT,
    formatValue,
    formatCoordinate,
    formatDistance,
    formatPercent,
    formatList,
    formatCentimeters,
    formatAccuracy,
    formatDrainage,
    formatSoilDepth,
    formatMissingFields,
    formatStatus,
    formatRuleStatus,
    formatAreaSqm,
    formatAreaRai,
    formatAreaRaiCompact,
    formatThaiLandArea,
    formatAreaPercentLine,
    formatAreaDetail,
    formatThaiDate,
    getCropTypeLabel,
    formatThaiDateOnly,
    formatThaiDateTime,
  };
})(window);
