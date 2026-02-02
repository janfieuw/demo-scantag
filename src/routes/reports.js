// src/routes/reports.js
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
  const dn = String(e?.display_name || "").trim();
  return dn || `#${e?.id || "?"}`;
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
      ORDER BY id ASC
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
   OPEN vs premature MISSING_OUT
   ========================= */

function endTsToUtc(endTs) {
  if (!endTs) return null;
  if (endTs instanceof Date) return DateTime.fromJSDate(endTs).toUTC();

  const s = String(endTs);
  const iso = DateTime.fromISO(s, { zone: "utc" });
  if (iso.isValid) return iso.toUTC();

  const js = new Date(s);
  if (!isNaN(js.getTime())) return DateTime.fromJSDate(js).toUTC();

  return null;
}

function normalizeOpenRows(rows, nowUtc) {
  return (rows || []).map((r) => {
    if (String(r.status || "").toUpperCase() !== "MISSING_OUT") return r;

    const endUtc = endTsToUtc(r.end_ts);
    if (!endUtc) return r;

    if (endUtc > nowUtc) {
      return {
        ...r,
        status: "OPEN",
        end_ts: null,
        minutes: null,
        message: "wacht op scan-OUT",
        meta: {
          ...(r.meta || {}),
          deadline_ts: endUtc.toISO(),
          pending_missing_out: true,
        },
      };
    }
    return r;
  });
}

/* =========================
   GET /reports
   ========================= */
router.get("/reports", async (req, res) => {
  const company = await getCompany(req);
  if (!company) return res.redirect("/demo/account");

  const employees = await listEmployees(company.id);

  const today = DateTime.now().setZone(TZ).toISODate();
  const from = isISODate(req.query.from) ? String(req.query.from) : today;
  const to = isISODate(req.query.to) ? String(req.query.to) : today;

  const employeeId = req.query.employee_id ? Number(req.query.employee_id) : null;

  const empOptions = [
    `<option value="">Alle werknemers</option>`,
    ...employees.map((e) => {
      const label = formatEmployeeLabel(e);
      const selected = employeeId === e.id ? "selected" : "";
      return `<option value="${e.id}" ${selected}>${escapeHtml(label)}</option>`;
    }),
  ].join("");

  const err = String(req.query.err || "").trim();
  const errHtml = err
    ? `<div class="demo-alert">❌ ${escapeHtml(err)}</div>`
    : "";

  return res.send(
    layoutDemo(
      "RAPPORTEN",
      `
      <div class="demo-kicker">RAPPORTEN GENEREREN</div>
      

      

      <p class="demo-muted">Onderneming: <b>${escapeHtml(company.name)}</b></p>

      ${errHtml}

      <form class="demo-formtwee" method="POST" action="/reports/generate">
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

      <div class="demo-actions" style="margin-top:16px;">
        <a class="demo-btn ghost" href="/tags">TAGS</a>
      </div>
      `,
      { leftWidthPx: 850, bodyClass: "page-reports" }
    )
  );
});

// safety: if someone hits it as GET
router.get("/reports/generate", (req, res) => res.redirect("/reports"));

/* =========================
   POST /reports/generate
   ========================= */
router.post("/reports/generate", async (req, res) => {
  try {
    const company = await getCompany(req);
    if (!company) return res.redirect("/demo/account");

    const employeeIdRaw = String(req.body.employee_id || "").trim();
    const employeeId = employeeIdRaw ? Number(employeeIdRaw) : null;

    const from = String(req.body.from || "").slice(0, 10);
    const to = String(req.body.to || "").slice(0, 10);

    if (!isISODate(from) || !isISODate(to)) {
      return res.redirect("/reports?err=Ongeldige%20datumselectie");
    }

    const reportId = await generateReport({ companyId: company.id, employeeId, from, to });
    return res.redirect(`/reports/view/${reportId}`);
  } catch (err) {
    console.error("REPORT GENERATE failed:", err);
    return res.redirect(
      "/reports?err=" + encodeURIComponent(err?.message || "Onbekende fout bij rapportgeneratie")
    );
  }
});

router.post("/reports/generate-last/:days", async (req, res) => {
  try {
    const company = await getCompany(req);
    if (!company) return res.redirect("/demo/account");

    const days = Number(req.params.days);
    if (![7, 14, 21].includes(days)) return res.redirect("/reports?err=Ongeldige%20periode");

    const to = DateTime.now().setZone(TZ).toISODate();
    const from = DateTime.now().setZone(TZ).minus({ days: days - 1 }).toISODate();

    const reportId = await generateReport({ companyId: company.id, employeeId: null, from, to });
    return res.redirect(`/reports/view/${reportId}`);
  } catch (err) {
    console.error("REPORT GENERATE-LAST failed:", err);
    return res.redirect(
      "/reports?err=" + encodeURIComponent(err?.message || "Onbekende fout bij rapportgeneratie")
    );
  }
});

async function generateReport({ companyId, employeeId, from, to }) {
  const report = await get(
    `
    INSERT INTO reports (filter_employee_id, filter_from, filter_to, meta)
    VALUES ($1,$2,$3,$4)
    RETURNING id
    `,
    [employeeId, from, to, JSON.stringify({ tz: TZ })]
  );

  const employees = await getEmployeesForReport(companyId, employeeId);
  const { fromTs, toTs } = toRangeUTC(from, to);

  const nowUtc = DateTime.now().toUTC();

  for (const emp of employees) {
    const evs = await all(
      `
      SELECT employee_id, direction, "timestamp"
      FROM scan_events
      WHERE employee_id=$1
        AND "timestamp" >= $2
        AND "timestamp" <= $3
      ORDER BY "timestamp" ASC
      `,
      [emp.id, fromTs, toTs]
    );

    const normalized = evs.map((r) => ({
      employee_id: r.employee_id,
      direction: r.direction,
      timestamp: r.timestamp,
      source: "SCAN",
    }));

    const built = buildReportRowsFromScanEvents(normalized, { tz: TZ });
    const fixedRows = normalizeOpenRows(built.rows || [], nowUtc);

    for (const r of fixedRows) {
      await run(
        `
        INSERT INTO report_rows
          (report_id, employee_id, day, start_ts, end_ts, minutes, status, message, meta)
        VALUES
          ($1,$2,$3,$4,$5,$6,$7,$8,$9)
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

  return report.id;
}

router.get("/reports/view/:id", async (req, res) => {
  const company = await getCompany(req);
  if (!company) return res.redirect("/demo/account");

  const reportId = Number(req.params.id);
  if (!reportId) return res.redirect("/reports");

  const report = await get(`SELECT * FROM reports WHERE id=$1`, [reportId]);
  if (!report) return res.redirect("/reports");

  const rows = await all(
    `
    SELECT
      rr.*,
      e.first_name,
      e.last_name,
      e.display_name
    FROM report_rows rr
    LEFT JOIN employees e ON e.id = rr.employee_id
    WHERE rr.report_id = $1
      AND e.company_id = $2
    ORDER BY
      rr.day ASC,
      e.last_name ASC NULLS LAST,
      e.first_name ASC NULLS LAST,
      rr.start_ts ASC NULLS LAST
    `,
    [reportId, company.id]
  );

  const rowsHtml =
    rows.length === 0
      ? `<tr><td colspan="7">Geen data in dit rapport.</td></tr>`
      : rows
          .map((r) => {
            const label = formatEmployeeLabel(r);

            const start = r.start_ts
              ? DateTime.fromJSDate(new Date(r.start_ts), { zone: TZ }).toFormat("dd/LL/yyyy HH:mm")
              : "—";

            const end = r.end_ts
              ? DateTime.fromJSDate(new Date(r.end_ts), { zone: TZ }).toFormat("dd/LL/yyyy HH:mm")
              : "—";

            const mins = r.minutes != null ? `${r.minutes} min` : "—";

            return `
              <tr>
                <td><code>${escapeHtml(r.day)}</code></td>
                <td>${escapeHtml(label)}</td>
                <td><b>${escapeHtml(r.status)}</b></td>
                <td>${escapeHtml(start)}</td>
                <td>${escapeHtml(end)}</td>
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
        Onderneming: <b>${escapeHtml(company.name)}</b><br>
        Periode: <b>${escapeHtml(report.filter_from)}</b> t.e.m. <b>${escapeHtml(report.filter_to)}</b>
      </p>

      <div class="demo-actions" style="margin-top:10px;">
        <a class="demo-btn ghost" href="/reports">TERUG</a>
        <a class="demo-btn primary" href="/tags">TAGS</a>
      </div>

      <div class="demo-tablewrap scroll-x" style="margin-top:12px;">
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
      { leftWidthPx: 850, bodyClass: "page-reports" }
    )
  );
});

module.exports = router;
