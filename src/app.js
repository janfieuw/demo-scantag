const path = require("path");
const express = require("express");
const cookieParser = require("cookie-parser");
const { layout } = require("./ui/layout");

const tagsRouter = require("./routes/tags");
const scanRouter = require("./routes/scan");
const pairRouter = require("./routes/pair");
const scantagPdfRouter = require("./routes/scantagPdf");


function createApp() {
  const app = express();

  app.use(express.urlencoded({ extended: false }));
  app.use(cookieParser());

  // Static styles
  app.use("/static", express.static(path.join(__dirname, "styles")));

  app.get("/", (req, res) => {
    res.send(
      layout(
        "PUNCTOO Demo",
        `<div class="card">
          <h1>PUNCTOO ScanTag Demo (Pilot)</h1>
          <p class="muted">Beperkt tot 1 bedrijf en 2 werknemers.</p>
          <div class="row">
            <a class="btn" href="/tags">Genereer QR’s</a>
          </div>
        </div>`
      )
    );
  });

  app.use(tagsRouter);
  app.use(scanRouter);
  app.use(pairRouter);
  app.use(scantagPdfRouter);

  // 404
  app.use((req, res) => {
    res.status(404).send(layout("404", `<div class="card"><h1>404</h1><p class="muted">Niet gevonden.</p></div>`));
  });

  return app;
}

module.exports = { createApp };
