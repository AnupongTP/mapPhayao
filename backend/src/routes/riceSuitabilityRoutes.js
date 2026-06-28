// Route สำหรับ point analysis ใช้เฉพาะพิกัดที่ผู้ใช้กดยืนยันแล้ว
const express = require("express");
const riceSuitabilityController = require("../controllers/riceSuitabilityController");

const router = express.Router();

router.get("/point", riceSuitabilityController.getPointSummary);

module.exports = router;
