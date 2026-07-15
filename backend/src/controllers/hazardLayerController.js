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

module.exports = {
  getFloodRecurrence,
  getDroughtRecurrence,
};
