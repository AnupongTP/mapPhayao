const express = require("express");
const lineController = require("../controllers/lineController");

function createLineRoutes(controller = lineController) {
const router = express.Router();

router.post("/location-analysis", controller.analyzeLocation);
router.post("/location-summary", controller.sendLocationSummary);

return router;
}

module.exports = createLineRoutes();
module.exports.createLineRoutes = createLineRoutes;
