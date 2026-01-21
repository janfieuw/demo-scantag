// routes/reports.js
const express = require("express");
const { DateTime } = require("luxon");
const { get, all, run } = require("../db");
const { buildReportRowsFromScanEvents } = require("../services/fallbacks");
const { layoutDemo, escapeHtml } = require("../ui/layout");

const router = express.Router();
const TZ = "Europe/Brussels";

function isoDate(d) {
  return DateTime.fromJSDate(d, { zone: TZ }).toISODate();
}

async function listEmployees(companyId) {
  return await all(
    `SELECT id, first_name, last_name, display_name
     FROM employees
     WHERE company_id=$1
     ORDER BY last_name ASC, first_name ASC`,
    [companyId]
  );
}

async function getCompany() {
  return await get(`SELECT id, name FROM companies ORDER BY id LIMIT 1`);
}

// UI: form om rapport te genereren
router.get("/reports", async (req, res) => {
  const company = await getCompany();
  if (!company) return res.redirect("/wizard/company");

  const employees = await listEmployees(company.id);

  const today = DateTime.now().setZone(TZ).toISODate();
  const from = String(req.query.from || today);
  const to = String(req.query.to || today);
  const employeeId = req.query.employee_id ? Number(req.query.employee_id) : null;

  const empOptions = [
    `<option value="">Alle werknemers</option>`,
    ...employees.map((e) => {
      const label =
        (e.last_name && e.first_name)
          ? `${escapeHtml(e.last_name)} ${escapeHtml(e.first_name)}`
          : escapeHtml(e.display_name || `#${e.id}`);
      const selected = employeeId === e.id ? "selected" : "";
      return `<option value="${e.id}" ${selected}>${label}</option>`;
    }),
  ].join("");

  return res.send(
    layoutDemo(
      "RAPPORTEN",
      `
        <div class="demo-kicker">PUNCTOO — RAPPORTEN</div>
        <h1 class="demo-title">RAPPORT GENEREREN.</h1>

        <p class="demo-lead">
          Er is geen live data. Rapporten bestaan pas nadat je ze genereert.
        </p>

        <form class="demo-form" method="POST" action="/reports/generate">
          <label class="demo-label" for="employee_id">Werknemer</label>
          <select class="demo-select" id="employee_id" name="employee_id">
            ${empOptions}
          </select>

          <label class="demo-label" for="from">Van</label>
          <input class="demo-input" id="from" name="from" type="date" value="${escapeHtml(from)}" required />

          <label class="demo-label" for="to">Tot</label>
          <input class="demo-input" id="to" name="to" type="date" value="${escapeHtml(to)}" required />

          <div class="demo-actions">
            <button class="demo-btn primary" type="submit">GENEREER RAPPORT</button>
          </div>
        </form>

        <div class="demo-actions" style="margin-top:16px;">
          <form method="POST" action="/reports/generate-last/7" style="margin:0;">
            <button class="demo-btn secondary" type="submit">ALLE WERKNEMERS — 7 DAGEN</button>
          </form>
          <form method="POST" action="/reports/generate-last/14" style="margin:0;">
            <button class="demo-btn secondary" type="submit">ALLE WERKNEMERS — 14 DAGEN</button>
          </form>
          <form method="POST" action="/reports/generate-last/21" style="margin:0;">
            <button class="demo-btn secondary" type="submit">ALLE WERKNEMERS — 21 DAGEN</button>
          </form>
        </div>

        <div class="demo-footer">
          <div class="demo-brand">PUNCTOO</div>
          <div class="demo-sub">Rapporten zijn instant gegenereerd, geen opslag verplicht.</div>
        </div>
      `
    )
  );
});

// Genereren met vrije filters
router.post("/reports/generate", async (req, res) => {
  const company = await getCompany();
  if (!company) return res.redirect("/wizard/company");

  const employeeId = req.body.employee_id ? Number(req.body.employee_id) : null;
  const from = String(req.body.from || "").slice(0, 10);
  const to = String(req.body.to || "").slice(0, 10);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return res.redirect("/reports");
  }

  const reportId = await generateReport({ companyId: company.id, employeeId, from, to });
  return res.redirect(`/reports/view/${reportId}`);
});

// Snelfilters
router.post("/reports/generate-last/:days", async (req, res) => {
  const company = await getCompany();
  if (!company) return res.redirect("/wizard/company");

  const days = Number(req.params.days);
  if (![7, 14, 21].includes(days)) return res.redirect("/reports");

  const to = DateTime.now().setZone(TZ).toISODate();
  const from = DateTime.now().setZone(TZ).minus({ days: days - 1 }).toISODate();

  const reportId = await generateReport({ companyId: company.id, employeeId: null, from, to });
  return res.redirect(`/reports/view/${reportId}`);
});

async function generateReport({ companyId, employeeId, from, to }) {
  const report = await get(
    `INSERT INTO reports (filter_employee_id, filter_from, filter_to, meta)
     VALUES ($1,$2,$3,$4)
     RETURNING id`,
    [employeeId, from, to, JSON.stringify({ tz: TZ })]
  );

  // Load employees for report
  const employees = employeeId
    ? await all(
        `SELECT id, first_name, last_name, display_name
         FROM employees
         WHERE company_id=$1 AND id=$2`,
        [companyId, employeeId]
      )
    : await all(
        `SELECT id, first_name, last_name, display_name
         FROM employees
         WHERE company_id=$1
         ORDER BY last_name ASC, first_name ASC`,
        [companyId]
      );

  // We fetch events in [from .. to] but we also include buffer to allow auto-close rules
  // (we’ll close open IN anyway). Buffer is optional; keep simple.
  const fromTs = DateTime.fromISO(from, { zone: TZ }).startOf("day").toUTC().toISO();
  const toTs = DateTime.fromISO(to, { zone: TZ }).endOf("day").toUTC().toISO();

  for (const emp of employees) {
    const evs = await all(
      `SELECT employee_id, direction, ts, source, ignored, ignored_reason
       FROM scan_events
       WHERE employee_id=$1 AND ts >= $2 AND ts <= $3
       ORDER BY ts ASC`,
      [emp.id, fromTs, toTs]
    );

    const { rows } = buildReportRowsFromScanEvents(evs, { tz: TZ });

    // Store rows
    for (const r of rows) {
      await run(
        `INSERT INTO report_rows
         (report_id, employee_id, day, start_ts, end_ts, minutes, status, message, meta)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          report.id,
          r.employee_id,
          r.day,
          r.start_ts,
          r.end_ts,
          r.minutes,
          r.status,
          r.message,
          JSON.stringify(r.meta || {}),
        ]
      );
    }
  }

  return report.id;
}

// View report
router.get("/reports/view/:id", async (req, res) => {
  const reportId = Number(req.params.id);
  if (!reportId) return res.redirect("/reports");

  const report = await get(`SELECT * FROM reports WHERE id=$1`, [reportId]);
  if (!report) return res.redirect("/reports");

  const rows = await all(
    `SELECT rr.*, e.first_name, e.last_name, e.display_name
     FROM report_rows rr
     LEFT JOIN employees e ON e.id = rr.employee_id
     WHERE rr.report_id=$1
     ORDER BY rr.day ASC, e.last_name ASC, e.first_name ASC, rr.start_ts ASC NULLS LAST`,
    [reportId]
  );

  const rowsHtml = rows
    .map((r) => {
      const name =
        (r.last_name && r.first_name)
          ? `${escapeHtml(r.last_name)} ${escapeHtml(r.first_name)}`
          : escapeHtml(r.display_name || `#${r.employee_id}`);

      const start = r.start_ts ? escapeHtml(isoDate(new Date(r.start_ts))) + " " + escapeHtml(DateTime.fromJSDate(new Date(r.start_ts), { zone: TZ }).toFormat("HH:mm")) : "—";
      const end = r.end_ts ? escapeHtml(isoDate(new Date(r.end_ts))) + " " + escapeHtml(DateTime.fromJSDate(new Date(r.end_ts), { zone: TZ }).toFormat("HH:mm")) : "—";
      const mins = r.minutes != null ? `${r.minutes} min` : "—";

      return `
        <tr>
          <td>${escapeHtml(r.day)}</td>
          <td>${name}</td>
          <td>${escapeHtml(r.status)}</td>
          <td>${start}</td>
          <td>${end}</td>
          <td>${escapeHtml(mins)}</td>
          <td>${escapeHtml(r.message)}</td>
        </tr>
      `;
    })
    .join("");

  return res.send(
    layoutDemo(
      "RAPPORT",
      `
        <div class="demo-kicker">PUNCTOO — RAPPORT</div>
        <h1 class="demo-title">RAPPORT.</h1>

        <p class="demo-muted">
          Periode: <b>${escapeHtml(report.filter_from)}</b> t.e.m. <b>${escapeHtml(report.filter_to)}</b>
        </p>

        <div class="demo-actions" style="margin-top:10px;">
          <a class="demo-btn ghost" href="/reports">TERUG</a>
        </div>

        <div class="demo-tablewrap scroll-x" style="margin-top:10px;">
          <table class="demo-table">
            <thead>
              <tr>
                <th>Dag</th>
                <th>Werknemer</th>
                <th>Status</th>
                <th>Start</th>
                <th>Einde</th>
                <th>Duur</th>
                <th>Melding</th>
              </tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>
      `
    )
  );
});

module.exports = router;
