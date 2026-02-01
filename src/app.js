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

// ✅ nieuw nodig voor echte ScanTag flow + PDF
const deviceRouter = require("./routes/device");
const pairRouter = require("./routes/pair");
const scantagPdfRouter = require("./routes/scantagPdf");

function createApp() {
  const app = express();

  // Railway / reverse proxy (HTTPS termination)
  app.set("trust proxy", 1);

  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use(cookieParser());

  // Static files
  app.use("/static", express.static(path.join(__dirname, "styles")));

  app.get("/", (req, res) => res.redirect("/demo/account"));

  // Routes
  app.use(accountRouter);
  app.use(wizardRouter);
  app.use(adminRouter);
  app.use(reportsRouter);
  app.use(scanRouter);
  app.use(tagsRouter);

  // ✅ ScanTag “echte QR” routes
  app.use(deviceRouter);      // /t/:tagId(/in|out)
  app.use(pairRouter);        // /pair
  app.use(scantagPdfRouter);  // /scantag/:tagId.pdf

  app.use((req, res) => {
    res.status(404).send("Not found");
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error("UNHANDLED ERROR:", err);
    res.status(500).send("Internal Server Error");
  });

  return app;
}

module.exports = { createApp };
