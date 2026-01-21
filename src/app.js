// app.js
const express = require("express");
const cookieParser = require("cookie-parser");

const reportsRouter = require("./routes/reports");
const scanRouter = require("./routes/scan");

function createApp() {
  const app = express();

  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use(cookieParser());

  app.use("/static", express.static("public"));

  // Routes
  app.use(reportsRouter);
  app.use(scanRouter);

  // 404
  app.use((req, res) => {
    res.status(404).send("Not found");
  });

  return app;
}

module.exports = { createApp };
