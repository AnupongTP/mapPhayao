// Route ตัวอย่างสำหรับอ่านข้อมูลจาก PostgreSQL และทดสอบการเชื่อมต่อ
const express = require("express");
const pgConnectController = require("../controllers/pgConnectController");

const router = express.Router();

router.get("/pghello", pgConnectController.hello);
router.get("/provinces", pgConnectController.getProvinces);
router.get("/provinces/:name", pgConnectController.getProvinceByName);
router.get("/landmarks", pgConnectController.getLandmarks);
router.get("/landmarks/:keyword", pgConnectController.searchLandmarks);
router.get(
  "/landmarks/distance/:lat/:lng/:distance",
  pgConnectController.searchLandmarksByDistance,
);

router.get("/getprovince", pgConnectController.getProvinces);
router.get("/getprovince/:name", pgConnectController.getProvinceByName);
router.get("/getlandmark", pgConnectController.getLandmarks);
router.get("/getlandmark/:keyword", pgConnectController.searchLandmarks);
router.get(
  "/searchbydistance/:lat/:lng/:distance",
  pgConnectController.searchLandmarksByDistance,
);

module.exports = router;
