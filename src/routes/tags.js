const express = require("express");
const QRCode = require("qrcode");
const { all } = require("../db");
const { layout, escapeHtml } = require("../ui/layout");

const router = express.Router();

function getBaseUrl(req) {
  // Railway/proxies: dankzij trust proxy wordt dit correct (https)
  return `${req.protocol}://${req.get("host")}`;
}

async function makeQrSvg(url) {
  return await QRCode.toString(url, {
    type: "svg",
    margin: 1,
    width: 180,
  });
}

router.get("/tags", async (req, res) => {
  const baseUrl = getBaseUrl(req);

  const tags = await all(
    `SELECT st.id AS tag_id, st.name AS tag_name, c.name AS company_name
     FROM scantags st JOIN companies c ON c.id = st.company_id
     ORDER BY st.id`
  );

  // Voor jouw pilot: meestal 1 tag, maar dit blijft generiek.
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
              <a href="/t/${t.tag_id}/in">/t/${t.tag_id}/in</a><br/>
              <span class="muted">${escapeHtml(inUrl)}</span>
            </div>
          </div>

          <div style="flex:1; min-width:260px;">
            <div class="muted strong">OUT</div>
            <div class="qrbox">${outSvg}</div>
            <div class="muted" style="margin-top:8px; word-break:break-all;">
              <a href="/t/${t.tag_id}/out">/t/${t.tag_id}/out</a><br/>
              <span class="muted">${escapeHtml(outUrl)}</span>
            </div>
          </div>
        </div>

        <div class="row" style="margin-top:14px;">
          <a class="btn" href="/scantag/${t.tag_id}.pdf">Download ScanTag PDF</a>
          <a class="btn secondary" href="/">Home</a>
        </div>
      </div>`;
    })
  );

  res.send(
    layout(
      "Genereer QR’s",
      `<div class="card" style="margin-bottom:14px;">
         <h1>Genereer QR’s</h1>
         <p class="muted">
           Deze QR’s zijn automatisch gegenereerd uit de URLs. Dezelfde demo kan dus door verschillende bedrijven gebruikt worden.
         </p>
       </div>
       ${blocks.join("")}`
    )
  );
});

module.exports = router;
