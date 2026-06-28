// Import required modules
const express = require("express");
// Create an instance of Express
const app = express();
const port = process.env.PORT || 3000; // Use the provided port or default to 3000

const bodyParser = require("body-parser");

const pgconnect = require('./pgconnect');

app.use(bodyParser.json());

app.use(bodyParser.urlencoded({ extended: true }));
// Define routes
app.get("/", (req, res) => {
  res.send("Hello, World!");
});

app.get("/test", (req, res) => {
  res.send("This is testing");
});

app.get("/testjson", (req, res) => {
  const myjson = [
    { name: "A", age: 20, gender: "F" },
    { name: "B", age: 22, gender: "M" },
    { name: "C", age: 23, gender: "F" },
    { name: "D", age: 21, gender: "M" },
  ];
  res.send(myjson);
});

app.get("/sendword/:myword", (req, res) => {
  const myword = req.params.myword;
  const result = "Hi!, your word is " + myword;
  res.send(result);
});

app.get("/circle/:radius", (req, res) => {
  const radius = req.params.radius;

  const result = {
    perimeter: 2 * 3.14 * radius,
    area: 3.14 * radius * radius,
  };
  res.send(result);
});
app.get("/grade/:score", (req, res) => {
  const score = req.params.score;

  let grade = "";

  if (score >= 80) {
    grade = "A";
  } else if (score >= 70 && score < 80) {
    grade = "B";
  } else if (score >= 50 && score < 70) {
    grade = "C";
  } else if (score >= 40 && score < 50) {
    grade = "D";
  } else {
    grade = "F";
  }

  res.send("คุณได้เกรด " + grade);
});

app.get("/getgrade/:name/:score", (req, res) => {
  const iname = req.params.name;

  const score = req.params.score;

  let grade = "";

  if (score >= 80) {
    grade = "A";
  } else if (score >= 70 && score < 80) {
    grade = "B";
  } else if (score >= 50 && score < 70) {
    grade = "C";
  } else if (score >= 40 && score < 50) {
    grade = "D";
  } else {
    grade = "F";
  }

  const result = {
    name: iname,

    score: score,

    grade: grade,
  };

  res.send(result);
});

app.post("/testpost", (req, res, next) => {
  let name = req.body.name;

  let score = req.body.score;

  let grade = req.body.grade;

  console.log(name);

  const result = `ชื่อ ${name} คะแนน ${score} เกรด ${grade}`;

  res.send(result);
});

app.post("/sendjson", (req, res, next) => {
  let wayid = req.body.wayid;
  let gjson = req.body.gjson;
  let length = req.body.length;
  let result = {
    wid: wayid,
    coors: gjson["coordinates"],
    length: length,
  };
  res.send(result);
});

app.post("/sendgeojson", (req, res, next) => {
  let geojson = req.body.data;
  let result = geojson["features"].map((item) => {
    return {
      name: item["properties"]["name"],
      lat: item["geometry"]["coordinates"][1],
      lng: item["geometry"]["coordinates"][0],
    };
  });
  res.send(result);
});

app.use("/api/pgconnect", pgconnect);

// Start the server
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
