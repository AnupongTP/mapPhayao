const express = require("express");
const locationReportController = require("../controllers/locationReportController");

const router = express.Router();

router.get("/", locationReportController.getLocationReport);

module.exports = router;
