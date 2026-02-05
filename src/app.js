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

// ScanTag flow + PDF
const deviceRouter = require("./routes/device");
const pairRouter = require("./routes/pair");
const scantagPdfRouter = require("./routes/scantagPdf");

function createApp() {
  const app = express();

  app.set("trust proxy", 1);

  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use(cookieParser());
  app.use("/img", express.static(path.join(__dirname, "img")));


  // ✅ Static files
  // 1) src/styles → /static
  app.use("/static", express.static(path.join(__dirname, "styles")));
  // 2) src/static → /static  (logo’s, png’s, extra assets)
  app.use("/static", express.static(path.join(__dirname, "static")));

  app.get("/", (req, res) => res.redirect("/demo/account"));

  app.use(accountRouter);
  app.use(wizardRouter);
  app.use(adminRouter);
  app.use(reportsRouter);
  app.use(scanRouter);
  app.use(tagsRouter);

  app.use(deviceRouter);
  app.use(pairRouter);
  app.use(scantagPdfRouter);

  app.use((req, res) => res.status(404).send("Not found"));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error("UNHANDLED ERROR:", err);
    res.status(500).send("Internal Server Error");
  });

  return app;
}

module.exports = { createApp };
