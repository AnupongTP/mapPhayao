// Service ตัวอย่างสำหรับดึงข้อมูลจาก PostgreSQL ผ่าน pool กลาง
const db = require("../config/database");

async function getProvinces() {
  const result = await db.query(
    "SELECT prov_namet, prov_namee FROM thailand_province1;",
  );
  return result.rows;
}

async function getProvinceByName(name) {
  // ใช้ parameterized query ทุกครั้ง ไม่ต่อ SQL จากค่า user ตรง ๆ
  const result = await db.query(
    `SELECT ST_AsGeoJSON(geom) AS gjon, prov_namet, prov_namee
     FROM thailand_province1
     WHERE prov_namet LIKE $1;`,
    [name],
  );
  return result.rows;
}

async function getLandmarks() {
  const result = await db.query(
    `SELECT gid, lm_id, lm_name, ST_AsGeoJSON(geom) AS geojson
     FROM landmarks;`,
  );
  return result.rows;
}

async function searchLandmarks(keyword) {
  const result = await db.query(
    `SELECT lm_id, lm_name, ST_Y(geom) AS lat, ST_X(geom) AS lng
     FROM landmarks
     WHERE lm_name LIKE $1;`,
    [`%${keyword}%`],
  );
  return result.rows;
}

async function searchLandmarksByDistance({ lat, lng, distance }) {
  // ระยะทางคำนวณบนพิกัดจริงของฐานข้อมูล ไม่ใช่บนค่าใน browser
  const result = await db.query(
    `SELECT gid, lm_name, ST_AsGeoJSON(geom) AS geojson
     FROM landmarks
     WHERE ST_DistanceSphere(
       ST_GeomFromText($1, 4326),
       landmarks.geom
     ) <= $2;`,
    [`POINT(${lng} ${lat})`, distance],
  );
  return result.rows;
}

module.exports = {
  getProvinces,
  getProvinceByName,
  getLandmarks,
  searchLandmarks,
  searchLandmarksByDistance,
};
