const hazardLayerService = require("../services/hazardLayerService");

async function getFloodRecurrence(req, res, next) {
  try {
    const geojson = await hazardLayerService.getFloodRecurrenceLayer({
      bbox: req.query.bbox,
      zoom: req.query.zoom,
    });
    return res.status(200).json(geojson);
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        error: error.message,
        ...(error.code ? { code: error.code } : {}),
      });
    }
    return next(error);
  }
}

async function getDroughtRecurrence(req, res, next) {
  try {
    const geojson = await hazardLayerService.getDroughtRecurrenceLayer();
    return res.status(200).json(geojson);
  } catch (error) {
    return next(error);
  }
}

async function getFloodRecurrenceGeneration(req, res, next) {
  try {
    const generation = await hazardLayerService.getFloodRecurrenceGeneration();
    return res.status(200).json({ generation });
  } catch (error) {
    return next(error);
  }
}

async function getFloodRecurrenceAtPoint(req, res, next) {
  try {
    const result = await hazardLayerService.getFloodRecurrenceAtPoint({
      lat: req.query.lat,
      lng: req.query.lng,
    });
    return res.status(200).json(result);
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        error: error.message,
      });
    }
    return res.status(503).json({
      success: false,
      error: "Flood recurrence detail is unavailable",
    });
  }
}

module.exports = {
  getFloodRecurrence,
  getFloodRecurrenceGeneration,
  getFloodRecurrenceAtPoint,
  getDroughtRecurrence,
};
