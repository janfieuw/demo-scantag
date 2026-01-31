const express = require("express");
const { DateTime } = require("luxon");
const { get, all, run } = require("../db");
const { layoutDemo, escapeHtml } = require("../ui/layout");
const { buildReportRowsFromScanEvents } = require("../services/fallbacks");

const router = express.Router();
const TZ = "Europe/Brussels";

function isISODate(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
}

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

function formatEmployeeLabel(e) {
  const ln = String(e?.last_name || "").trim();
  const fn = String(e?.first_name || "").trim();
  if (ln || fn) return `${ln} ${fn}`.trim();
  return String(e?.display_name || "").trim() || `#${e?.id}`;
}

async function listEmployees(companyId) {
  return await all(
    `
    SELECT id, first_name, last_name, display_name
    FROM employees
    WHERE company_id=$1
    ORDER BY
      last_name ASC NULLS LAST,
      first_name ASC NULLS LAST,
      display_name ASC,
      id ASC
    `,
    [companyId]
  );
}

async function getEmployeesForReport(companyId, employeeId) {
  if (employeeId) {
    return await all(
      `
      SELECT id, first_name, last_name, display_name
      FROM employees
      WHERE company_id=$1 AND id=$2
      `,
      [companyId, employeeId]
    );
  }
  return await listEmployees(companyId);
}

function toRangeUTC(fromISO, toISO) {
  const fromTs = DateTime.fromISO(fromISO, { zone: TZ })
    .startOf("day")
    .toUTC()
    .toISO();
  const toTs = DateTime.fromISO(toISO, { zone: TZ })
    .endOf("day")
    .toUTC()
    .toISO();
  return { fromTs, toTs };
}

/* =========================
   GET /reports
   ========================= */
router.get("/reports", async (req, res) => {
  const company = await getCompany(req);
  if (!company) return res.redirect("/demo/account");

  const employees = await listEmployees(company.id);

  const today = DateTime.now().setZone(TZ).toISODate();
  const from = isISODate(req.query.from) ? req.query.from : today;
  const to = isISODate(req.query.to) ? req.query.to : today;
  const employeeId = req.query.employee_id ? Number(req.query.employee_id) : null;

  const empOptions = [
    `<option value="">Alle werknemers</option>`,
    ...employees.map((e) => {
      const selected = employeeId === e.id ? "selected" : "";
      return `<option value="${e.id}" ${selected}>${escapeHtml(
        formatEmployeeLabel(e)
      )}</option>`;
    }),
  ].join("");

  const err = String(req.query.err || "").trim();
  const errHtml = err
    ? `<div class="demo-alert">❌ ${escapeHtml(err)}</div>`
    : "";

  res.send(
    layoutDemo(
      "RAPPORTEN",
      `
      <div class="demo-kicker">PUNCTOO — RAPPORTEN</div>
      <h1 class="demo-title">RAPPORT GENEREREN.</h1>

      <p class="demo-lead">
        Er is geen live data. Rapporten bestaan pas nadat je ze genereert.
      </p>

      <p class="demo-muted">
        Onderneming: <b>${escapeHtml(company.name)}</b>
      </p>

      ${errHtml}

      <form class="demo-form" method="POST" action="/reports/generate">
        <label class="demo-label">Werknemer</label>
        <select class="demo-select" name="employee_id">
          ${empOptions}
        </select>

        <label class="demo-label">Van</label>
        <input class="demo-input" type="date" name="from" value="${from}" required />

        <label class="demo-label">Tot</label>
        <input class="demo-input" type="date" name="to" value="${to}" required />

        <div class="demo-actions">
          <button class="demo-btn primary">GENEREER RAPPORT</button>
        </div>
      </form>

      <div class="demo-actions" style="margin-top:16px;">
        <form method="POST" action="/reports/generate-last/7">
          <button class="demo-btn secondary">ALLE WERKNEMERS — 7 DAGEN</button>
        </form>
        <form method="POST" action="/reports/generate-last/14">
          <button class="demo-btn secondary">ALLE WERKNEMERS — 14 DAGEN</button>
        </form>
        <form method="POST" action="/reports/generate-last/21">
          <button class="demo-btn secondary">ALLE WERKNEMERS — 21 DAGEN</button>
        </form>
      </div>

      <div class="demo-actions" style="margin-top:16px;">
        <a class="demo-btn ghost" href="/tags">TAGS</a>
      </div>
      `,
      { width: 850 }
    )
  );
});

/* =========================
   POST /reports/generate
   ========================= */
router.post("/reports/generate", async (req, res) => {
  try {
    const company = await getCompany(req);
    if (!company) return res.redirect("/demo/account");

    const employeeId = req.body.employee_id
      ? Number(req.body.employee_id)
      : null;

    const from = req.body.from;
    const to = req.body.to;

    const report = await get(
      `
      INSERT INTO reports (filter_employee_id, filter_from, filter_to)
      VALUES ($1,$2,$3)
      RETURNING id
      `,
      [employeeId, from, to]
    );

    const employees = await getEmployeesForReport(company.id, employeeId);
    const { fromTs, toTs } = toRangeUTC(from, to);

    for (const emp of employees) {
      const events = await all(
        `
        SELECT employee_id, direction, "timestamp"
        FROM scan_events
        WHERE employee_id=$1
          AND "timestamp" BETWEEN $2 AND $3
        ORDER BY "timestamp"
        `,
        [emp.id, fromTs, toTs]
      );

      const built = buildReportRowsFromScanEvents(events, { tz: TZ });

      for (const r of built.rows) {
        await run(
          `
          INSERT INTO report_rows
            (report_id, employee_id, day, start_ts, end_ts, minutes, status, message, meta)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
          `,
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

    res.redirect(`/reports/view/${report.id}`);
  } catch (err) {
    console.error(err);
    res.redirect(
      "/reports?err=" + encodeURIComponent(err.message || "Fout bij genereren")
    );
  }
});

/* =========================
   GET /reports/view/:id
   ========================= */
router.get("/reports/view/:id", async (req, res) => {
  const company = await getCompany(req);
  if (!company) return res.redirect("/demo/account");

  const reportId = Number(req.params.id);
  if (!reportId) return res.redirect("/reports");

  const report = await get(`SELECT * FROM reports WHERE id=$1`, [reportId]);
  if (!report) return res.redirect("/reports");

  const rows = await all(
    `
    SELECT rr.*, e.first_name, e.last_name, e.display_name
    FROM report_rows rr
    LEFT JOIN employees e ON e.id = rr.employee_id
    WHERE rr.report_id=$1
    ORDER BY rr.day, rr.start_ts
    `,
    [reportId]
  );

  const rowsHtml =
    rows.length === 0
      ? `<tr><td colspan="7">Geen data.</td></tr>`
      : rows
          .map((r) => {
            return `
            <tr>
              <td>${escapeHtml(r.day)}</td>
              <td>${escapeHtml(formatEmployeeLabel(r))}</td>
              <td><b>${escapeHtml(r.status)}</b></td>
              <td>${r.start_ts ? DateTime.fromJSDate(r.start_ts).setZone(TZ).toFormat("dd/LL/yyyy HH:mm") : "—"}</td>
              <td>${r.end_ts ? DateTime.fromJSDate(r.end_ts).setZone(TZ).toFormat("dd/LL/yyyy HH:mm") : "—"}</td>
              <td>${r.minutes ?? "—"}</td>
              <td>${escapeHtml(r.message)}</td>
            </tr>
          `;
          })
          .join("");

  res.send(
    layoutDemo(
      "RAPPORT",
      `
      <div class="demo-kicker">PUNCTOO — RAPPORT</div>
      <h1 class="demo-title">RAPPORT.</h1>

      <p class="demo-muted">
        Onderneming: <b>${escapeHtml(company.name)}</b><br>
        Periode: <b>${report.filter_from}</b> t.e.m. <b>${report.filter_to}</b>
      </p>

      <div class="demo-actions">
        <a class="demo-btn ghost" href="/reports">TERUG</a>
        <a class="demo-btn primary" href="/tags">TAGS</a>
      </div>

      <div class="demo-tablewrap scroll-x">
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
      `,
      { width: 850 }
    )
  );
});

module.exports = router;
