const test = require("node:test");
const assert = require("node:assert/strict");

const lineController = require("../src/controllers/lineController");
const lineTokenService = require("../src/services/lineTokenService");
const locationReportService = require("../src/services/locationReportService");

const originalVerifyIdToken = lineTokenService.verifyIdToken;
const originalGetLocationReport = locationReportService.getLocationReport;
const originalFetch = global.fetch;
const originalChannelId = process.env.LINE_LOGIN_CHANNEL_ID;

test.afterEach(() => {
  lineTokenService.verifyIdToken = originalVerifyIdToken;
  locationReportService.getLocationReport = originalGetLocationReport;
  global.fetch = originalFetch;
  if (originalChannelId === undefined) {
    delete process.env.LINE_LOGIN_CHANNEL_ID;
  } else {
    process.env.LINE_LOGIN_CHANNEL_ID = originalChannelId;
  }
});

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

async function runAnalyzeLocation(body) {
  const req = { body };
  const res = createMockResponse();
  let nextError = null;
  await lineController.analyzeLocation(req, res, (error) => {
    nextError = error;
  });
  return { res, nextError };
}

test("LINE body validation rejects missing and invalid coordinates", () => {
  assert.equal(
    lineController.validateLocationAnalysisBody({ lat: 19, lng: 99 }).error,
    "idToken is required and must be a non-empty string",
  );
  assert.equal(
    lineController.validateLocationAnalysisBody({ idToken: "", lat: 19, lng: 99 }).error,
    "idToken is required and must be a non-empty string",
  );
  assert.equal(
    lineController.validateLocationAnalysisBody({ idToken: "token", lng: 99 }).error,
    "lat is required and must be a valid number",
  );
  assert.equal(
    lineController.validateLocationAnalysisBody({ idToken: "token", lat: 19 }).error,
    "lng is required and must be a valid number",
  );
  assert.equal(
    lineController.validateLocationAnalysisBody({ idToken: "token", lat: "bad", lng: 99 }).error,
    "lat is required and must be a valid number",
  );
  assert.equal(
    lineController.validateLocationAnalysisBody({ idToken: "token", lat: 19, lng: "bad" }).error,
    "lng is required and must be a valid number",
  );
  assert.equal(
    lineController.validateLocationAnalysisBody({ idToken: "token", lat: 91, lng: 99 }).error,
    "lat must be between -90 and 90",
  );
  assert.equal(
    lineController.validateLocationAnalysisBody({ idToken: "token", lat: 19, lng: 181 }).error,
    "lng must be between -180 and 180",
  );
});

test("LINE route verifies token, ignores client userId, and returns analysis JSON", async () => {
  let verifiedTokenInput = null;
  let reportInput = null;
  lineTokenService.verifyIdToken = async (idToken) => {
    verifiedTokenInput = idToken;
    return { userId: "verified-line-user", audience: "channel" };
  };
  locationReportService.getLocationReport = async (location) => {
    reportInput = location;
    return {
      success: true,
      found: true,
      riceLandSuitability: { class: "S2" },
      maizeLandSuitability: { class: "S3" },
      hazardHistory: {
        floodRecurrence: { status: "none_detected" },
        droughtRecurrence: { status: "detected" },
      },
      weather: { status: "UNAVAILABLE", source: "Open-Meteo" },
      location: { tambon: "sample" },
    };
  };

  const { res, nextError } = await runAnalyzeLocation({
    idToken: "test-id-token",
    lat: 19.1,
    lng: 99.9,
    userId: "client-supplied-user",
  });

  assert.equal(nextError, null);
  assert.equal(res.statusCode, 200);
  assert.equal(verifiedTokenInput, "test-id-token");
  assert.deepEqual(reportInput, { latitude: 19.1, longitude: 99.9 });
  assert.equal(res.body.userId, "verified-line-user");
  assert.notEqual(res.body.userId, "client-supplied-user");
  assert.equal(res.body.riceLandSuitability.class, "S2");
  assert.equal(res.body.maizeLandSuitability.class, "S3");
  assert.equal(res.body.weather.source, "Open-Meteo");
  assert.ok(res.body.hazardHistory);
  assert.equal(JSON.stringify(res.body).includes("test-id-token"), false);
});

test("LINE route returns sanitized status errors from token verification", async () => {
  for (const statusCode of [401, 502]) {
    lineTokenService.verifyIdToken = async () => {
      const error = new Error(statusCode === 401 ? "Invalid LINE ID token" : "LINE verification service unavailable");
      error.statusCode = statusCode;
      throw error;
    };
    locationReportService.getLocationReport = async () => {
      throw new Error("analysis should not run");
    };

    const { res, nextError } = await runAnalyzeLocation({
      idToken: "test-id-token",
      lat: 19,
      lng: 99,
    });

    assert.equal(nextError, null);
    assert.equal(res.statusCode, statusCode);
    assert.equal(res.body.success, false);
    assert.equal(typeof res.body.error, "string");
    assert.equal(JSON.stringify(res.body).includes("test-id-token"), false);
    assert.equal(JSON.stringify(res.body).includes("stack"), false);
  }
});

test("LINE route does not require channel access token or send messages", async () => {
  delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
  let analysisCalls = 0;
  lineTokenService.verifyIdToken = async () => ({ userId: "verified-line-user", audience: "channel" });
  locationReportService.getLocationReport = async () => {
    analysisCalls += 1;
    return {
      success: true,
      found: false,
      riceLandSuitability: { status: "NO_COVERAGE" },
      maizeLandSuitability: { status: "NO_COVERAGE" },
      hazardHistory: {},
      weather: { status: "UNAVAILABLE", source: "Open-Meteo" },
      partialErrors: [],
    };
  };

  const { res } = await runAnalyzeLocation({
    idToken: "test-id-token",
    lat: 18,
    lng: 100,
  });

  assert.equal(res.statusCode, 200);
  assert.equal(analysisCalls, 1);
  assert.equal(typeof lineController.pushMessage, "undefined");
});

test("LINE token service verifies audience and subject without exposing token", async () => {
  process.env.LINE_LOGIN_CHANNEL_ID = "channel-id";
  global.fetch = async (url, options) => {
    const body = String(options.body);
    assert.match(body, /client_id=channel-id/);
    assert.match(body, /id_token=test-id-token/);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        aud: "channel-id",
        sub: "verified-line-user",
      }),
    };
  };

  const result = await lineTokenService.verifyIdToken("test-id-token");
  assert.equal(result.userId, "verified-line-user");
  assert.equal(result.audience, "channel-id");
});

test("LINE token service rejects invalid, expired, network, timeout, and missing subject cases", async () => {
  process.env.LINE_LOGIN_CHANNEL_ID = "channel-id";

  global.fetch = async () => ({
    ok: false,
    status: 401,
    json: async () => ({ error: "invalid" }),
  });
  await assert.rejects(() => lineTokenService.verifyIdToken("invalid-token"), { statusCode: 401 });

  global.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ aud: "channel-id" }),
  });
  await assert.rejects(() => lineTokenService.verifyIdToken("missing-sub-token"), { statusCode: 401 });

  global.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ aud: "wrong-channel", sub: "verified-line-user" }),
  });
  await assert.rejects(() => lineTokenService.verifyIdToken("wrong-audience-token"), { statusCode: 401 });

  global.fetch = async () => {
    throw new Error("network");
  };
  await assert.rejects(() => lineTokenService.verifyIdToken("network-token"), { statusCode: 502 });

  global.fetch = async (url, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener("abort", () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      reject(error);
    });
  });
  await assert.rejects(() => lineTokenService.verifyIdToken("timeout-token"), { statusCode: 502 });
});
