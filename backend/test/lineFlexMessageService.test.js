const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  createLocationSummaryFlexMessage,
} = require("../src/services/lineFlexMessageService");

const DETAIL_URL = "https://example.com/map";
const LONG_PUBLIC_APP_URL = "https://mapphayaoliff.netlify.app";
const LONG_DETAIL_URL =
  `${LONG_PUBLIC_APP_URL}/?lat=19.039846300072156&lng=99.94005686022584`;
const serviceSource = fs.readFileSync(
  path.join(__dirname, "../src/services/lineFlexMessageService.js"),
  "utf8",
);

function sampleAnalysis(overrides = {}) {
  const hasOwn = (key) => Object.prototype.hasOwnProperty.call(overrides, key);
  const mergeOverride = (key, defaults) => {
    if (!hasOwn(key)) {
      return defaults;
    }
    const value = overrides[key];
    return value && typeof value === "object" ? { ...defaults, ...value } : value;
  };
  const hazardOverrides = overrides.hazardHistory || {};
  const mergeHazardOverride = (key, defaults) => {
    if (!Object.prototype.hasOwnProperty.call(hazardOverrides, key)) {
      return defaults;
    }
    const value = hazardOverrides[key];
    return value && typeof value === "object" ? { ...defaults, ...value } : value;
  };

  return {
    success: true,
    found: true,
    location: mergeOverride("location", {
      tambon: "แม่กา",
      amphoe: "เมืองพะเยา",
      province: "พะเยา",
    }),
    soil: mergeOverride("soil", {
      soilNameThai: "ชุดพะเยา",
      soilSymbol: "Pg",
    }),
    riceLandSuitability: mergeOverride("riceLandSuitability", {
      class: "S1",
      label: "เหมาะสมมาก",
      status: "AVAILABLE",
    }),
    maizeLandSuitability: mergeOverride("maizeLandSuitability", {
      class: "S2",
      label: "เหมาะสมปานกลาง",
      status: "AVAILABLE",
    }),
    hazardHistory: {
      floodRecurrence: mergeHazardOverride("floodRecurrence", {
        status: "detected",
        frequency: 3,
        yearsDetected: [2020, 2022, 2024],
        dataPeriod: { startYear: 2015, endYear: 2024, totalYears: 10 },
        checkedAt: "2026-07-16T13:57:00.000Z",
        source: "GISTDA",
      }),
      droughtRecurrence: mergeHazardOverride("droughtRecurrence", {
        status: "detected",
        totalOccurrences: 3,
        yearsDetected: [2019, 2021, 2023],
        dataPeriod: { startYear: 2015, endYear: 2024, totalYears: 10 },
        summaryLevel: "tambon",
        checkedAt: "2026-07-16T13:57:00.000Z",
        source: "GISTDA",
      }),
      ...(overrides.hazardHistory || {}),
    },
    weather: mergeOverride("weather", {
      status: "AVAILABLE",
      temperatureC: 24.1,
      nextHourPrecipitationProbabilityPercent: 82,
      nextHourForecastAt: "2026-07-15T01:00:00+07:00",
      source: "Open-Meteo",
    }),
    ...overrides.root,
  };
}

function build(analysis = sampleAnalysis(), options = { detailUrl: DETAIL_URL }) {
  return createLocationSummaryFlexMessage(analysis, options);
}

function walk(value, visitor) {
  visitor(value);
  if (Array.isArray(value)) {
    value.forEach((item) => walk(item, visitor));
    return;
  }
  if (value && typeof value === "object") {
    Object.values(value).forEach((item) => walk(item, visitor));
  }
}

function collectTextValues(value) {
  const texts = [];
  walk(value, (item) => {
    if (item && typeof item === "object" && item.type === "text") {
      texts.push(item.text);
    }
  });
  return texts;
}

function collectTextObjects(value) {
  const texts = [];
  walk(value, (item) => {
    if (item && typeof item === "object" && item.type === "text") {
      texts.push(item);
    }
  });
  return texts;
}

function collectActionValues(value) {
  const actions = [];
  walk(value, (item) => {
    if (item && typeof item === "object" && item.action) {
      actions.push(item.action);
    }
  });
  return actions;
}

function collectUriActions(value) {
  return collectActionValues(value).filter((action) => action.type === "uri");
}

function getBodyContents(message) {
  return message.contents.body.contents;
}

function getSuitabilityRow(message) {
  return getBodyContents(message)[0];
}

function assertTextsInclude(message, expected) {
  const texts = collectTextValues(message);
  expected.forEach((text) => {
    assert.ok(texts.includes(text), `Expected text ${text}`);
  });
}

function assertSerializedDoesNotInclude(message, fragments) {
  const serialized = JSON.stringify(message);
  fragments.forEach((fragment) => {
    assert.equal(serialized.includes(fragment), false, `Unexpected fragment ${fragment}`);
  });
}

function assertNoInvalidJsonValues(value) {
  walk(value, (item) => {
    assert.notEqual(item, undefined);
    assert.notEqual(item, null);
    if (typeof item === "number") {
      assert.equal(Number.isNaN(item), false);
    }
  });
}

test("creates a complete flex message with header, body, footer, and sample template text", () => {
  const message = build();

  assert.equal(message.type, "flex");
  assert.equal(message.altText, "ผลตรวจความเหมาะสมของพื้นที่");
  assert.equal(message.contents.type, "bubble");
  assert.equal(message.contents.size, "mega");
  assert.ok(message.contents.header);
  assert.ok(message.contents.body);
  assert.ok(message.contents.footer);
  assert.equal(message.contents.header.backgroundColor, "#287A12");
  assert.equal(message.contents.header.paddingAll, "18px");
  assert.equal(Object.prototype.hasOwnProperty.call(message.contents.footer, "paddingAll"), false);
  assertTextsInclude(message, [
    "ผลตรวจความเหมาะสมของพื้นที่",
    "ต.แม่กา อ.เมืองพะเยา",
    "ข้าว",
    "S1",
    "เหมาะสมมาก",
    "ข้าวโพด",
    "S2",
    "เหมาะสมปานกลาง",
    "ข้อมูลดิน",
    "ชุดพะเยา (Pg)",
    "ข้อมูลน้ำท่วม",
    "พบประวัติน้ำท่วมซ้ำซาก 3 ปี",
    "จากข้อมูลย้อนหลังช่วงปี 2015-2024",
    "ข้อมูลภัยแล้ง",
    "พบประวัติภัยแล้งซ้ำซาก 3 ปี",
    "อุณหภูมิ",
    "24.1 °C",
    "ฝนในอีก 1 ชม.",
    "82%",
    "แหล่งข้อมูล: GISTDA",
    "ตรวจสอบเมื่อ: 16 ก.ค. 2569 20:57",
  ]);
});

test("keeps rice and maize cards side by side in one compact row", () => {
  const message = build();
  const row = getSuitabilityRow(message);
  const [riceCard, maizeCard] = row.contents;

  assert.equal(row.layout, "horizontal");
  assert.equal(row.spacing, "sm");
  assert.equal(row.contents.length, 2);
  assert.equal(riceCard.flex, 1);
  assert.equal(maizeCard.flex, 1);
  assert.equal(riceCard.layout, "vertical");
  assert.equal(maizeCard.layout, "vertical");
  assert.equal(riceCard.borderWidth, "1px");
  assert.equal(maizeCard.borderWidth, "1px");
  assert.equal(collectTextValues(riceCard).includes("ข้าว"), true);
  assert.equal(collectTextValues(maizeCard).includes("ข้าวโพด"), true);
  assert.notEqual(getBodyContents(message)[1], maizeCard);
  assert.equal(riceCard.contents.some((item) => item.type === "box" && item.backgroundColor), false);
});

test("body contents match the approved section order", () => {
  const contents = getBodyContents(build());

  assert.equal(contents.length, 6);
  assert.equal(contents[0].layout, "horizontal");
  assert.equal(contents[1].type, "separator");
  assert.equal(collectTextValues(contents[2]).includes("ข้อมูลดิน"), true);
  assert.equal(collectTextValues(contents[3]).includes("ประวัติภัยของพื้นที่"), true);
  assert.equal(contents[4].type, "separator");
  assert.equal(collectTextValues(contents[5]).includes("สภาพอากาศ"), true);
});

test("maps rice S1, S2, S3, N, and no-data without turning no-data into N", () => {
  const expected = [
    ["s1", "S1", "เหมาะสมมาก", "#F0FDF4", "#166534"],
    [" S2 ", "S2", "เหมาะสมปานกลาง", "#FFFBEA", "#92400E"],
    ["S3", "S3", "เหมาะสมน้อย", "#FFF9EE", "#9B3305"],
    ["n", "N", "ไม่เหมาะสม", "#FFF7F7", "#A71919"],
  ];

  expected.forEach(([input, code, label, cardColor, scoreColor]) => {
    const message = build(sampleAnalysis({
      riceLandSuitability: { class: input, label: "ignored" },
    }));
    assertTextsInclude(message, [code, label]);
    assert.equal(JSON.stringify(message).includes(cardColor), true);
    assert.equal(JSON.stringify(message).includes(scoreColor), true);
  });

  const noData = build(sampleAnalysis({
    riceLandSuitability: { class: null, label: "ไม่มีข้อมูล", status: "NO_COVERAGE" },
  }));
  assertTextsInclude(noData, ["—", "ยังไม่มีผลประเมิน"]);
  assert.equal(collectTextValues(noData).includes("N"), false);
});

test("maps maize S1, S2, S3, N, and missing maize safely", () => {
  ["S1", "S2", "S3", "N"].forEach((code) => {
    const message = build(sampleAnalysis({
      maizeLandSuitability: { class: code.toLowerCase(), label: "ignored" },
    }));
    assertTextsInclude(message, [code]);
  });

  const message = build(sampleAnalysis({
    maizeLandSuitability: null,
  }));
  assertTextsInclude(message, ["ข้าวโพด", "—", "ยังไม่มีผลประเมิน"]);
});

test("formats soil series with name and code, name only, code only, and no-data", () => {
  assertTextsInclude(build(), ["ชุดพะเยา (Pg)"]);
  assertTextsInclude(build(sampleAnalysis({ soil: { soilSymbol: "" } })), ["ชุดพะเยา"]);
  assertTextsInclude(build(sampleAnalysis({ soil: { soilNameThai: "", soilSymbol: "Pg" } })), ["Pg"]);
  assertTextsInclude(build(sampleAnalysis({ soil: null })), ["ยังไม่มีข้อมูลดินสำหรับตำแหน่งนี้"]);
  assertTextsInclude(
    build(sampleAnalysis({ soil: { soilNameThai: "ชุดพะเยา (Pg)", soilSymbol: "Pg" } })),
    ["ชุดพะเยา (Pg)"],
  );
  assertTextsInclude(
    build(sampleAnalysis({ soil: { soilNameThai: "ชุดพะเยา", drainageDescriptionThai: "ระบายน้ำดี" } })),
    ["ระบายน้ำดี"],
  );
});

test("formats flood recurrence for available, no-history, unavailable, and unknown states", () => {
  assertTextsInclude(build(), [
    "พบประวัติน้ำท่วมซ้ำซาก 3 ปี",
    "จากข้อมูลย้อนหลังช่วงปี 2015-2024",
  ]);
  assertTextsInclude(
    build(sampleAnalysis({
      hazardHistory: {
        floodRecurrence: {
          status: "none_detected",
          frequency: null,
          yearsDetected: [],
          dataPeriod: { startYear: 2015, endYear: 2024, totalYears: 10 },
          checkedAt: "2026-07-16T13:57:00.000Z",
          source: "GISTDA",
        },
      },
    })),
    ["ไม่พบประวัติน้ำท่วมซ้ำซากในพื้นที่นี้"],
  );
  const noHistory = build(sampleAnalysis({
    hazardHistory: {
      floodRecurrence: {
        status: "none_detected",
        frequency: null,
        yearsDetected: [],
        dataPeriod: { startYear: 2015, endYear: 2024, totalYears: 10 },
        checkedAt: "2026-07-16T13:57:00.000Z",
        source: "GISTDA",
      },
    },
  }));
  assert.equal(collectTextValues(noHistory).includes("ไม่มีข้อมูล"), false);

  const unavailable = build(sampleAnalysis({
      hazardHistory: {
        floodRecurrence: {
          status: "unavailable",
          yearsDetected: [],
          dataPeriod: { startYear: null, endYear: null, totalYears: null },
          checkedAt: "2026-07-16T13:57:00.000Z",
          source: "GISTDA",
        },
      },
    }));
  assertTextsInclude(unavailable, ["ยังไม่สามารถตรวจสอบประวัติน้ำท่วมซ้ำซากได้ในขณะนี้"]);
  assert.equal(collectTextValues(unavailable).includes("ไม่มีข้อมูล"), false);

  assertTextsInclude(
    build(sampleAnalysis({
      hazardHistory: {
        floodRecurrence: {
          status: "detected",
          frequency: 2,
          yearsDetected: [2024, 2025],
          dataPeriod: { startYear: 2021, endYear: 2025, totalYears: 5 },
          checkedAt: "2026-07-16T13:57:00.000Z",
          source: "GISTDA",
        },
      },
    })),
    ["พบประวัติน้ำท่วมซ้ำซาก 2 ปี", "จากข้อมูลย้อนหลังช่วงปี 2021-2025"],
  );

  assertTextsInclude(
    build(sampleAnalysis({
      hazardHistory: {
        floodRecurrence: {
          status: "no_coverage",
          dataPeriod: { startYear: null, endYear: null, totalYears: null },
          checkedAt: "2026-07-16T13:57:00.000Z",
          source: "GISTDA",
        },
      },
    })),
    ["ไม่มีข้อมูลครอบคลุมพื้นที่นี้"],
  );

  const malformed = build(sampleAnalysis({
    hazardHistory: {
      floodRecurrence: { status: "unexpected", message: "raw upstream flood stack" },
    },
  }));
  assertTextsInclude(malformed, ["ยังไม่สามารถแสดงผลการตรวจสอบได้ในขณะนี้"]);
  assertSerializedDoesNotInclude(malformed, ["raw upstream flood stack", "พบ 0 ปี"]);
});

test("formats drought recurrence for available, no-history, unavailable, and unknown states", () => {
  assertTextsInclude(build(), [
    "พบประวัติภัยแล้งซ้ำซาก 3 ปี",
    "จากข้อมูลย้อนหลังช่วงปี 2015-2024",
  ]);
  assertSerializedDoesNotInclude(build(), ["ระดับระดับ", "ไร่", "% ของพื้นที่", "affectedArea"]);

  assertTextsInclude(
    build(sampleAnalysis({
      hazardHistory: {
        droughtRecurrence: {
          status: "detected",
          level: "ระดับปานกลาง",
          totalOccurrences: null,
          yearsDetected: [],
          dataPeriod: { startYear: 2015, endYear: 2024, totalYears: 10 },
          checkedAt: "2026-07-16T13:57:00.000Z",
          source: "GISTDA",
        },
      },
    })),
    ["พบประวัติภัยแล้งซ้ำซากระดับปานกลาง"],
  );

  const noHistory = build(sampleAnalysis({
    hazardHistory: {
      droughtRecurrence: {
        status: "none_detected",
        totalOccurrences: 0,
        yearsDetected: [],
        dataPeriod: { startYear: 2015, endYear: 2024, totalYears: 10 },
        checkedAt: "2026-07-16T13:57:00.000Z",
        source: "GISTDA",
      },
    },
  }));
  assertTextsInclude(noHistory, ["ไม่พบประวัติภัยแล้งซ้ำซากในพื้นที่นี้"]);
  assert.equal(collectTextValues(noHistory).includes("ไม่มีข้อมูล"), false);

  const unavailable = build(sampleAnalysis({
      hazardHistory: {
        droughtRecurrence: {
          status: "unavailable",
          totalOccurrences: null,
          yearsDetected: [],
          dataPeriod: { startYear: null, endYear: null, totalYears: null },
          checkedAt: "2026-07-16T13:57:00.000Z",
          source: "GISTDA",
        },
      },
    }));
  assertTextsInclude(unavailable, ["ยังไม่สามารถตรวจสอบประวัติภัยแล้งซ้ำซากได้ในขณะนี้"]);
  assert.equal(collectTextValues(unavailable).includes("ไม่มีข้อมูล"), false);

  assertTextsInclude(
    build(sampleAnalysis({
      hazardHistory: {
        droughtRecurrence: {
          status: "no_coverage",
          dataPeriod: { startYear: null, endYear: null, totalYears: null },
          checkedAt: "2026-07-16T13:57:00.000Z",
          source: "GISTDA",
        },
      },
    })),
    ["ไม่มีข้อมูลครอบคลุมพื้นที่นี้"],
  );

  const malformed = build(sampleAnalysis({
    hazardHistory: {
      droughtRecurrence: { status: "unexpected", message: "raw upstream drought stack" },
    },
  }));
  assertTextsInclude(malformed, ["ยังไม่สามารถแสดงผลการตรวจสอบได้ในขณะนี้"]);
  assertSerializedDoesNotInclude(malformed, ["raw upstream drought stack"]);
});

test("hazard source and checked time are retained without raw ISO timestamps", () => {
  const message = build();
  const texts = collectTextValues(message);

  assert.equal(texts.includes("แหล่งข้อมูล: GISTDA"), true);
  assert.equal(texts.includes("ตรวจสอบเมื่อ: 16 ก.ค. 2569 20:57"), true);
  assert.equal(texts.filter((text) => text.startsWith("ตรวจสอบเมื่อ:")).length, 1);
  assertSerializedDoesNotInclude(message, [
    "2026-07-16T13:57:00.000Z",
    "T13:57",
    ".000Z",
  ]);
});

test("formats weather temperature and next-hour rain probability only when weather is available", () => {
  assertTextsInclude(build(), ["24.1 °C", "82%"]);
  assertTextsInclude(
    build(sampleAnalysis({ weather: { temperatureC: 0, nextHourPrecipitationProbabilityPercent: 0 } })),
    ["0 °C", "0%"],
  );
  assertTextsInclude(
    build(sampleAnalysis({ weather: { nextHourPrecipitationProbabilityPercent: 100 } })),
    ["100%"],
  );
  assertTextsInclude(
    build(sampleAnalysis({ weather: { status: "UNAVAILABLE", temperatureC: 24.1, nextHourPrecipitationProbabilityPercent: 82 } })),
    ["—"],
  );

  const oldRainField = ["max", "PrecipitationProbabilityPercent"].join("");
  const noNextHour = build(sampleAnalysis({
    weather: {
      nextHourPrecipitationProbabilityPercent: undefined,
      [oldRainField]: 99,
    },
  }));
  assert.equal(collectTextValues(noNextHour).includes("99%"), false);
  assertSerializedDoesNotInclude(noNextHour, ["undefined", "NaN"]);
});

test("formats locations with tambon, amphoe, missing values, and no duplicate prefixes", () => {
  assertTextsInclude(build(), ["ต.แม่กา อ.เมืองพะเยา"]);
  assertTextsInclude(build(sampleAnalysis({ location: { amphoe: "" } })), ["ต.แม่กา"]);
  assertTextsInclude(build(sampleAnalysis({ location: { tambon: "" } })), ["อ.เมืองพะเยา"]);
  const noLocation = build(sampleAnalysis({ location: { tambon: "", amphoe: "" } }));
  assert.equal(collectTextValues(noLocation).includes("ไม่พบข้อมูลตำแหน่ง"), false);
  assert.equal(noLocation.contents.header.contents.length, 1);
  assert.equal(JSON.stringify(noLocation).includes("ต. อ."), false);

  const prefixed = build(sampleAnalysis({
    location: {
      tambon: "ตำบลแม่กา",
      amphoe: "อำเภอเมืองพะเยา",
    },
  }));
  assertTextsInclude(prefixed, ["ต.แม่กา อ.เมืองพะเยา"]);
  assertSerializedDoesNotInclude(prefixed, ["ต.ตำบล", "อ.อำเภอ", "undefined", "null"]);
});

test("footer uses required label and caller-provided detailUrl", () => {
  const message = build();
  const action = collectActionValues(message)[0];

  assert.equal(Object.prototype.hasOwnProperty.call(message.contents.footer, "paddingAll"), false);
  assert.notEqual(message.contents.footer.paddingAll, "0px");
  assert.equal(message.contents.footer.contents[0].style, "primary");
  assert.equal(message.contents.footer.contents[0].height, "md");
  assert.equal(message.contents.footer.contents[0].color, "#287A12");
  assert.equal(action.type, "uri");
  assert.equal(action.label, "ดูรายละเอียดพื้นที่");
  assert.equal(action.uri, DETAIL_URL);
});

test("footer URI preserves long map-click detailUrl without text truncation", () => {
  const message = build(sampleAnalysis(), { detailUrl: LONG_DETAIL_URL });
  const actions = collectUriActions(message)
    .filter((action) => action.label === "ดูรายละเอียดพื้นที่");

  assert.equal(actions.length, 1);
  assert.equal(actions[0], message.contents.footer.contents[0].action);
  assert.equal(actions[0].type, "uri");
  assert.equal(actions[0].uri, LONG_DETAIL_URL);
  assert.equal(actions[0].uri.endsWith("lng=99.94005686022584"), true);
  assert.equal(actions[0].uri.includes("..."), false);
  assert.equal(actions[0].uri.length > LONG_PUBLIC_APP_URL.length, true);
  assert.notEqual(actions[0].uri, LONG_PUBLIC_APP_URL);
  assert.equal(actions[0].uri.includes("lat=19.039846300072156"), true);
  assert.equal(actions[0].uri.includes("lng=99.94005686022584"), true);
});

test("old Cloudflare URL is not hardcoded in the builder", () => {
  assert.equal(serviceSource.includes("dishes-prefix-revised-whom.trycloudflare.com"), false);
});

test("rejects invalid detailUrl safely", () => {
  assert.throws(() => build(sampleAnalysis(), { detailUrl: "" }), TypeError);
  assert.throws(() => build(sampleAnalysis(), { detailUrl: "http://example.com/map" }), TypeError);
  assert.throws(() => build(sampleAnalysis(), { detailUrl: "/map" }), TypeError);
});

test("output is serializable, deterministic, sanitized, and does not mutate input", () => {
  const sensitiveFields = {
    [["user", "Id"].join("")]: "line-user-secret",
    [["id", "Token"].join("")]: "line-id-token-secret",
    [["api", "Key"].join("")]: "gistda-api-secret",
    secretName: "channel-access-secret",
  };
  const analysis = sampleAnalysis({ root: sensitiveFields });
  const before = JSON.parse(JSON.stringify(analysis));
  const first = build(analysis);
  const second = build(analysis);

  assert.deepEqual(analysis, before);
  assert.deepEqual(first, second);
  assert.equal(typeof JSON.stringify(first), "string");
  assertNoInvalidJsonValues(first);
  assertSerializedDoesNotInclude(first, [
    "line-user-secret",
    "line-id-token-secret",
    "gistda-api-secret",
    "channel-access-secret",
    "[object Object]",
  ]);
});

test("builder is pure and does not depend on network calls", () => {
  const originalFetch = global.fetch;
  global.fetch = () => {
    throw new Error("network should not be used");
  };
  try {
    assertTextsInclude(build(), ["ผลตรวจความเหมาะสมของพื้นที่"]);
  } finally {
    global.fetch = originalFetch;
  }
});

test("long display values are wrapped and do not break the flex structure", () => {
  const longName = "แม่กา".repeat(80);
  const message = build(sampleAnalysis({
    location: {
      tambon: longName,
      amphoe: "เมืองพะเยา",
    },
    soil: {
      soilNameThai: "ชุดดินตัวอย่าง".repeat(40),
      soilSymbol: "Pg",
    },
  }));

  const textObjects = collectTextObjects(message);
  assert.ok(textObjects.every((item) => item.wrap === true));
  assert.ok(textObjects.some((item) => item.text.startsWith("ต.แม่กา")));
  assert.equal(message.contents.type, "bubble");
});

test("sample output contains the approved template visible texts", () => {
  const message = build();
  assertTextsInclude(message, [
    "ผลตรวจความเหมาะสมของพื้นที่",
    "ข้าว",
    "ข้าวโพด",
    "ข้อมูลดิน",
    "ประวัติภัยของพื้นที่",
    "ข้อมูลน้ำท่วม",
    "ข้อมูลภัยแล้ง",
    "สภาพอากาศ",
    "อุณหภูมิ",
    "ฝนในอีก 1 ชม.",
  ]);
  assert.equal(collectActionValues(message)[0].label, "ดูรายละเอียดพื้นที่");
});
