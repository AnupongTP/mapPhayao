SELECT prov_namet, prov_namee
FROM thailand_province1;

SELECT gid, lm_id, lm_name, ST_AsGeoJSON(geom) AS geojson
FROM landmarks;
