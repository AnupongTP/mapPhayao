const express = require("express");
const hazardLayerController = require("../controllers/hazardLayerController");

const router = express.Router();

router.get("/flood-recurrence", hazardLayerController.getFloodRecurrence);
router.get("/flood-recurrence-generation", hazardLayerController.getFloodRecurrenceGeneration);
router.get("/flood-recurrence/point", hazardLayerController.getFloodRecurrenceAtPoint);
router.get("/drought-recurrence", hazardLayerController.getDroughtRecurrence);

module.exports = router;
