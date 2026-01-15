const express = require("express");
const { DateTime } = require("luxon");
const { get, all } = require("../db");
const { layout, escapeHtml } = require("../ui/layout");

const router = express.Router();

const TZ = "Europe/Brussels";

// Hoeveel dagen toon je in het rapport
const REPORT_DAYS = 30;

// Pattern instellingen
const REVIEW_WINDOW_DAYS = 14;
const REVIEW_THRESHOLD_PROBLEM_DAYS = 3; // >= 3 probleemdagen in 14 dagen => review
const REVIEW_THRESHOLD_MULTIPLE_SCANS_DAYS = 5; // optioneel

// --------------------
// Time helpers (robust)
// --------------------
function toUtcDateTime(ts) {
  if (!ts) return null;

  if (ts instanceof Date) {
    return DateTime.fromJSDate(ts, { zone: "utc" });
  }

  const s = String(ts);

  let dt = DateTime.fromISO(s, { zone: "utc" });
  if (dt.isValid) return dt;

  dt = DateTime.fromSQL(s, { zone: "utc" });
  if (dt.isValid) return dt;

  return null;
}

function beDateKey(dtUtc) {
  if (!dtUtc) return null;
  return dtUtc.setZone(TZ).toFormat("yyyy-LL-dd"); // day key
}

function formatBE(ts) {
  const dt = toUtcDateTime(ts);
  if (!dt) return "—";
  return dt.setZone(TZ).toFormat("dd/LL/yyyy HH:mm");
}

function minutesBetween(a, b) {
  const start = toUtcDateTime(a);
  const end = toUtcDateTime(b);
  if (!start || !end) return 0;
  const mins = Math.floor(end.diff(start, "minutes").minutes);
  return Number.isFinite(mins) ? mins : 0;
}

function renderStatusBadge(status) {
  if (!status || status === "—") return "—";
  if (status === "AFGEROND") return `<code>${escapeHtml(status)}</code>`;
  if (status === "OPEN") return `<span class="badge warn">open</span>`;
  if (status === "ONVOLLEDIG") return `<span class="badge warn">onvolledig</span>`;
  return `<code>${escapeHtml(status)}</code>`;
}

function renderFlags(flags) {
  if (!flags || flags.length === 0) return "—";
  return flags.map((f) => `<code>${escapeHtml(f)}</code>`).join(" ");
}

// --------------------
// Fallback rules (status + flags + duration)
// --------------------
function computeStatusAndFlags({ firstIn, lastOut, inCount, outCount }) {
  const flags = [];

  if ((inCount || 0) + (outCount || 0) > 2) flags.push("MULTIPLE_SCANS");

  if (!firstIn && !lastOut) {
    return { status: "—", flags: [], duration: 0 };
  }

  if (!firstIn && lastOut) {
    flags.push("OUT_WITHOUT_IN");
    return { status: "ONVOLLEDIG", flags, duration: 0 };
  }

  if (firstIn && !lastOut) {
    flags.push("IN_WITHOUT_OUT");
    return { status: "OPEN", flags, duration: 0 };
  }

  if (firstIn && lastOut) {
    const dtIn = toUtcDateTime(firstIn);
    const dtOut = toUtcDateTime(lastOut);

    if (dtIn && dtOut && dtOut < dtIn) {
      flags.push("NEGATIVE_DURATION");
      return { status: "ONVOLLEDIG", flags, duration: 0 };
    }

    const duration = Math.max(0, minutesBetween(firstIn, lastOut));
    return { status: "AFGEROND", flags, duration };
  }

  return { status: "—", flags: [], duration: 0 };
}

// --------------------
// Pattern detection (herhaling -> review, geen fraudeclaim)
// --------------------
function isProblemDay(flags) {
  const set = new Set(flags || []);
  return (
    set.has("IN_WITHOUT_OUT") ||
    set.has("OUT_WITHOUT_IN") ||
    set.has("NEGATIVE_DURATION") ||
    set.has("MISSING_OUT") // regel 4 (over dagen heen)
  );
}

function isMultipleScanDay(flags) {
  return (flags || []).includes("MULTIPLE_SCANS");
}

function renderReviewBadge(isReview) {
  return isReview ? `<code>REVIEW_RECOMMENDED</code>` : "—";
}

// --------------------
// Build day buckets per employee
// + apply rule 4 over days: open IN gevolgd door nieuwe IN => vorige dag ONVOLLEDIG + MISSING_OUT
// --------------------
function buildDailySummaries({ eventsByEmployee, employees }) {
  // employeeId -> array of day summaries (sorted by day asc)
  const summariesByEmployee = new Map();

  for (const emp of employees) {
    const evs = eventsByEmployee.get(emp.id) || [];

    // Group by Belgian calendar day of the event timestamp
    const byDay = new Map(); // dayKey -> { ins:[], outs:[], all:[] }
    for (const ev of evs) {
      const dtUtc = toUtcDateTime(ev.timestamp);
      if (!dtUtc) continue;
      const dayKey = beDateKey(dtUtc);
      if (!dayKey) continue;

      if (!byDay.has(dayKey)) byDay.set(dayKey, { ins: [], outs: [], all: [] });
      const bucket = byDay.get(dayKey);

      bucket.all.push(ev);
      if (ev.direction === "IN") bucket.ins.push(ev.timestamp);
      if (ev.direction === "OUT") bucket.outs.push(ev.timestamp);
    }

    // Create summaries
    const dayKeys = Array.from(byDay.keys()).sort(); // asc
    const daySummaries = dayKeys.map((dayKey) => {
      const bucket = byDay.get(dayKey);

      const ins = bucket.ins;
      const outs = bucket.outs;

      const firstIn = ins.length ? ins[0] : null;
      const lastOut = outs.length ? outs[outs.length - 1] : null;

      const inCount = ins.length;
      const outCount = outs.length;

      const computed = computeStatusAndFlags({ firstIn, lastOut, inCount, outCount });

      return {
        dayKey,
        firstIn,
        lastOut,
        inCount,
        outCount,
        status: computed.status,
        flags: computed.flags,
        duration: computed.duration,
      };
    });

    // Apply rule 4 (over days):
    // If day A has IN without OUT (OPEN / IN_WITHOUT_OUT),
    // and next day B has an IN, then day A becomes ONVOLLEDIG + MISSING_OUT (duration stays 0).
    for (let i = 0; i < daySummaries.length - 1; i++) {
      const a = daySummaries[i];
      const b = daySummaries[i + 1];

      const aHasOpenIn = !!a.firstIn && !a.lastOut; // IN without OUT
      const bHasIn = !!b.firstIn;

      if (aHasOpenIn && bHasIn) {
        // Replace the "OPEN/IN_WITHOUT_OUT" semantics with "ONVOLLEDIG/MISSING_OUT"
        const newFlags = (a.flags || []).filter((f) => f !== "IN_WITHOUT_OUT");
        if (!newFlags.includes("MISSING_OUT")) newFlags.push("MISSING_OUT");

        a.status = "ONVOLLEDIG";
        a.flags = newFlags;
        a.duration = 0;
      }
    }

    summariesByEmployee.set(emp.id, daySummaries);
  }

  return summariesByEmployee;
}

function computeReviewFromSummaries(daySummaries) {
  // Only consider the last REVIEW_WINDOW_DAYS from today (Belgian date)
  const todayBE = DateTime.now().setZone(TZ).startOf("day");
  const minDay = todayBE.minus({ days: REVIEW_WINDOW_DAYS - 1 }); // inclusive

  let problemDays = 0;
  let multipleScanDays = 0;

  for (const s of daySummaries) {
    const day = DateTime.fromISO(s.dayKey, { zone: TZ }).startOf("day");
    if (day < minDay || day > todayBE) continue;

    if (isProblemDay(s.flags)) problemDays += 1;
    if (isMultipleScanDay(s.flags)) multipleScanDays += 1;
  }

  const reviewRecommended =
    problemDays >= REVIEW_THRESHOLD_PROBLEM_DAYS ||
    multipleScanDays >= REVIEW_THRESHOLD_MULTIPLE_SCANS_DAYS;

  return { reviewRecommended, problemDays, multipleScanDays };
}

// --------------------
// Routes
// --------------------

// 1) Admin overview: multiple lines (multiple days)
router.get("/admin", async (req, res) => {
  const company = await get(`SELECT id, name FROM companies ORDER BY id LIMIT 1`);
  if (!company) {
    return res.send(
      layout(
        "Admin",
        `<div class="card">
          <h1>Admin</h1>
          <p>Geen company gevonden. Start via de wizard.</p>
          <a class="btn" href="/wizard/company">Wizard</a>
        </div>`
      )
    );
  }

  const employees = await all(
    `SELECT id, display_name
     FROM employees
     WHERE company_id=$1
     ORDER BY id`,
    [company.id]
  );

  // Fetch all scan events for last REPORT_DAYS for this company
  const events = await all(
    `SELECT employee_id, direction, timestamp
     FROM scan_events
     WHERE company_id = $1
       AND timestamp >= NOW() - ($2 || ' days')::interval
     ORDER BY employee_id ASC, timestamp ASC`,
    [company.id, REPORT_DAYS]
  );

  // Build employeeId -> events[]
  const eventsByEmployee = new Map();
  for (const ev of events) {
    if (!eventsByEmployee.has(ev.employee_id)) eventsByEmployee.set(ev.employee_id, []);
    eventsByEmployee.get(ev.employee_id).push(ev);
  }

  const summariesByEmployee = buildDailySummaries({ eventsByEmployee, employees });

  // Build rows for table (show newest day first per employee)
  const rows = [];

  for (const e of employees) {
    const daySummariesAsc = summariesByEmployee.get(e.id) || [];
    const daySummaries = [...daySummariesAsc].sort((a, b) => (a.dayKey < b.dayKey ? 1 : -1)); // desc

    const reviewStats = computeReviewFromSummaries(daySummariesAsc);

    if (daySummaries.length === 0) {
      rows.push(`<tr>
        <td>${escapeHtml(e.display_name || "—")}</td>
        <td>—</td>
        <td>—</td>
        <td>—</td>
        <td>0</td>
        <td>—</td>
        <td>—</td>
        <td>${renderReviewBadge(reviewStats.reviewRecommended)}</td>
      </tr>`);
      continue;
    }

    for (const s of daySummaries) {
      // Detail link
      const detailHref = `/admin/day?employeeId=${encodeURIComponent(e.id)}&day=${encodeURIComponent(
        s.dayKey
      )}`;

      rows.push(`<tr>
        <td>${escapeHtml(e.display_name || "—")}</td>
        <td><a href="${detailHref}">${escapeHtml(s.dayKey)}</a></td>
        <td>${formatBE(s.firstIn)}</td>
        <td>${formatBE(s.lastOut)}</td>
        <td>${Number(s.duration || 0)}</td>
        <td>${renderStatusBadge(s.status)}</td>
        <td>${renderFlags(s.flags)}</td>
        <td>${renderReviewBadge(reviewStats.reviewRecommended)}</td>
      </tr>`);
    }
  }

  return res.send(
    layout(
      `Jouw rapport – ${company.name}`,
      `<div class="card">
        <h1>Jouw rapport – ${escapeHtml(company.name)}</h1>
        <p class="muted">
          Automatische fall-backs (geen fictieve scans). Belgische tijd.
          <code>REVIEW_RECOMMENDED</code> = herhaald patroon, geen automatische fraudeclaim.
        </p>

        <table>
          <thead>
            <tr>
              <th>Werknemer</th>
              <th>Werkdag</th>
              <th>Eerste IN</th>
              <th>Laatste OUT</th>
              <th>Duur (min)</th>
              <th>Status</th>
              <th>Flags</th>
              <th>Review</th>
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

// 2) Detail view per werkdag: toon alle scan events van die dag (BE)
router.get("/admin/day", async (req, res) => {
  const employeeId = Number(req.query.employeeId || 0);
  const dayKey = String(req.query.day || "");

  if (!employeeId || !dayKey) {
    return res.send(
      layout(
        "Details",
        `<div class="card">
          <h1>Details</h1>
          <p>Ongeldige parameters.</p>
          <a class="btn secondary" href="/admin">Terug</a>
        </div>`
      )
    );
  }

  const employee = await get(
    `SELECT id, display_name, company_id
     FROM employees
     WHERE id=$1`,
    [employeeId]
  );

  if (!employee) {
    return res.send(
      layout(
        "Details",
        `<div class="card">
          <h1>Details</h1>
          <p>Werknemer niet gevonden.</p>
          <a class="btn secondary" href="/admin">Terug</a>
        </div>`
      )
    );
  }

  // Haal alle events events van die Belgische kalenderdag
  const events = await all(
    `SELECT direction, timestamp
     FROM scan_events
     WHERE employee_id = $1
       AND (timestamp AT TIME ZONE 'Europe/Brussels')::date = $2::date
     ORDER BY timestamp ASC`,
    [employeeId, dayKey]
  );

  // Compute summary for this day (as in overview)
  const ins = events.filter((e) => e.direction === "IN").map((e) => e.timestamp);
  const outs = events.filter((e) => e.direction === "OUT").map((e) => e.timestamp);

  const firstIn = ins.length ? ins[0] : null;
  const lastOut = outs.length ? outs[outs.length - 1] : null;

  const { status, flags, duration } = computeStatusAndFlags({
    firstIn,
    lastOut,
    inCount: ins.length,
    outCount: outs.length,
  });

  const eventRows =
    events.length === 0
      ? `<tr><td colspan="2">Geen scans op deze dag.</td></tr>`
      : events
          .map(
            (ev) => `<tr>
              <td><code>${escapeHtml(ev.direction)}</code></td>
              <td>${formatBE(ev.timestamp)}</td>
            </tr>`
          )
          .join("");

  return res.send(
    layout(
      `Details – ${employee.display_name || "Werknemer"}`,
      `<div class="card">
        <h1>Details – ${escapeHtml(employee.display_name || "—")}</h1>
        <p class="muted">
          Werkdag: <code>${escapeHtml(dayKey)}</code> (Belgische tijd)
        </p>

        <div style="margin: 10px 0 14px;">
          <strong>Samenvatting</strong><br/>
          Status: ${renderStatusBadge(status)}<br/>
          Duur: <code>${Number(duration || 0)} min</code><br/>
          Flags: ${renderFlags(flags)}
        </div>

        <table>
          <thead>
            <tr>
              <th>Richting</th>
              <th>Tijdstip</th>
            </tr>
          </thead>
          <tbody>
            ${eventRows}
          </tbody>
        </table>

        <div class="row" style="margin-top:14px;">
          <a class="btn secondary" href="/admin">Terug</a>
        </div>
      </div>`
    )
  );
});

module.exports = router;
