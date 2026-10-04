const express = require("express");
const { createDashboardController } = require("../controllers/dashboardController");
const { createDashboardSheetService } = require("../services/dashboardSheetService");

function createDashboardRoutes({ googleIntegration, database, now, logger } = {}) {
  const router = express.Router();
  const service = createDashboardSheetService({ google: googleIntegration, database, now });
  const controller = createDashboardController(service, logger);
  router.get("/summary", controller.summary);
  router.get("/points", controller.points);
  router.get("/geometries", controller.geometries);
  router.get("/images/:parcelCode/first", controller.firstImage);
  router.get("/images/:parcelCode/:index", controller.indexedImage);
  router.dashboardService = service;
  return router;
}

module.exports = { createDashboardRoutes };
