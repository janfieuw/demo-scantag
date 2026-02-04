// src/routes/tags.js
const express = require("express");
const { DateTime } = require("luxon");
const QRCode = require("qrcode");
const { get, all } = require("../db");
const { layoutDemo, escapeHtml } = require("../ui/layout");

const router = express.Router();
const TZ = "Europe/Brussels";

function getDemoSession(req) {
  return String(req.cookies?.demo_session || "").trim();
}

async function getCompany(req) {
  const sid = getDemoSession(req);
  if (!sid) return null;

  return await get(
    `SELECT id, name FROM companies WHERE demo_session_id = $1 ORDER BY id LIMIT 1`,
    [sid]
  );
}

async function getScantag(companyId) {
  return await get(
    `SELECT id, name FROM scantags WHERE company_id = $1 ORDER BY id ASC LIMIT 1`,
    [companyId]
  );
}

async function getEmployees(companyId) {
  return await all(
    `
    SELECT id, first_name, last_name, display_name, scan_code
    FROM employees
    WHERE company_id = $1
    ORDER BY
      COALESCE(last_name, '') ASC,
      COALESCE(first_name, '') ASC,
      COALESCE(display_name, '') ASC,
      id ASC
    `,
    [companyId]
  );
}

function employeeLabel(e) {
  const fn = String(e.first_name || "").trim();
  const ln = String(e.last_name || "").trim();
  if (ln || fn) return `${ln} ${fn}`.trim();
  return String(e.display_name || "").trim() || `#${e.id}`;
}

function getBaseUrl(req) {
  const proto = (req.headers["x-forwarded-proto"] || req.protocol || "https")
    .toString()
    .split(",")[0]
    .trim();
  return `${proto}://${req.get("host")}`;
}

router.get("/tags", async (req, res) => {
  const company = await getCompany(req);
  if (!company) return res.redirect("/demo/account");

  const tag = await getScantag(company.id);
  if (!tag) return res.redirect("/wizard/qrs");

  const employees = await getEmployees(company.id);

  // ✅ per ScanTag IN/OUT
  const baseUrl = getBaseUrl(req);
  const inUrl = `${baseUrl}/t/${tag.id}/in`;
  const outUrl = `${baseUrl}/t/${tag.id}/out`;

  // QR’s als dataURL (worden als <img> bovenop template geplaatst)
  const qrOpts = { margin: 1, width: 600 };
  const inQrDataUrl = await QRCode.toDataURL(inUrl, qrOpts);
  const outQrDataUrl = await QRCode.toDataURL(outUrl, qrOpts);

  const empRows =
    employees.length === 0
      ? `<tr><td colspan="3">Geen werknemers gevonden.</td></tr>`
      : employees
          .map(
            (e, idx) => `
              <tr>
                <td>${idx + 1}</td>
                <td><b>${escapeHtml(employeeLabel(e))}</b></td>
                <td><code>${escapeHtml(String(e.scan_code || ""))}</code></td>
              </tr>
            `
          )
          .join("");

  // Template afmetingen (jouw file is 1772x1182)
  // QR vakken (pixel coords in template):
  // Left:  x=258 y=390 w=383 h=383
  // Right: x=1120 y=390 w=383 h=383
  //
  // We plaatsen QR’s via percentages zodat het mee schaalt met de template.
  const TEMPLATE_W = 1772;
  const TEMPLATE_H = 1182;

  const leftBox = { x: 258, y: 390, w: 383, h: 383 };
  const rightBox = { x: 1120, y: 390, w: 383, h: 383 };

  function pctX(px) {
    return (px / TEMPLATE_W) * 100;
  }
  function pctY(px) {
    return (px / TEMPLATE_H) * 100;
  }

  // padding binnen het witte vak (in template pixels)
  const PAD = 16;

  const inStyle = `
    left:${pctX(leftBox.x + PAD)}%;
    top:${pctY(leftBox.y + PAD)}%;
    width:${pctX(leftBox.w - 2 * PAD)}%;
    height:${pctY(leftBox.h - 2 * PAD)}%;
  `;

  const outStyle = `
    left:${pctX(rightBox.x + PAD)}%;
    top:${pctY(rightBox.y + PAD)}%;
    width:${pctX(rightBox.w - 2 * PAD)}%;
    height:${pctY(rightBox.h - 2 * PAD)}%;
  `;

  return res.send(
    layoutDemo(
      "PUNCTOO — SCANTAG",
      `
        
         
        </p>
     <p class="demo-muted" style="margin-top:18px;">
        <h1 class="demo-title">Stap 5/5: SMARTPHONE KOPPELEN.</h1>
        Download jouw scantag.<br>  
        Laat de werknemer vervolgens de <b>IN</b> scannen.
          <br>Op de smartphone moet dan de onderstaande code ingevuld worden om smartphone te koppelen.<br>
          Het koppelen van de smartphone is meteen ook de eerste tijdsregistratie.<br>
          Daarna kan je aan de slag: print de ScanTag af en hang uit.
        </p>
       

        <div class="demo-actions" style="margin-top:12px;">
         
   
          <a class="demo-btn secondary" href="/scantag/${tag.id}.pdf">DOWNLOAD PDF</a>
        </div>

      

   

        <div class="demo-tablewrap" style="margin-top:10px;">
          <table class="demo-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Werknemer</th>
                <th>Activatiecode</th>
              </tr>
            </thead>
            <tbody>${empRows}</tbody>
          </table>
        </div>
      `
    )
  );
});

module.exports = router;
