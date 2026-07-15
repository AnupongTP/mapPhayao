const test = require("node:test");
const assert = require("node:assert/strict");

const lineController = require("../src/controllers/lineController");
const lineRoutes = require("../src/routes/lineRoutes");
const realLineFlexMessageService = require("../src/services/lineFlexMessageService");

const FAKE_USER_ID = "U00000000000000000000000000000000";
const SERVER_DETAIL_URL = "https://example.com/mapphayao1/frontend/index.html";
const EXPECTED_DETAIL_URL =
  "https://example.com/mapphayao1/frontend/index.html?lat=19.123456&lng=99.123456";
const LONG_PUBLIC_APP_URL =
  "https://rapidly-marijuana-harper-partly.trycloudflare.com/mapphayao1/frontend/index.html";
const LONG_EXPECTED_DETAIL_URL =
  `${LONG_PUBLIC_APP_URL}?lat=19.039846300072156&lng=99.94005686022584`;
const CLIENT_USER_ID = "client-supplied-user";
const CLIENT_DETAIL_URL = "https://client.example.com/ignored";

function createMockResponse() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

function createServiceError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function createMessagingError(code, statusCode = 502) {
  const error = new Error("raw LINE error should not leak");
  error.code = code;
  error.statusCode = statusCode;
  error.rawResponse = "{\"message\":\"do not expose\"}";
  return error;
}

function sampleAnalysis() {
  return {
    success: true,
    found: true,
    location: { tambon: "แม่กา", amphoe: "เมืองพะเยา" },
    riceLandSuitability: { class: "S1" },
    maizeLandSuitability: { class: "S2" },
    hazardHistory: {},
    weather: { status: "UNAVAILABLE" },
  };
}

function sampleFlexMessage() {
  return {
    type: "flex",
    altText: "summary",
    contents: { type: "bubble" },
  };
}

function makeDeps(overrides = {}) {
  const calls = {
    verifyInputs: [],
    reportInputs: [],
    flexInputs: [],
    messageInputs: [],
    publicUrlCalls: 0,
  };
  const analysis = overrides.analysis || sampleAnalysis();
  const flexMessage = overrides.flexMessage || sampleFlexMessage();

  const deps = {
    lineTokenService: {
      verifyIdToken: async (idToken) => {
        calls.verifyInputs.push(idToken);
        if (overrides.verifyError) {
          throw overrides.verifyError;
        }
        if (overrides.verifiedToken) {
          return overrides.verifiedToken;
        }
        return { userId: FAKE_USER_ID, audience: "channel-id" };
      },
    },
    locationReportService: {
      getLocationReport: async (location) => {
        calls.reportInputs.push(location);
        if (overrides.reportError) {
          throw overrides.reportError;
        }
        return analysis;
      },
    },
    lineFlexMessageService: {
      createLocationSummaryFlexMessage: (inputAnalysis, options) => {
        calls.flexInputs.push({ analysis: inputAnalysis, options });
        if (overrides.flexError) {
          throw overrides.flexError;
        }
        return flexMessage;
      },
    },
    lineMessagingService: {
      pushMessage: async (userId, message) => {
        calls.messageInputs.push({ userId, message });
        if (overrides.messagingError) {
          throw overrides.messagingError;
        }
        return { ok: true, status: "SENT" };
      },
    },
    getPublicAppUrl: () => {
      calls.publicUrlCalls += 1;
      if (overrides.publicUrlError) {
        throw overrides.publicUrlError;
      }
      return overrides.publicUrl || SERVER_DETAIL_URL;
    },
  };

  return { deps, calls, analysis, flexMessage };
}

async function runSendLocationSummary(body, overrides = {}) {
  const { deps, calls, analysis, flexMessage } = makeDeps(overrides);
  const controller = lineController.createLineController(deps);
  const req = { body };
  const res = createMockResponse();
  let nextError = null;
  await controller.sendLocationSummary(req, res, (error) => {
    nextError = error;
  });
  return { res, nextError, calls, analysis, flexMessage };
}

async function runAnalyzeLocation(body, overrides = {}) {
  const { deps, calls, analysis } = makeDeps(overrides);
  const controller = lineController.createLineController(deps);
  const req = { body };
  const res = createMockResponse();
  let nextError = null;
  await controller.analyzeLocation(req, res, (error) => {
    nextError = error;
  });
  return { res, nextError, calls, analysis };
}

function assertSanitized(value) {
  const serialized = JSON.stringify(value);
  assert.equal(serialized.includes("test-id-token"), false);
  assert.equal(serialized.includes(CLIENT_USER_ID), false);
  assert.equal(serialized.includes(FAKE_USER_ID), false);
  assert.equal(serialized.includes("stack"), false);
  assert.equal(serialized.includes("raw LINE error"), false);
  assert.equal(serialized.includes("rawResponse"), false);
  assert.equal(serialized.includes("PUBLIC_APP_URL"), false);
  assert.equal(serialized.includes("flexMessage"), false);
}

function collectUriActions(value) {
  const actions = [];
  const visit = (item) => {
    if (Array.isArray(item)) {
      item.forEach(visit);
      return;
    }
    if (!item || typeof item !== "object") {
      return;
    }
    if (item.action && item.action.type === "uri") {
      actions.push(item.action);
    }
    Object.values(item).forEach(visit);
  };

  visit(value);
  return actions;
}

test("line router exposes the location-summary endpoint once", () => {
  const summaryRoutes = lineRoutes.stack
    .filter((layer) => layer.route?.path === "/location-summary")
    .filter((layer) => layer.route?.methods?.post);

  assert.equal(summaryRoutes.length, 1);
  assert.equal(summaryRoutes[0].route.stack[0].handle, lineController.sendLocationSummary);
});

test("location-summary validates token and coordinates, ignores client-supplied data, and sends server-built Flex", async () => {
  const clientAnalysis = { location: { tambon: "client" } };
  const clientFlex = { type: "flex", altText: "client", contents: { type: "bubble" } };
  const body = {
    idToken: " test-id-token ",
    lat: "19.123456",
    lng: "99.123456",
    userId: CLIENT_USER_ID,
    analysis: clientAnalysis,
    report: clientAnalysis,
    flexMessage: clientFlex,
    message: clientFlex,
    accessToken: "client-token",
    channelAccessToken: "client-channel-token",
    detailUrl: CLIENT_DETAIL_URL,
  };

  const { res, nextError, calls, analysis, flexMessage } = await runSendLocationSummary(body);

  assert.equal(nextError, null);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true, status: "SENT" });
  assert.deepEqual(calls.verifyInputs, ["test-id-token"]);
  assert.deepEqual(calls.reportInputs, [{ latitude: 19.123456, longitude: 99.123456 }]);
  assert.equal(calls.flexInputs.length, 1);
  assert.equal(calls.flexInputs[0].analysis, analysis);
  assert.deepEqual(calls.flexInputs[0].options, { detailUrl: EXPECTED_DETAIL_URL });
  assert.equal(calls.messageInputs.length, 1);
  assert.equal(calls.messageInputs[0].userId, FAKE_USER_ID);
  assert.equal(calls.messageInputs[0].message, flexMessage);
  assertSanitized(res.body);
  assert.equal(JSON.stringify(res.body).includes("riceLandSuitability"), false);
  assert.equal(JSON.stringify(res.body).includes("contents"), false);
});

test("location-summary sends a real Flex message whose footer URI contains validated coordinates", async () => {
  const calls = {
    messages: [],
    reportInputs: [],
  };
  const controller = lineController.createLineController({
    lineTokenService: {
      verifyIdToken: async () => ({ userId: FAKE_USER_ID, audience: "channel-id" }),
    },
    locationReportService: {
      getLocationReport: async (location) => {
        calls.reportInputs.push(location);
        return sampleAnalysis();
      },
    },
    lineFlexMessageService: realLineFlexMessageService,
    lineMessagingService: {
      pushMessage: async (userId, message) => {
        calls.messages.push({ userId, message });
        return { ok: true, status: "SENT" };
      },
    },
    getPublicAppUrl: () => SERVER_DETAIL_URL,
  });
  const req = {
    body: {
      idToken: "test-id-token",
      lat: "19.123456",
      lng: "99.123456",
      userId: CLIENT_USER_ID,
      detailUrl: CLIENT_DETAIL_URL,
    },
  };
  const res = createMockResponse();
  let nextError = null;

  await controller.sendLocationSummary(req, res, (error) => {
    nextError = error;
  });

  assert.equal(nextError, null);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true, status: "SENT" });
  assert.deepEqual(calls.reportInputs, [{ latitude: 19.123456, longitude: 99.123456 }]);
  assert.equal(calls.messages.length, 1);
  assert.equal(calls.messages[0].userId, FAKE_USER_ID);
  assert.equal(calls.messages[0].message.type, "flex");

  const detailAction = collectUriActions(calls.messages[0].message)
    .find((action) => action.label === "ดูรายละเอียดพื้นที่");
  assert.ok(detailAction);
  assert.equal(detailAction.uri, EXPECTED_DETAIL_URL);
  assert.equal(detailAction.uri.includes("lat=19.123456"), true);
  assert.equal(detailAction.uri.includes("lng=99.123456"), true);
  assert.notEqual(detailAction.uri, SERVER_DETAIL_URL);
  assert.equal(detailAction.uri.includes("liff=1"), false);
  assert.equal(detailAction.uri.includes("idToken"), false);
  assert.equal(detailAction.uri.includes("userId"), false);
  assert.equal(detailAction.uri.includes("accessToken"), false);
});

test("location-summary passes long validated coordinates into the real Flex footer URI", async () => {
  const clientFlex = { type: "flex", altText: "client", contents: { type: "bubble" } };
  const calls = {
    messages: [],
    reportInputs: [],
  };
  const controller = lineController.createLineController({
    lineTokenService: {
      verifyIdToken: async () => ({ userId: FAKE_USER_ID, audience: "channel-id" }),
    },
    locationReportService: {
      getLocationReport: async (location) => {
        calls.reportInputs.push(location);
        return sampleAnalysis();
      },
    },
    lineFlexMessageService: realLineFlexMessageService,
    lineMessagingService: {
      pushMessage: async (userId, message) => {
        calls.messages.push({ userId, message });
        return { ok: true, status: "SENT" };
      },
    },
    getPublicAppUrl: () => LONG_PUBLIC_APP_URL,
  });
  const req = {
    body: {
      idToken: "test-id-token",
      lat: "19.039846300072156",
      lng: "99.94005686022584",
      detailUrl: CLIENT_DETAIL_URL,
      flexMessage: clientFlex,
      message: clientFlex,
    },
  };
  const res = createMockResponse();
  let nextError = null;

  await controller.sendLocationSummary(req, res, (error) => {
    nextError = error;
  });

  assert.equal(nextError, null);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true, status: "SENT" });
  assert.deepEqual(calls.reportInputs, [{
    latitude: 19.039846300072156,
    longitude: 99.94005686022584,
  }]);
  assert.equal(calls.messages.length, 1);
  assert.notEqual(calls.messages[0].message, clientFlex);

  const detailActions = collectUriActions(calls.messages[0].message)
    .filter((action) => action.label === "ดูรายละเอียดพื้นที่");
  assert.equal(detailActions.length, 1);
  assert.equal(detailActions[0].type, "uri");
  assert.equal(detailActions[0].uri, LONG_EXPECTED_DETAIL_URL);
  assert.equal(detailActions[0].uri.includes("..."), false);
  assert.equal(detailActions[0].uri.length > 120, true);
  assert.notEqual(detailActions[0].uri, LONG_PUBLIC_APP_URL);

  const parsed = new URL(detailActions[0].uri);
  assert.equal(parsed.searchParams.getAll("lat").length, 1);
  assert.equal(parsed.searchParams.getAll("lng").length, 1);
  assert.equal(parsed.searchParams.get("lat"), "19.039846300072156");
  assert.equal(parsed.searchParams.get("lng"), "99.94005686022584");
  assert.equal(detailActions[0].uri.includes(CLIENT_DETAIL_URL), false);
});

test("buildLocationDetailUrl creates a safe HTTPS detail link for the validated point", () => {
  const url = lineController.buildLocationDetailUrl(SERVER_DETAIL_URL, 19.123456, 99.123456);

  assert.equal(url, EXPECTED_DETAIL_URL);
  assert.equal(url.includes("idToken"), false);
  assert.equal(url.includes("userId"), false);
  assert.equal(url.includes("accessToken"), false);
  assert.equal(url.includes("liff=1"), false);
});

test("buildLocationDetailUrl replaces point coordinates and preserves safe public query parameters", () => {
  const url = lineController.buildLocationDetailUrl(
    "https://example.com/mapphayao1/frontend/index.html?view=soil&lat=1&lng=2",
    19.5,
    99.75,
  );
  const parsed = new URL(url);

  assert.equal(parsed.searchParams.get("view"), "soil");
  assert.equal(parsed.searchParams.get("lat"), "19.5");
  assert.equal(parsed.searchParams.get("lng"), "99.75");
  assert.equal(parsed.searchParams.getAll("lat").length, 1);
  assert.equal(parsed.searchParams.getAll("lng").length, 1);
});

test("buildLocationDetailUrl removes LINE, credential, and client-controlled query parameters", () => {
  const url = lineController.buildLocationDetailUrl(
    "https://example.com/map?keep=1&idToken=secret&userId=U1&accessToken=a&channelAccessToken=c&liff=1&analysis=json&flexMessage=json&detailUrl=https%3A%2F%2Fclient.example&rawLineResponse=x",
    0,
    100,
  );
  const parsed = new URL(url);

  assert.equal(parsed.searchParams.get("keep"), "1");
  assert.equal(parsed.searchParams.get("lat"), "0");
  assert.equal(parsed.searchParams.get("lng"), "100");
  for (const key of [
    "idToken",
    "userId",
    "accessToken",
    "channelAccessToken",
    "liff",
    "analysis",
    "flexMessage",
    "detailUrl",
    "rawLineResponse",
  ]) {
    assert.equal(parsed.searchParams.has(key), false);
  }
});

test("buildLocationDetailUrl rejects invalid public app URL values", () => {
  for (const value of [
    "http://example.com/map",
    "/map",
    "javascript:alert(1)",
    "data:text/plain,hello",
    "https://user:pass@example.com/map",
  ]) {
    assert.throws(
      () => lineController.buildLocationDetailUrl(value, 19, 99),
      /PUBLIC_APP_URL must be a valid HTTPS URL/,
    );
  }
});

test("location-summary rejects malformed request body before token verification", async () => {
  const cases = [
    [{ lat: 19, lng: 99 }, "idToken is required and must be a non-empty string"],
    [{ idToken: "", lat: 19, lng: 99 }, "idToken is required and must be a non-empty string"],
    [{ idToken: "token", lng: 99 }, "lat is required and must be a valid number"],
    [{ idToken: "token", lat: 19 }, "lng is required and must be a valid number"],
    [{ idToken: "token", lat: "bad", lng: 99 }, "lat is required and must be a valid number"],
    [{ idToken: "token", lat: 19, lng: "bad" }, "lng is required and must be a valid number"],
    [{ idToken: "token", lat: 91, lng: 99 }, "lat must be between -90 and 90"],
    [{ idToken: "token", lat: 19, lng: 181 }, "lng must be between -180 and 180"],
  ];

  for (const [body, error] of cases) {
    const { res, nextError, calls } = await runSendLocationSummary(body);
    assert.equal(nextError, null);
    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.body, { success: false, error });
    assert.deepEqual(calls.verifyInputs, []);
    assert.deepEqual(calls.messageInputs, []);
    assertSanitized(res.body);
  }
});

test("location-summary reuses token verification sanitized failures", async () => {
  const cases = [
    createServiceError(401, "Invalid LINE ID token"),
    createServiceError(401, "Invalid LINE ID token audience"),
    createServiceError(401, "Invalid LINE ID token subject"),
    createServiceError(502, "LINE verification service unavailable"),
  ];

  for (const verifyError of cases) {
    const { res, nextError, calls } = await runSendLocationSummary(
      { idToken: "test-id-token", lat: 19, lng: 99 },
      { verifyError },
    );
    assert.equal(nextError, null);
    assert.equal(res.statusCode, verifyError.statusCode);
    assert.equal(res.body.success, false);
    assert.equal(typeof res.body.error, "string");
    assert.deepEqual(calls.reportInputs, []);
    assert.deepEqual(calls.messageInputs, []);
    assertSanitized(res.body);
  }
});

test("location-summary requires server-configured HTTPS public app URL", async () => {
  const publicUrlErrors = ["", "bad-url", "http://example.com/map", "https://user:pass@example.com/map"]
    .map((value) => {
      try {
        lineController.validatePublicAppUrl(value);
        throw new Error("expected invalid URL");
      } catch (error) {
        return error;
      }
    });

  for (const publicUrlError of publicUrlErrors) {
    const { res, calls } = await runSendLocationSummary(
      { idToken: "test-id-token", lat: 19, lng: 99 },
      { publicUrlError },
    );
    assert.equal(res.statusCode, 503);
    assert.deepEqual(res.body, {
      ok: false,
      code: "CONFIGURATION_ERROR",
      message: "ไม่สามารถส่งข้อมูลทาง LINE ได้ในขณะนี้",
    });
    assert.equal(calls.flexInputs.length, 0);
    assert.equal(calls.messageInputs.length, 0);
    assertSanitized(res.body);
  }

  assert.equal(lineController.validatePublicAppUrl(SERVER_DETAIL_URL), SERVER_DETAIL_URL);
});

test("location-summary sanitizes Flex builder failures", async () => {
  const { res, nextError, calls } = await runSendLocationSummary(
    { idToken: "test-id-token", lat: 19, lng: 99 },
    { flexError: new Error("builder stack should not leak") },
  );

  assert.equal(nextError, null);
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.code, "LOCATION_SUMMARY_ERROR");
  assert.equal(calls.messageInputs.length, 0);
  assertSanitized(res.body);
  assert.equal(JSON.stringify(res.body).includes("builder stack"), false);
});

test("location-summary sanitizes messaging failures and never exposes raw LINE response", async () => {
  const cases = [
    ["CONFIGURATION_ERROR", 503],
    ["LINE_BAD_REQUEST", 502],
    ["LINE_UNAUTHORIZED", 502],
    ["LINE_FORBIDDEN", 502],
    ["LINE_RATE_LIMITED", 503],
    ["LINE_UPSTREAM_ERROR", 502],
    ["LINE_TIMEOUT", 502],
    ["LINE_NETWORK_ERROR", 502],
  ];

  for (const [code, statusCode] of cases) {
    const { res, calls } = await runSendLocationSummary(
      { idToken: "test-id-token", lat: 19, lng: 99 },
      { messagingError: createMessagingError(code, statusCode) },
    );
    assert.equal(res.statusCode, statusCode);
    assert.deepEqual(res.body, {
      ok: false,
      code,
      message: "ไม่สามารถส่งข้อมูลทาง LINE ได้ในขณะนี้",
    });
    assert.equal(calls.messageInputs.length, 1);
    assertSanitized(res.body);
  }
});

test("existing location-analysis behavior is unchanged", async () => {
  const { res, nextError, calls } = await runAnalyzeLocation({
    idToken: "test-id-token",
    lat: 19.1,
    lng: 99.9,
    userId: CLIENT_USER_ID,
  });

  assert.equal(nextError, null);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.userId, FAKE_USER_ID);
  assert.notEqual(res.body.userId, CLIENT_USER_ID);
  assert.equal(res.body.riceLandSuitability.class, "S1");
  assert.deepEqual(calls.reportInputs, [{ latitude: 19.1, longitude: 99.9 }]);
  assert.equal(JSON.stringify(res.body).includes("test-id-token"), false);
});
