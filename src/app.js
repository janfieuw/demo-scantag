// app.js
const express = require("express");
const cookieParser = require("cookie-parser");

const reportsRouter = require("./routes/reports");
const scanRouter = require("./routes/scan");

// Als je nog andere routers hebt, voeg ze hier toe:
// const demoAccountRouter = require("./routes/account");
// const wizardRouter = require("./routes/wizard");

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
  ------------------------ */
  app.use("/static", express.static("public"));

  /* ------------------------
     Home
  ------------------------ */
  app.get("/", (req, res) => {
    // ✅ meest logische entrypoint: account eerst
    return res.redirect("/demo/account");

    // alternatief:
    // return res.redirect("/wizard/company");
  });

  /* ------------------------
     Routes
  ------------------------ */

  // Jouw bestaande routers (zorg dat deze files bestaan)
  app.use(reportsRouter);
  app.use(scanRouter);

  // Als je account/wizard routers hebt, mount ze ook:
  // app.use(demoAccountRouter);
  // app.use(wizardRouter);

  /* ------------------------
     404
  ------------------------ */
  app.use((req, res) => {
    res.status(404).send("Not found");
  });

  return app;
}

module.exports = { createApp };
