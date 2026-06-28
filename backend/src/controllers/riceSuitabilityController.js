// Controller รับ request จาก route แล้วตรวจพิกัดก่อนส่งต่อ service
const riceSuitabilityService = require("../services/riceSuitabilityService");

function parseCoordinate(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function validatePointQuery(query) {
  // lat/lng ต้องมีครบ เป็นตัวเลข และอยู่ในช่วงที่โลกใช้จริง
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

  return {
    latitude,
    longitude,
  };
}

async function getPointSummary(req, res, next) {
  // คอนโทรลเลอร์นี้ไม่คำนวณ GIS เอง ส่งพิกัดไปให้ service จัดการ
  const validation = validatePointQuery(req.query);

  if (validation.error) {
    return res.status(400).json({
      success: false,
      error: validation.error,
    });
  }

  try {
    const data = await riceSuitabilityService.getPointSummary(validation);
    return res.status(200).json(data);
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  getPointSummary,
};
