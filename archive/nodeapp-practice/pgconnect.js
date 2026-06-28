const express = require("express");
const bodyParser = require("body-parser");
const { Pool, Client } = require("pg");
const cors = require("cors");

const router = express.Router();
router.use(bodyParser.json());
router.use(bodyParser.urlencoded({ extended: true }));

//อนุญาตให้เรียกจาก localhost ได้
router.use(
  cors({
    origin: ["http://localhost"],
  }),
);

const pool = new Pool({
  user: "postgres",
  host: "localhost",
  database: "map1",
  password: "Koonole_123",
  port: "5432",
});

router.get("/pghello", (req, res) => {
  res.send("Hello from postgres connection");
});

router.get("/getprovince", async (req, res) => {
  let data;
  const sql = `SELECT prov_namet, prov_namee FROM thailand_province1;`;
  const result = await pool.query(sql);
  data = result.rows;
  res.status(200).send(data);
});

router.get("/getlandmark", async (req, res) => {
  let data;
  const sql = `SELECT gid,lm_id,lm_name,
       ST_AsGeoJSON(geom) AS geojson
FROM landmarks;`;
  const result = await pool.query(sql);
  data = result.rows;
  res.status(200).send(data);
});

router.get("/getprovince/:name", async (req, res) => {
  const prov_name = req.params.name;
  let data;
  const sql = `SELECT ST_AsGeoJSON(geom) as gjon,prov_namet , prov_namee FROM thailand_province1 where prov_namet like '${prov_name}';`;
  const result = await pool.query(sql);
  data = result.rows;
  res.status(200).send(data);
});

router.get("/getlandmark/:keyword", async (req, res) => {
  const kw = req.params.keyword;
  let data;
  const sql = `select lm_id, lm_name, st_y(geom) as lat, st_x(geom) as lng 
                from landmarks where lm_name like '%${kw}%';`;
  const result = await pool.query(sql);
  data = result.rows;
  res.status(200).send(data);
});
router.get("/searchbydistance/:lat/:lng/:distance", async (req, res) => {
  const lat = req.params.lat;
  const lng = req.params.lng;
  const distance = req.params.distance;
  const sql = `SELECT gid, lm_name ,ST_AsGeoJSON(geom) AS geojson from landmarks
  where st_distancesphere(st_geomfromtext('POINT(${lng} ${lat})',4326),landmarks.geom)<= ${distance};`;
  try {
    const result = await pool.query(sql);
    res.status(200).send(result.rows);
  } catch (err) {
    res.status(200).send(err);
  }
});

module.exports = router;
