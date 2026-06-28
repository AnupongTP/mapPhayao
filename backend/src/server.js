// ไฟล์เริ่มต้นของ Backend: โหลด env, เปิด Express, ผูก routes, และส่ง error เป็น JSON
const path = require("path");

require("dotenv").config({
  path: path.resolve(__dirname, "../.env"),
});

const express = require("express");
const cors = require("cors");
const healthRoutes = require("./routes/healthRoutes");
const pgConnectRoutes = require("./routes/pgConnectRoutes");
const parcelRoutes = require("./routes/parcelRoutes");
const riceSuitabilityRoutes = require("./routes/riceSuitabilityRoutes");

const app = express();
const port = process.env.PORT || 3000;
const developmentOrigins = [
  "http://localhost",
  "http://127.0.0.1",
  "http://127.0.0.1:5500",
  "http://localhost:5500",
];
const configuredOrigins = String(process.env.CORS_ORIGINS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
// อนุญาตเฉพาะ origin ที่ตั้งใจใช้กับงานพัฒนา และ origin จาก CORS_ORIGINS
const allowedOrigins = new Set([
  ...(process.env.NODE_ENV === "production" ? [] : developmentOrigins),
  ...configuredOrigins,
]);

// CORS ต้องมาก่อน route ทั้งหมด เพื่อให้ browser อ่าน response ได้จาก origin ที่อนุญาต
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin)) {
        return callback(null, true);
      }

      return callback(new Error("Origin is not allowed by CORS"));
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);
// รับ JSON request body จาก frontend โดยจำกัดขนาดไว้พอเหมาะ
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

// ผูก route หลักของระบบไว้ที่จุดเดียว แล้วให้ controller แยก logic ย่อย
app.use("/api/health", healthRoutes);
app.use("/api/pgconnect", pgConnectRoutes);
app.use("/api/rice-suitability", riceSuitabilityRoutes);
app.use("/api/parcels", parcelRoutes);

app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

app.use((err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({
    success: false,
    error: err.message || "Server error",
  });
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
