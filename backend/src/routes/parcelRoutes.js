// Route ของแปลงเกษตร แยกไว้เพื่อไม่ปะปนกับ point-analysis API
const express = require("express");
const parcelController = require("../controllers/parcelController");

const router = express.Router();

router.post("/", parcelController.createParcel);
router.get("/", parcelController.listParcels);
router.get("/:id", parcelController.getParcel);
router.patch("/:id", parcelController.updateParcel);
router.delete("/:id", parcelController.deleteParcel);

module.exports = router;
