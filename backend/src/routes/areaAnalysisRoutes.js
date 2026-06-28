const express = require("express");
const areaAnalysisController = require("../controllers/areaAnalysisController");

const router = express.Router();

router.post("/polygon", areaAnalysisController.analyzePolygon);

module.exports = router;
