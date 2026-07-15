const locationReportService = require("../services/locationReportService");

function parseCoordinate(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function validateLocationQuery(query) {
  const latitude = parseCoordinate(query.lat);
  const longitude = parseCoordinate(query.lng);

  if (latitude === null) {
    return { error: "lat is required and must be a valid number" };
  }
  if (longitude === null) {
    return { error: "lng is required and must be a valid number" };
  }
  if (latitude < -90 || latitude > 90) {
    return { error: "lat must be between -90 and 90" };
  }
  if (longitude < -180 || longitude > 180) {
    return { error: "lng must be between -180 and 180" };
  }

  return { latitude, longitude };
}

async function getLocationReport(req, res, next) {
  const validation = validateLocationQuery(req.query);
  if (validation.error) {
    return res.status(400).json({
      success: false,
      error: validation.error,
    });
  }

  try {
    const report = await locationReportService.getLocationReport(validation);
    return res.status(200).json(report);
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  getLocationReport,
  validateLocationQuery,
};
