// Route สุขภาพระบบ ใช้ตรวจว่า backend และ database ยังตอบสนอง
const express = require("express");
const database = require("../config/database");

const router = express.Router();

router.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Rice suitability API is running",
  });
});

router.get("/database", async (req, res) => {
  try {
    const result = await database.checkConnection();

    res.status(200).json({
      success: true,
      database: "connected",
      databaseName: result.database_name,
      currentTime: result.current_time,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      database: "disconnected",
      error: error.message,
    });
  }
});

module.exports = router;
