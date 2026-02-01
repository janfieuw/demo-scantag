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

async function getScantag(companyId) {
  return await get(
    `SELECT id, name FROM scantags WHERE company_id = $1 ORDER BY id ASC LIMIT 1`,
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

  const baseUrl = getBaseUrl(req);

  // ✅ echte ScanTag QR’s (IN/OUT) per ScanTag
  // Gebruik /t/:tagId/in|out als je device-flow gebruikt.
  const inUrl = `${baseUrl}/t/${tag.id}/in`;
  const outUrl = `${baseUrl}/t/${tag.id}/out`;

  const qrOpts = { margin: 1, width: 300 };
  const inQr = await QRCode.toDataURL(inUrl, qrOpts);
  const outQr = await QRCode.toDataURL(outUrl, qrOpts);

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

  // ✅ Cards zoals screenshot (2 naast elkaar)
  // We gebruiken inline CSS om exact te sturen zonder demo.css opnieuw te riskeren.
  const cardsHtml = `
    <div style="display:flex; gap:26px; flex-wrap:wrap; margin-top:18px;">
      ${renderScantagCard(inQr, "IN")}
      ${renderScantagCard(outQr, "OUT")}
    </div>
  `;

  return res.send(
    layoutDemo(
      "SCAN TAGS",
      `
        <div class="demo-kicker">PUNCTOO — SCANTAG</div>
        <h1 class="demo-title">TAGS.</h1>

        <p class="demo-lead">
          Dit zijn de echte ScanTag QR’s (IN/OUT) volgens de vaste layout.
          Print via PDF of test door te scannen vanaf je scherm.
        </p>

        <p class="demo-muted">
          Onderneming: <b>${escapeHtml(company.name)}</b><br>
          ScanTag: <b>${escapeHtml(tag?.name || "ScanTag")}</b><br>
          Laatst bijgewerkt: <b>${escapeHtml(DateTime.now().setZone(TZ).toFormat("dd/LL/yyyy HH:mm"))}</b>
        </p>

        <div class="demo-actions" style="margin-top:12px;">
          <a class="demo-btn ghost" href="/wizard/reference">TERUG</a>
          <a class="demo-btn primary" href="/reports">RAPPORTEN</a>
          <a class="demo-btn secondary" href="/scantag/${tag.id}.pdf">DOWNLOAD PDF</a>
        </div>

        ${cardsHtml}

        <p class="demo-muted" style="margin-top:18px;">
          <b>Werknemers (codes)</b> — deze codes worden gebruikt na scan (device binding / identificatie).
        </p>

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
      `,
      { bodyClass: "page-tags" }
    )
  );
});

function renderScantagCard(qrDataUrl, label) {
  // Vormgeving zoals je template: geel buiten, grijs vlak met inkeping, QR in wit vak met zwarte rand
  // Verticale Punctoo tekst (tussen IN/OUT) zit in je template normaal, maar op web tonen we die per card subtiel.
  const isIn = label === "IN";

  return `
    <div style="
      width: 300px;
      height: 360px;
      background: #cfcfcf;
      border-radius: 44px;
      position: relative;
      display:flex;
      align-items:center;
      justify-content:center;
      overflow:hidden;
    ">
      <!-- Inkeping -->
      <div style="
        position:absolute;
        ${isIn ? "left:-2px" : "right:-2px"};
        top: 140px;
        width: 0;
        height: 0;
        border-top: 34px solid transparent;
        border-bottom: 34px solid transparent;
        ${isIn ? "border-left: 34px solid #fdc500;" : "border-right: 34px solid #fdc500;"}
      "></div>

      <!-- QR frame -->
      <div style="
        width: 210px;
        height: 210px;
        background:#fff;
        border: 4px solid #000;
        box-shadow: 0 0 0 3px rgba(0,0,0,0.05);
        display:flex;
        align-items:center;
        justify-content:center;
      ">
        <img src="${qrDataUrl}" alt="${label} QR" style="width:100%; height:100%; object-fit:contain;" />
      </div>
    </div>
  `;
}

module.exports = router;
