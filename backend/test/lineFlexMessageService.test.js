const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createLocationSummaryFlexMessage,
} = require("../src/services/lineFlexMessageService");

const DETAIL_URL = "https://example.com/map";
const LONG_DETAIL_URL =
  "https://rapidly-marijuana-harper-partly.trycloudflare.com/mapphayao1/frontend/index.html?lat=19.039846300072156&lng=99.94005686022584";

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
        source: "GISTDA",
      }),
      droughtRecurrence: mergeHazardOverride("droughtRecurrence", {
        status: "detected",
        totalOccurrences: 3,
        yearsDetected: [2019, 2021, 2023],
        dataPeriod: { startYear: 2015, endYear: 2024, totalYears: 10 },
        summaryLevel: "tambon",
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
  assert.equal(typeof message.altText, "string");
  assert.notEqual(message.altText.trim(), "");
  assert.equal(message.contents.type, "bubble");
  assert.equal(message.contents.size, "mega");
  assert.ok(message.contents.header);
  assert.ok(message.contents.body);
  assert.ok(message.contents.footer);
  assert.equal(message.contents.header.backgroundColor, "#2F6F10");
  assert.equal(message.contents.header.paddingAll, "16px");
  assert.equal(message.contents.footer.backgroundColor, "#2F6F10");
  assert.equal(message.contents.footer.paddingAll, "8px");
  assertTextsInclude(message, [
    "ผลตรวจความเหมาะสมของพื้นที่",
    "ต.แม่กา อ.เมืองพะเยา",
    "ข้าว",
    "S1",
    "เหมาะสมมาก",
    "ข้าวโพด",
    "S2",
    "เหมาะสมปานกลาง",
    "ชุดดิน",
    "ชุดพะเยา (Pg)",
    "ข้อมูลน้ำท่วม",
    "พบ 3 ปีใน 10 ปี",
    "ข้อมูลภัยแล้ง",
    "ระดับปานกลาง",
    "อุณหภูมิ",
    "24.1 °C",
    "ฝนในอีก 1 ชม.",
    "82%",
    "ข้อมูลภัยแล้งเป็นข้อมูลสรุประดับตำบล",
  ]);
});

test("keeps rice and maize results separate and ordered", () => {
  const texts = collectTextValues(build());
  assert.ok(texts.indexOf("ข้าว") < texts.indexOf("S1"));
  assert.ok(texts.indexOf("S1") < texts.indexOf("ข้าวโพด"));
  assert.ok(texts.indexOf("ข้าวโพด") < texts.indexOf("S2"));
});

test("maps rice S1, S2, S3, N, and no-data without turning no-data into N", () => {
  const expected = [
    ["s1", "S1", "เหมาะสมมาก", "#DCFCE7"],
    [" S2 ", "S2", "เหมาะสมปานกลาง", "#FEF3C7"],
    ["S3", "S3", "เหมาะสมน้อย", "#FFEDD5"],
    ["n", "N", "ไม่เหมาะสม", "#FEE2E2"],
  ];

  expected.forEach(([input, code, label, badgeColor]) => {
    const message = build(sampleAnalysis({
      riceLandSuitability: { class: input, label: "ignored" },
    }));
    assertTextsInclude(message, [code, label]);
    assert.equal(JSON.stringify(message).includes(badgeColor), true);
  });

  const noData = build(sampleAnalysis({
    riceLandSuitability: { class: null, label: "ไม่มีข้อมูล", status: "NO_COVERAGE" },
  }));
  assertTextsInclude(noData, ["ไม่มีข้อมูล", "ไม่พบข้อมูลความเหมาะสม"]);
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
  assertTextsInclude(message, ["ข้าวโพด", "ไม่มีข้อมูล", "ไม่พบข้อมูลความเหมาะสม"]);
});

test("formats soil series with name and code, name only, code only, and no-data", () => {
  assertTextsInclude(build(), ["ชุดพะเยา (Pg)"]);
  assertTextsInclude(build(sampleAnalysis({ soil: { soilSymbol: "" } })), ["ชุดพะเยา"]);
  assertTextsInclude(build(sampleAnalysis({ soil: { soilNameThai: "", soilSymbol: "Pg" } })), ["Pg"]);
  assertTextsInclude(build(sampleAnalysis({ soil: null })), ["ไม่มีข้อมูล"]);
  assertTextsInclude(
    build(sampleAnalysis({ soil: { soilNameThai: "ชุดพะเยา (Pg)", soilSymbol: "Pg" } })),
    ["ชุดพะเยา (Pg)"],
  );
});

test("formats flood recurrence for detected, zero, unavailable, and dynamic year windows", () => {
  assertTextsInclude(build(), ["พบ 3 ปีใน 10 ปี"]);
  assertTextsInclude(
    build(sampleAnalysis({
      hazardHistory: {
        floodRecurrence: {
          status: "none_detected",
          frequency: null,
          yearsDetected: [],
          dataPeriod: { startYear: 2015, endYear: 2024, totalYears: 10 },
        },
      },
    })),
    ["ไม่พบใน 10 ปี"],
  );
  assertTextsInclude(
    build(sampleAnalysis({
      hazardHistory: {
        floodRecurrence: {
          status: "unavailable",
          yearsDetected: [],
          dataPeriod: { startYear: null, endYear: null, totalYears: null },
        },
      },
    })),
    ["ไม่มีข้อมูล"],
  );
  assertTextsInclude(
    build(sampleAnalysis({
      hazardHistory: {
        floodRecurrence: {
          status: "detected",
          frequency: 2,
          yearsDetected: [2024, 2025],
          dataPeriod: { startYear: 2021, endYear: 2025, totalYears: 5 },
        },
      },
    })),
    ["พบ 2 ปีใน 5 ปี"],
  );
  assertSerializedDoesNotInclude(build(), ["2015", "2024", "พบ 0 ปีใน 10 ปี"]);
});

test("formats drought summary as tambon-level level text without area or percent claims", () => {
  assertTextsInclude(build(), ["ระดับปานกลาง"]);
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
        },
      },
    })),
    ["ระดับปานกลาง"],
  );

  assertTextsInclude(
    build(sampleAnalysis({
      hazardHistory: {
        droughtRecurrence: {
          status: "unavailable",
          totalOccurrences: null,
          yearsDetected: [],
          dataPeriod: { startYear: null, endYear: null, totalYears: null },
        },
      },
    })),
    ["ไม่มีข้อมูล"],
  );
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
    ["ไม่มีข้อมูล"],
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
  assertTextsInclude(build(sampleAnalysis({ location: { tambon: "", amphoe: "" } })), ["ไม่พบข้อมูลตำแหน่ง"]);

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
  assert.equal(actions[0].uri.length > 120, true);
  assert.notEqual(actions[0].uri, "https://rapidly-marijuana-harper-partly.trycloudflare.com/mapphayao1/frontend/index.html");
  assert.equal(actions[0].uri.includes("lat=19.039846300072156"), true);
  assert.equal(actions[0].uri.includes("lng=99.94005686022584"), true);
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
    "ชุดดิน",
    "ข้อมูลน้ำท่วม",
    "ข้อมูลภัยแล้ง",
    "อุณหภูมิ",
    "ฝนในอีก 1 ชม.",
  ]);
  assert.equal(collectActionValues(message)[0].label, "ดูรายละเอียดพื้นที่");
});
