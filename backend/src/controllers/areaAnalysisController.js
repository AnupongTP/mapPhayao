const areaAnalysisService = require("../services/areaAnalysisService");

const MAX_VERTICES = 5000;

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function validateCoordinatePair(pair) {
  if (!Array.isArray(pair) || pair.length < 2) {
    return false;
  }

  const longitude = pair[0];
  const latitude = pair[1];

  return (
    isFiniteNumber(longitude) &&
    isFiniteNumber(latitude) &&
    longitude >= -180 &&
    longitude <= 180 &&
    latitude >= -90 &&
    latitude <= 90
  );
}

function countVertices(coordinates) {
  if (!Array.isArray(coordinates)) {
    return 0;
  }

  if (coordinates.length >= 2 && typeof coordinates[0] === "number") {
    return validateCoordinatePair(coordinates) ? 1 : Number.NaN;
  }

  let total = 0;
  for (const item of coordinates) {
    const count = countVertices(item);
    if (!Number.isFinite(count)) {
      return Number.NaN;
    }
    total += count;
  }
  return total;
}

function validateGeometry(geometry) {
  if (!geometry || typeof geometry !== "object") {
    return "geometry is required";
  }

  if (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon") {
    return "geometry type must be Polygon or MultiPolygon";
  }

  if (!Array.isArray(geometry.coordinates) || geometry.coordinates.length === 0) {
    return "geometry coordinates are required";
  }

  const vertexCount = countVertices(geometry.coordinates);
  if (!Number.isFinite(vertexCount) || vertexCount <= 0) {
    return "geometry coordinates must contain valid longitude and latitude values";
  }

  if (vertexCount > MAX_VERTICES) {
    return `geometry has too many vertices; maximum is ${MAX_VERTICES}`;
  }

  return null;
}

async function analyzePolygon(req, res, next) {
  const body = req.body || {};
  const name = typeof body.name === "string" ? body.name.trim() : "";

  if (!name) {
    return res.status(400).json({
      success: false,
      error: "name is required and must be a non-empty string",
    });
  }

  const geometryError = validateGeometry(body.geometry);
  if (geometryError) {
    return res.status(400).json({
      success: false,
      error: geometryError,
    });
  }

  try {
    const data = await areaAnalysisService.analyzePolygon({
      name,
      geometry: body.geometry,
    });

    return res.status(200).json(data);
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

module.exports = {
  analyzePolygon,
};
