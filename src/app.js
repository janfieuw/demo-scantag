const path = require("path");
const express = require("express");
const cookieParser = require("cookie-parser");
const { layout } = require("./ui/layout");

const wizardRouter = require("./routes/wizard");
const tagsRouter = require("./routes/tags");
const scanRouter = require("./routes/scan");
const adminRouter = require("./routes/admin");

function createApp() {
  const app = express();

  app.set("trust proxy", 1);

  app.use(express.urlencoded({ extended: false }));
  app.use(cookieParser());

  app.use("/static", express.static(path.join(__dirname, "styles")));

  app.get("/", (req, res) => {
    res.send(
      layout(
        "PUNCTOO Demo (Pilot)",
        `<div class="card">
          <h1>PUNCTOO ScanTag Demo (Pilot)</h1>
          <p class="muted">Wizard: onderneming → 2 werknemers → QR’s. Activatie via activatiecode.</p>
          <div class="row">
            <a class="btn" href="/wizard/company">Start wizard</a>
            <a class="btn secondary" href="/admin">Rapport</a>
          </div>
        </div>`
      )
    );
  });

  app.use(wizardRouter);
  app.use(tagsRouter);
  app.use(scanRouter);
  app.use(adminRouter);

  app.use((req, res) => {
    res.status(404).send(layout("404", `<div class="card"><h1>404</h1><p class="muted">Niet gevonden.</p></div>`));
  });

  return app;
}

module.exports = { createApp };
