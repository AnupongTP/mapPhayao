const express = require("express");
const lineController = require("../controllers/lineController");

const router = express.Router();

router.post("/location-analysis", lineController.analyzeLocation);
router.post("/location-summary", lineController.sendLocationSummary);

module.exports = router;
