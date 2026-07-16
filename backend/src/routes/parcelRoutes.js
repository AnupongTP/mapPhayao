// Route ของแปลงเกษตร แยกไว้เพื่อไม่ปะปนกับ point-analysis API
const express = require("express");
const parcelController = require("../controllers/parcelController");
const { createLineAuthMiddleware } = require("../middleware/lineAuthMiddleware");

const router = express.Router();
const requireLineAuth = createLineAuthMiddleware();

router.use(requireLineAuth);

router.post("/", parcelController.createParcel);
router.get("/mine", parcelController.listParcels);
router.get("/", parcelController.listParcels);
router.post("/:parcelId/analyze", parcelController.analyzeParcel);
router.get("/:parcelId", parcelController.getParcel);
router.patch("/:parcelId", parcelController.updateParcel);
router.delete("/:parcelId", parcelController.deleteParcel);

module.exports = router;
