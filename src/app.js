// src/app.js
const express = require("express");
const cookieParser = require("cookie-parser");
const path = require("path");

// Routers
const accountRouter = require("./routes/account");
const wizardRouter = require("./routes/wizard");
const adminRouter = require("./routes/admin");
const reportsRouter = require("./routes/reports");
const scanRouter = require("./routes/scan");
const tagsRouter = require("./routes/tags");

function createApp() {
  const app = express();

  // Railway / reverse proxy (HTTPS termination)
  app.set("trust proxy", 1);

  /* ------------------------
     Middleware
  ------------------------ */
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use(cookieParser());

  /* ------------------------
     Static files
  ------------------------ */
  // jouw project gebruikt /static voor styles + images
  app.use("/static", express.static(path.join(__dirname, "styles")));

  // (optioneel) als je ooit /styles/demo.css zou gebruiken:
  // app.use("/styles", express.static(path.join(__dirname, "styles")));

  /* ------------------------
     Home
  ------------------------ */
  app.get("/", (req, res) => res.redirect("/demo/account"));

  /* ------------------------
     Routes
  ------------------------ */
  app.use(accountRouter);
  app.use(wizardRouter);
  app.use(adminRouter);
  app.use(reportsRouter);
  app.use(scanRouter);
  app.use(tagsRouter);

  /* ------------------------
     404
  ------------------------ */
  app.use((req, res) => {
    res.status(404).send("Not found");
  });

  /* ------------------------
     Error handler (handig voor Railway logs)
  ------------------------ */
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error("UNHANDLED ERROR:", err);
    res.status(500).send("Internal Server Error");
  });

  return app;
}

module.exports = { createApp };
