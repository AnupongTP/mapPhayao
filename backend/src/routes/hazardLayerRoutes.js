const express = require("express");
const hazardLayerController = require("../controllers/hazardLayerController");

const router = express.Router();

router.get("/flood-recurrence", hazardLayerController.getFloodRecurrence);
router.get("/drought-recurrence", hazardLayerController.getDroughtRecurrence);

module.exports = router;
