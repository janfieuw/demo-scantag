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
  return `${req.protocol}://${req.get("host")}`;
}

router.get("/tags", async (req, res) => {
  const company = await getCompany(req);
  if (!company) return res.redirect("/demo/account");

  const tag = await getScantag(company.id);
  if (!tag) return res.redirect("/wizard/qrs");

  const employees = await getEmployees(company.id);
  const baseUrl = getBaseUrl(req);

  // ✅ per ScanTag endpoints
  const inUrl = `${baseUrl}/t/${tag.id}/in`;
  const outUrl = `${baseUrl}/t/${tag.id}/out`;

  // Echte QR’s als data URL (voor scherm-test)
  const qrOpts = { margin: 1, width: 220 };
  const inQrDataUrl = await QRCode.toDataURL(inUrl, qrOpts);
  const outQrDataUrl = await QRCode.toDataURL(outUrl, qrOpts);

  const empRows =
    employees.length === 0
      ? `<tr><td colspan="3">Geen werknemers gevonden.</td></tr>`
      : employees
          .map((e, idx) => {
            const code = String(e.scan_code || "").trim();
            return `
              <tr>
                <td>${idx + 1}</td>
                <td><b>${escapeHtml(employeeLabel(e))}</b></td>
                <td><code>${escapeHtml(code)}</code></td>
              </tr>
            `;
          })
          .join("");

  return res.send(
    layoutDemo(
      "SCAN TAGS",
      `
        <div class="demo-kicker">PUNCTOO — SCANTAG</div>
        <h1 class="demo-title">TAGS.</h1>

        <p class="demo-lead">
          Dit zijn de <b>echte ScanTag QR’s</b> (IN/OUT) volgens de vaste layout. 
          Print via PDF of test door te scannen vanaf je scherm.
        </p>

        <p class="demo-muted">
          Onderneming: <b>${escapeHtml(company.name)}</b><br>
          ScanTag: <b>${escapeHtml(tag.name || "ScanTag")}</b><br>
          Laatst bijgewerkt: <b>${escapeHtml(
            DateTime.now().setZone(TZ).toFormat("dd/LL/yyyy HH:mm")
          )}</b>
        </p>

        <div class="demo-actions" style="margin-top:12px;">
          <a class="demo-btn ghost" href="/wizard/reference">TERUG</a>
          <a class="demo-btn primary" href="/reports">RAPPORTEN</a>
          <a class="demo-btn secondary" href="/scantag/${tag.id}.pdf">DOWNLOAD PDF</a>
        </div>

        <div class="demo-tablewrap scroll-x" style="margin-top:14px;">
          <table class="demo-table">
            <thead>
              <tr>
                <th>IN QR</th>
                <th>OUT QR</th>
                <th>Links (debug)</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><img src="${inQrDataUrl}" alt="IN QR" style="width:220px;height:220px;border:2px solid #000;background:#fff;border-radius:6px;" /></td>
                <td><img src="${outQrDataUrl}" alt="OUT QR" style="width:220px;height:220px;border:2px solid #000;background:#fff;border-radius:6px;" /></td>
                <td style="font-size:12px;opacity:.85;">
                  <div><b>IN</b>: <code>${escapeHtml(inUrl)}</code></div>
                  <div><b>OUT</b>: <code>${escapeHtml(outUrl)}</code></div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <hr style="margin:18px 0;" />

        <p class="demo-muted"><b>Werknemers (codes)</b> — deze codes worden gebruikt na scan (device binding / identificatie).</p>

        <div class="demo-tablewrap scroll-x" style="margin-top:10px;">
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
