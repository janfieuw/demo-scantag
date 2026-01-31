const express = require("express");
const crypto = require("crypto");
const { DateTime } = require("luxon");
const { get, all, run } = require("../db");
const { layoutDemo, escapeHtml } = require("../ui/layout");

const router = express.Router();
const TZ = "Europe/Brussels";

/* =========================
   Helpers
   ========================= */

function getDemoSession(req) {
  return String(req.cookies?.demo_session || "").trim();
}

async function getCompany(req) {
  const sid = getDemoSession(req);
  if (!sid) return null;

  return await get(
    `SELECT id, name FROM companies WHERE demo_session_id = $1 LIMIT 1`,
    [sid]
  );
}

function generateScanCode() {
  return crypto.randomBytes(4).toString("hex");
}

function employeeLabel(e) {
  return `${e.last_name || ""} ${e.first_name || ""}`.trim();
}

/* =========================
   STEP 3 — Reference
   ========================= */

router.get("/wizard/reference", async (req, res) => {
  const company = await getCompany(req);
  if (!company) return res.redirect("/wizard/company");

  const employees = await all(
    `SELECT * FROM employees WHERE company_id = $1 ORDER BY id`,
    [company.id]
  );

  const rows = employees
    .map((e, i) => {
      const ok = !!e.reference_mode;
      return `
        <tr>
          <td>${i + 1}</td>
          <td>${escapeHtml(employeeLabel(e))}</td>
          <td>
            <form method="POST" action="/wizard/reference/open" style="display:flex; gap:8px;">
              <input type="hidden" name="employee_id" value="${e.id}" />
              <select class="demo-select" name="mode" required>
                <option value="" disabled ${!e.reference_mode ? "selected" : ""}>Kies…</option>
                <option value="ROOSTER" ${e.reference_mode === "ROOSTER" ? "selected" : ""}>Rooster</option>
                <option value="KALENDER" ${e.reference_mode === "KALENDER" ? "selected" : ""}>Kalender</option>
              </select>
              <button class="demo-btn primary" type="submit">VUL AAN</button>
            </form>
          </td>
          <td>${ok ? "OK" : "—"}</td>
        </tr>
      `;
    })
    .join("");

  return res.send(
    layoutDemo(
      "DEMO — STAP 3",
      `
        <div class="demo-kicker">DEMO UITTESTEN — IN 3 STAPPEN</div>
        <h1 class="demo-title">STAP 3.</h1>

        <p class="demo-lead">
          Kies per werknemer <b>Rooster</b> of <b>Kalender</b> en klik daarna op <b>Vul aan</b>.
        </p>

        <p class="demo-muted">Onderneming: <b>${escapeHtml(company.name)}</b></p>

        <div class="demo-tablewrap" style="margin-top:16px;">
          <table class="demo-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Werknemer</th>
                <th>Instelling</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>

        <div class="demo-actions" style="margin-top:18px;">
          <a class="demo-btn ghost" href="/wizard/employees">TERUG</a>
          <a class="demo-btn primary" href="/wizard/qrs">VOLGENDE</a>
        </div>
      `,
      { width: 850 }   // ⭐ IDENTIEK AAN reports & tags
    )
  );
});

module.exports = router;
