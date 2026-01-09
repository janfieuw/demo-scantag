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

async function getCompany() {
  return await get(`SELECT id, name FROM companies ORDER BY id LIMIT 1`);
}
async function employeesCount(companyId) {
  const row = await get(`SELECT COUNT(*)::int AS n FROM employees WHERE company_id = $1`, [companyId]);
  return row?.n || 0;
}

router.get("/tags", async (req, res) => {
  const company = await getCompany();
  if (!company) {
    return res.send(
      layout(
        "Setup nodig",
        `<div class="card">
          <h1>Eerst setup doen</h1>
          <p class="muted">Maak eerst 1 bedrijf aan.</p>
          <div class="row" style="margin-top:14px;">
            <a class="btn" href="/setup">Ga naar setup</a>
          </div>
        </div>`
      )
    );
  }

  const n = await employeesCount(company.id);
  if (n < 2) {
    return res.send(
      layout(
        "Setup nodig",
        `<div class="card">
          <h1>Eerst setup doen</h1>
          <p class="muted">Voeg eerst 2 werknemers toe.</p>
          <div class="row" style="margin-top:14px;">
            <a class="btn" href="/setup/employees">Werknemers toevoegen</a>
            <a class="btn secondary" href="/setup">Terug</a>
          </div>
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
              <span class="muted">${escapeHtml(inUrl)}</span>
            </div>
          </div>

          <div style="flex:1; min-width:260px;">
            <div class="muted strong">OUT</div>
            <div class="qrbox">${outSvg}</div>
            <div class="muted" style="margin-top:8px; word-break:break-all;">
              <span class="muted">${escapeHtml(outUrl)}</span>
            </div>
          </div>
        </div>

        <div class="row" style="margin-top:14px;">
          <a class="btn" href="/scantag/${t.tag_id}.pdf">Download ScanTag PDF</a>
          <a class="btn secondary" href="/setup">Setup</a>
        </div>
      </div>`;
    })
  );

  res.send(
    layout(
      "Genereer QR’s",
      `<div class="card" style="margin-bottom:14px;">
         <h1>Genereer QR’s</h1>
         <p class="muted">QR’s zijn automatisch gegenereerd uit URLs.</p>
       </div>
       ${blocks.join("")}`
    )
  );
});

module.exports = router;
