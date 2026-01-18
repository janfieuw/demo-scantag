const path = require("path");
const express = require("express");
const cookieParser = require("cookie-parser");
const { layout } = require("./ui/layout");

const accountRouter = require("./routes/account");
const wizardRouter = require("./routes/wizard");
const tagsRouter = require("./routes/tags");
const scanRouter = require("./routes/scan");
const adminRouter = require("./routes/admin");

function createApp() {
  const app = express();

  app.set("trust proxy", 1);

  app.use(express.urlencoded({ extended: false }));
  app.use(cookieParser());

  // Styles
  // Static assets (styles + images)
app.use("/static", express.static(path.join(__dirname, "styles")));
app.use("/static", express.static(path.join(__dirname, "static")));


  // Landing: start with Account (per definitieve demo-flow)
  app.get("/", (req, res) => {
    return res.redirect("/demo/account");
  });

  // Demo/account
  app.use(accountRouter);

  // App routes
  app.use(wizardRouter);
  app.use(tagsRouter);
  app.use(scanRouter);
  app.use(adminRouter);

  app.use((req, res) => {
    res
      .status(404)
      .send(layout("404", `<div class="card"><h1>404</h1><p class="muted">Niet gevonden.</p></div>`));
  });

  return app;
}

module.exports = { createApp };
