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
    `SELECT id, name FROM companies WHERE demo_session_id=$1 ORDER BY id LIMIT 1`,
    [sid]
  );
}

async function getEmployees(companyId) {
  return await all(
    `
    SELECT id, first_name, last_name, display_name, scan_code
    FROM employees
    WHERE company_id=$1
    ORDER BY last_name, first_name
    `,
    [companyId]
  );
}

async function getScantag(companyId) {
  return await get(
    `SELECT id, name FROM scantags WHERE company_id=$1 ORDER BY id LIMIT 1`,
    [companyId]
  );
}

function employeeLabel(e) {
  if (e.last_name || e.first_name) {
    return `${e.last_name || ""} ${e.first_name || ""}`.trim();
  }
  return e.display_name || `#${e.id}`;
}

router.get("/tags", async (req, res) => {
  const company = await getCompany(req);
  if (!company) return res.redirect("/demo/account");

  const tag = await getScantag(company.id);
  const employees = await getEmployees(company.id);

  const baseUrl = `${req.protocol}://${req.get("host")}`;

  const rows =
    employees.length === 0
      ? `<tr><td colspan="5">Geen werknemers gevonden.</td></tr>`
      : employees
          .map((e, i) => {
            const code = escapeHtml(e.scan_code);
            return `
            <tr>
              <td>${i + 1}</td>
              <td><b>${escapeHtml(employeeLabel(e))}</b></td>
              <td><code>${code}</code></td>
              <td>
                <a class="demo-btn primary" href="/scan/${code}/in">IN</a>
                <a class="demo-btn ghost" href="/scan/${code}/out">OUT</a>
              </td>
              <td style="font-size:12px;">
                IN: ${baseUrl}/scan/${code}/in<br>
                OUT: ${baseUrl}/scan/${code}/out
              </td>
            </tr>
          `;
          })
          .join("");

  res.send(
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
        Laatst bijgewerkt:
        <b>${DateTime.now().setZone(TZ).toFormat("dd/LL/yyyy HH:mm")}</b>
      </p>

      <div class="demo-actions">
        <a class="demo-btn ghost" href="/wizard/reference">TERUG</a>
        <a class="demo-btn primary" href="/reports">RAPPORTEN</a>
      </div>

      <div class="demo-tablewrap scroll-x">
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
      `,
      { width: 850 }
    )
  );
});

module.exports = router;
