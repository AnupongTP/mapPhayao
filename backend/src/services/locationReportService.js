const riceSuitabilityService = require("./riceSuitabilityService");
const hazardHistoryService = require("./hazardHistoryService");
const weatherService = require("./weatherService");

function createPartialError(dataset, code, message) {
  return {
    source: "GISTDA",
    dataset,
    code,
    message,
  };
}

function stripInternalFields(value) {
  if (!value || typeof value !== "object") {
    return value;
  }
  const clone = { ...value };
  delete clone._warnings;
  return clone;
}

function collectWarnings(dataset, result) {
  if (!Array.isArray(result?._warnings) || result._warnings.length === 0) {
    return [];
  }

  return result._warnings.map((code) => createPartialError(
    dataset,
    code,
    dataset === "flood_recurrence"
      ? "ไม่สามารถตรวจสอบข้อมูลน้ำท่วมซ้ำซากได้ครบถ้วน"
      : "ไม่สามารถตรวจสอบข้อมูลภัยแล้งซ้ำซากได้ครบถ้วน",
  ));
}

function logPartialErrors(partialErrors, logger = console) {
  if (!logger || typeof logger.warn !== "function") {
    return;
  }

  partialErrors
    .filter((item) => item?.source === "GISTDA")
    .forEach((item) => {
      logger.warn(JSON.stringify({
        event: "hazard-history-diagnostic",
        source: item.source,
        dataset: item.dataset,
        code: item.code,
      }));
    });
}

async function getLocationReport({ latitude, longitude }, dependencies = {}) {
  const suitabilityService = dependencies.riceSuitabilityService || riceSuitabilityService;
  const hazardService = dependencies.hazardHistoryService || hazardHistoryService;
  const agriWeatherService = dependencies.weatherService || weatherService;
  const logger = dependencies.logger || console;

  const [suitabilityResult, floodResult, droughtResult, weatherResult] = await Promise.allSettled([
    suitabilityService.getPointSummary({ latitude, longitude }),
    hazardService.getFloodRecurrence({ latitude, longitude }),
    hazardService.getDroughtRecurrence({ latitude, longitude }),
    agriWeatherService.getWeatherForLocation({ latitude, longitude }),
  ]);

  const partialErrors = [];
  const base = suitabilityResult.status === "fulfilled"
    ? suitabilityResult.value
    : {
        success: true,
        found: false,
        clickedPoint: { latitude, longitude },
        location: {},
      };

  if (suitabilityResult.status === "rejected") {
    partialErrors.push({
      source: "LOCAL",
      dataset: "suitability",
      code: "SUITABILITY_UNAVAILABLE",
      message: "ไม่สามารถตรวจสอบความเหมาะสมของพื้นที่ได้ในขณะนี้",
    });
  }

  const flood = floodResult.status === "fulfilled"
    ? floodResult.value
    : hazardService.buildUnavailableResult("flood", "HAZARD_SERVICE_ERROR");
  const drought = droughtResult.status === "fulfilled"
    ? droughtResult.value
    : hazardService.buildUnavailableResult("drought", "HAZARD_SERVICE_ERROR");
  const weather = weatherResult.status === "fulfilled"
    ? weatherResult.value
    : weatherService.buildUnavailableResult();

  partialErrors.push(...collectWarnings("flood_recurrence", flood));
  partialErrors.push(...collectWarnings("drought_recurrence", drought));
  logPartialErrors(partialErrors, logger);

  return {
    ...base,
    success: true,
    location: {
      ...(base.location || {}),
      lat: latitude,
      lng: longitude,
      crs: "EPSG:4326",
    },
    hazardHistory: {
      floodRecurrence: stripInternalFields(flood),
      droughtRecurrence: stripInternalFields(drought),
    },
    weather,
    partialErrors,
  };
}

module.exports = {
  getLocationReport,
  logPartialErrors,
};
