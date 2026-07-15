const lineTokenService = require("../services/lineTokenService");
const locationReportService = require("../services/locationReportService");
const lineFlexMessageService = require("../services/lineFlexMessageService");
const lineMessagingService = require("../services/lineMessagingService");

const SUMMARY_ERROR_MESSAGE = "ไม่สามารถส่งข้อมูลทาง LINE ได้ในขณะนี้";
const UNSAFE_DETAIL_QUERY_KEYS = new Set([
  "accesstoken",
  "analysis",
  "authorization",
  "channelaccesstoken",
  "detailurl",
  "flexmessage",
  "idtoken",
  "liff",
  "message",
  "rawlineresponse",
  "report",
  "userid",
]);

function parseCoordinate(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function validateLocationAnalysisBody(body) {
  const idToken = typeof body.idToken === "string" ? body.idToken.trim() : "";
  if (!idToken) {
    return { error: "idToken is required and must be a non-empty string" };
  }

  const latitude = parseCoordinate(body.lat);
  if (latitude === null) {
    return { error: "lat is required and must be a valid number" };
  }

  const longitude = parseCoordinate(body.lng);
  if (longitude === null) {
    return { error: "lng is required and must be a valid number" };
  }

  if (latitude < -90 || latitude > 90) {
    return { error: "lat must be between -90 and 90" };
  }

  if (longitude < -180 || longitude > 180) {
    return { error: "lng must be between -180 and 180" };
  }

  return {
    idToken,
    latitude,
    longitude,
  };
}

function createControllerError(code, statusCode, message) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function validatePublicAppUrl(value) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) {
    throw createControllerError(
      "CONFIGURATION_ERROR",
      503,
      "PUBLIC_APP_URL is not configured",
    );
  }

  let parsed;
  try {
    parsed = new URL(text);
  } catch (error) {
    throw createControllerError(
      "CONFIGURATION_ERROR",
      503,
      "PUBLIC_APP_URL must be a valid HTTPS URL",
    );
  }

  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password
  ) {
    throw createControllerError(
      "CONFIGURATION_ERROR",
      503,
      "PUBLIC_APP_URL must be a valid HTTPS URL",
    );
  }

  return parsed.href;
}

function getPublicAppUrl() {
  return validatePublicAppUrl(process.env.PUBLIC_APP_URL);
}

function buildLocationDetailUrl(publicAppUrl, latitude, longitude) {
  const url = new URL(validatePublicAppUrl(publicAppUrl));

  for (const key of [...url.searchParams.keys()]) {
    if (UNSAFE_DETAIL_QUERY_KEYS.has(key.toLowerCase())) {
      url.searchParams.delete(key);
    }
  }

  url.searchParams.set("lat", String(latitude));
  url.searchParams.set("lng", String(longitude));

  return url.href;
}

function createSanitizedSummaryError(error) {
  const code = error.code || "LOCATION_SUMMARY_ERROR";
  const statusCode = error.statusCode || 500;
  return {
    statusCode,
    body: {
      ok: false,
      code,
      message: SUMMARY_ERROR_MESSAGE,
    },
  };
}

function createLineController(dependencies = {}) {
  const tokenService = dependencies.lineTokenService || lineTokenService;
  const reportService = dependencies.locationReportService || locationReportService;
  const flexService = dependencies.lineFlexMessageService || lineFlexMessageService;
  const messagingService = dependencies.lineMessagingService || lineMessagingService;
  const publicAppUrlProvider = dependencies.getPublicAppUrl || getPublicAppUrl;

  async function analyzeLocation(req, res, next) {
    const validation = validateLocationAnalysisBody(req.body || {});
    if (validation.error) {
      return res.status(400).json({
        success: false,
        error: validation.error,
      });
    }

    try {
      const verifiedToken = await tokenService.verifyIdToken(validation.idToken);
      const analysis = await reportService.getLocationReport({
        latitude: validation.latitude,
        longitude: validation.longitude,
      });

      return res.status(200).json({
        ...analysis,
        success: true,
        userId: verifiedToken.userId,
        location: {
          lat: validation.latitude,
          lng: validation.longitude,
          ...(analysis.location || {}),
        },
      });
    } catch (error) {
      if (error.statusCode) {
        return res.status(error.statusCode).json({
          success: false,
          error: error.message,
        });
      }

      return next(error);
    }
  }

  async function sendLocationSummary(req, res, next) {
    const validation = validateLocationAnalysisBody(req.body || {});
    if (validation.error) {
      return res.status(400).json({
        success: false,
        error: validation.error,
      });
    }

    try {
      const verifiedToken = await tokenService.verifyIdToken(validation.idToken);
      const analysis = await reportService.getLocationReport({
        latitude: validation.latitude,
        longitude: validation.longitude,
      });
      const detailUrl = buildLocationDetailUrl(
        publicAppUrlProvider(),
        validation.latitude,
        validation.longitude,
      );
      const flexMessage = flexService.createLocationSummaryFlexMessage(analysis, {
        detailUrl,
      });

      await messagingService.pushMessage(verifiedToken.userId, flexMessage);

      return res.status(200).json({
        ok: true,
        status: "SENT",
      });
    } catch (error) {
      if (error.statusCode && !error.code) {
        return res.status(error.statusCode).json({
          success: false,
          error: error.message,
        });
      }

      if (error.statusCode || error.code) {
        const sanitized = createSanitizedSummaryError(error);
        return res.status(sanitized.statusCode).json(sanitized.body);
      }

      const sanitized = createSanitizedSummaryError(error);
      return res.status(sanitized.statusCode).json(sanitized.body);
    }
  }

  return {
    analyzeLocation,
    sendLocationSummary,
  };
}

const defaultController = createLineController();

module.exports = {
  analyzeLocation: defaultController.analyzeLocation,
  sendLocationSummary: defaultController.sendLocationSummary,
  createLineController,
  getPublicAppUrl,
  buildLocationDetailUrl,
  validatePublicAppUrl,
  validateLocationAnalysisBody,
};
