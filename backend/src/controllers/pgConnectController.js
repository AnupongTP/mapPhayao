// Controller ตัวอย่างสำหรับข้อมูลเชื่อม PostgreSQL และ query ทดสอบ
const pgConnectService = require("../services/pgConnectService");

function hello(req, res) {
  res.send("Hello from postgres connection");
}

async function getProvinces(req, res, next) {
  try {
    const data = await pgConnectService.getProvinces();
    res.status(200).json(data);
  } catch (error) {
    next(error);
  }
}

async function getProvinceByName(req, res, next) {
  try {
    const data = await pgConnectService.getProvinceByName(req.params.name);
    res.status(200).json(data);
  } catch (error) {
    next(error);
  }
}

async function getLandmarks(req, res, next) {
  try {
    const data = await pgConnectService.getLandmarks();
    res.status(200).json(data);
  } catch (error) {
    next(error);
  }
}

async function searchLandmarks(req, res, next) {
  try {
    const data = await pgConnectService.searchLandmarks(req.params.keyword);
    res.status(200).json(data);
  } catch (error) {
    next(error);
  }
}

async function searchLandmarksByDistance(req, res, next) {
  try {
    const data = await pgConnectService.searchLandmarksByDistance({
      lat: Number(req.params.lat),
      lng: Number(req.params.lng),
      distance: Number(req.params.distance),
    });
    res.status(200).json(data);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  hello,
  getProvinces,
  getProvinceByName,
  getLandmarks,
  searchLandmarks,
  searchLandmarksByDistance,
};
