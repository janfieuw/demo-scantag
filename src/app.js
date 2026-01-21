// app.js
const express = require("express");
const cookieParser = require("cookie-parser");
const path = require("path");

// Bestaande routes (die jij al hebt)
const accountRouter = require("./routes/account");
const wizardRouter = require("./routes/wizard");
const adminRouter = require("./routes/admin");

// Nieuwe routes (die we net toegevoegd hebben)
const reportsRouter = require("./routes/reports");
const scanRouter = require("./routes/scan");

function createApp() {
  const app = express();

  // Middleware
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use(cookieParser());

  // Static files: zorg dat /static/* werkt (base.css, demo.css, afbeeldingen, ...)
  // Pas deze folder aan als jouw assets niet in ./public staan.
  app.use("/static", express.static(path.join(__dirname, "public")));

  // Home -> start flow
  app.get("/", (req, res) => {
    return res.redirect("/demo/account");
  });

  // Routes mounten (BELANGRIJK)
  app.use(accountRouter);
  app.use(wizardRouter);
  app.use(adminRouter);

  app.use(reportsRouter);
  app.use(scanRouter);

  // 404 (altijd als laatste)
  app.use((req, res) => {
    res.status(404).send("Not found");
  });

  return app;
}

module.exports = { createApp };
