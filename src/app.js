// app.js
const express = require("express");
const cookieParser = require("cookie-parser");
const path = require("path");

// Routers
const accountRouter = require("./routes/account");
const wizardRouter = require("./routes/wizard");
const adminRouter = require("./routes/admin");
const reportsRouter = require("./routes/reports");
const scanRouter = require("./routes/scan");

function createApp() {
  const app = express();

  /* ------------------------
     Middleware
  ------------------------ */
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use(cookieParser());

  /* ------------------------
     Static files
     /static → src/styles
  ------------------------ */
  app.use(
    "/static",
    express.static(path.join(__dirname, "styles"))
  );

  /* ------------------------
     Home
  ------------------------ */
  app.get("/", (req, res) => {
    return res.redirect("/demo/account");
  });

  /* ------------------------
     Routes
  ------------------------ */
  app.use(accountRouter);
  app.use(wizardRouter);
  app.use(adminRouter);
  app.use(reportsRouter);
  app.use(scanRouter);

  /* ------------------------
     404
  ------------------------ */
  app.use((req, res) => {
    res.status(404).send("Not found");
  });

  return app;
}

module.exports = { createApp };
