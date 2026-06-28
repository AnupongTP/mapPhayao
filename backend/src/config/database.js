// ไฟล์นี้สร้าง PostgreSQL Pool และใช้ร่วมกันทุก service ของ backend
const { Pool } = require("pg");

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

async function checkConnection() {
  // ใช้ query เล็ก ๆ เพื่อเช็กว่า backend ติดต่อฐานข้อมูลได้จริง
  const result = await pool.query(
    `SELECT NOW() AS current_time,
      current_database() AS database_name;`,
  );

  return result.rows[0];
}

module.exports = {
  query: function (text, params) {
    return pool.query(text, params);
  },
  checkConnection,
  pool,
};
