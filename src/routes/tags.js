// routes/tags.js
const express = require("express");
const { DateTime } = require("luxon");
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

router.get("/tags", async (req, res) => {
  const company = await getCompany(req);
  if (!company) return res.redirect("/demo/account");

  const tag = await getScantag(company.id);
  const employees = await getEmployees(company.id);

  const baseUrl = `${req.protocol}://${req.get("host")}`;

  const rows =
    employees.length === 0
      ? `<tr><td colspan="5">Geen werknemers gevonden. Ga terug naar stap 2.</td></tr>`
      : employees
          .map((e, idx) => {
            const code = String(e.scan_code || "").trim();

            const inUrl = `${baseUrl}/scan/${encodeURIComponent(code)}/in`;
            const outUrl = `${baseUrl}/scan/${encodeURIComponent(code)}/out`;

            return `
              <tr>
                <td>${idx + 1}</td>
                <td><b>${escapeHtml(employeeLabel(e))}</b></td>
                <td><code>${escapeHtml(code)}</code></td>
                <td style="display:flex; gap:10px; flex-wrap:wrap;">
                  <a class="demo-btn primary" href="/scan/${encodeURIComponent(code)}/in">IN</a>
                  <a class="demo-btn ghost" href="/scan/${encodeURIComponent(code)}/out">OUT</a>
                </td>
                <td style="font-size:12px; opacity:.85;">
                  <div>IN: ${escapeHtml(inUrl)}</div>
                  <div>OUT: ${escapeHtml(outUrl)}</div>
                </td>
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
          Gebruik onderstaande links om scans te simuleren (IN/OUT).
        </p>

        <p class="demo-muted">
          Onderneming: <b>${escapeHtml(company.name)}</b><br>
          ScanTag: <b>${escapeHtml(tag?.name || "ScanTag")}</b><br>
          Laatst bijgewerkt: <b>${escapeHtml(
            DateTime.now().setZone(TZ).toFormat("dd/LL/yyyy HH:mm")
          )}</b>
        </p>

        <div class="demo-actions" style="margin-top:12px;">
          <a class="demo-btn ghost" href="/wizard/reference">TERUG</a>
          <a class="demo-btn primary" href="/reports">RAPPORTEN</a>
        </div>

        <div class="demo-tablewrap scroll-x" style="margin-top:14px;">
          <table class="demo-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Werknemer</th>
                <th>Activatiecode</th>
                <th>Scan</th>
                <th>Links</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      `
    )
  );
});

module.exports = router;
