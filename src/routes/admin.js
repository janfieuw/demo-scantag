const express = require("express");
const { get, all } = require("../db");
const { layout, escapeHtml } = require("../ui/layout");

const router = express.Router();

function minutesBetween(a, b) {
  const ms = new Date(b) - new Date(a);
  return ms > 0 ? Math.floor(ms / 60000) : 0;
}

router.get("/admin", async (req, res) => {
  const company = await get(`SELECT id, name FROM companies ORDER BY id LIMIT 1`);
  if (!company) {
    return res.send(
      layout(
        "Rapport",
        `<div class="card">
          <h1>Rapport</h1>
          <p class="muted">Nog geen onderneming.</p>
          <a class="btn" href="/wizard/company">Start wizard</a>
        </div>`
      )
    );
  }

  const employees = await all(
    `SELECT id, display_name FROM employees WHERE company_id=$1 ORDER BY id`,
    [company.id]
  );

  const rows = [];

  for (const e of employees) {
    const lastIn = await get(
      `SELECT timestamp FROM scan_events
       WHERE employee_id=$1 AND direction='IN'
       ORDER BY timestamp DESC LIMIT 1`,
      [e.id]
    );

    const lastOut = await get(
      `SELECT timestamp FROM scan_events
       WHERE employee_id=$1 AND direction='OUT'
       ORDER BY timestamp DESC LIMIT 1`,
      [e.id]
    );

    let status = "—";
    let duration = 0;

    if (lastIn && lastOut) {
      duration = minutesBetween(lastIn.timestamp, lastOut.timestamp);
      status = "✅ afgerond";
    } else if (lastIn && !lastOut) {
      status = "⏳ open";
    } else if (!lastIn && lastOut) {
      status = "⚠️ onvolledig";
    }

    rows.push(`
      <tr>
        <td>${escapeHtml(e.display_name)}</td>
        <td>${lastIn ? escapeHtml(lastIn.timestamp) : "—"}</td>
        <td>${lastOut ? escapeHtml(lastOut.timestamp) : "—"}</td>
        <td>${duration}</td>
        <td>${status}</td>
      </tr>
    `);
  }

  res.send(
    layout(
      "Rapport",
      `<div class="card">
        <h1>Jouw rapport – ${escapeHtml(company.name)}</h1>
        <p class="muted">Laatste IN/OUT per werknemer + duur (minuten).</p>

        <table>
          <thead>
            <tr>
              <th>Werknemer</th>
              <th>Laatste IN</th>
              <th>Laatste OUT</th>
              <th>Duur (min)</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>${rows.join("")}</tbody>
        </table>

        <div class="row" style="margin-top:14px;">
          <a class="btn secondary" href="/tags">QR’s</a>
          <a class="btn secondary" href="/wizard/company">Wizard</a>
        </div>
      </div>`
    )
  );
});

module.exports = router;
