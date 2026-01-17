const express = require("express");
const QRCode = require("qrcode");
const { get, all } = require("../db");
const { layout, escapeHtml } = require("../ui/layout");

const router = express.Router();

function getBaseUrl(req) {
  return `${req.protocol}://${req.get("host")}`;
}

async function makeQrSvg(url) {
  return await QRCode.toString(url, { type: "svg", margin: 1, width: 180 });
}

router.get("/tags", async (req, res) => {
  // wizard guard: bedrijf + 2 werknemers nodig
  const company = await get(`SELECT id, name FROM companies ORDER BY id LIMIT 1`);
  if (!company) {
    return res.send(
      layout(
        "Wizard nodig",
        `<div class="card">
          <h1>Eerst wizard doorlopen</h1>
          <p class="muted">Maak eerst een onderneming en 2 werknemers aan.</p>
          <a class="btn" href="/wizard/company">Start wizard</a>
        </div>`
      )
    );
  }
  const cnt = await get(`SELECT COUNT(*)::int AS n FROM employees WHERE company_id=$1`, [company.id]);
  if ((cnt?.n || 0) < 2) {
    return res.send(
      layout(
        "Wizard nodig",
        `<div class="card">
          <h1>Eerst wizard doorlopen</h1>
          <p class="muted">Voeg eerst 2 werknemers toe.</p>
          <a class="btn" href="/wizard/employees">Ga naar werknemers</a>
        </div>`
      )
    );
  }

  const baseUrl = getBaseUrl(req);

  const tags = await all(
    `SELECT st.id AS tag_id, st.name AS tag_name, c.name AS company_name
     FROM scantags st JOIN companies c ON c.id = st.company_id
     ORDER BY st.id`
  );

  const blocks = await Promise.all(
    tags.map(async (t) => {
      const inUrl = `${baseUrl}/t/${t.tag_id}/in`;
      const outUrl = `${baseUrl}/t/${t.tag_id}/out`;

      const inSvg = await makeQrSvg(inUrl);
      const outSvg = await makeQrSvg(outUrl);

      return `
      <div class="card" style="margin-bottom:14px;">
        <h1 style="margin-bottom:6px;">${escapeHtml(t.company_name)}</h1>
        <p class="muted" style="margin-top:0;">${escapeHtml(t.tag_name)}</p>

        <div class="row" style="align-items:flex-start;">
          <div style="flex:1; min-width:260px;">
            <div class="muted strong">IN</div>
            <div class="qrbox">${inSvg}</div>
            <div class="muted" style="margin-top:8px; word-break:break-all;">
              <span>${escapeHtml(inUrl)}</span>
            </div>
          </div>

          <div style="flex:1; min-width:260px;">
            <div class="muted strong">OUT</div>
            <div class="qrbox">${outSvg}</div>
            <div class="muted" style="margin-top:8px; word-break:break-all;">
              <span>${escapeHtml(outUrl)}</span>
            </div>
          </div>
        </div>

        <div class="row" style="margin-top:14px;">
          <a class="btn secondary" href="/admin">Rapport</a>
          <a class="btn secondary" href="/wizard/company">Wizard</a>
        </div>
      </div>`;
    })
  );

  res.send(
    layout(
      "Genereer QR’s",
      `<div class="card" style="margin-bottom:14px;">
         <h1>3) Genereer QR’s</h1>
         <p class="muted">De QR’s worden automatisch gegenereerd op basis van de URLs van deze omgeving.</p>
       </div>
       ${blocks.join("")}`
    )
  );
});

module.exports = router;
