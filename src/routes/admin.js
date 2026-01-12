const express = require("express");
const { DateTime } = require("luxon");
const { get, all } = require("../db");
const { layout, escapeHtml } = require("../ui/layout");

const router = express.Router();

const TZ = "Europe/Brussels";

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

function formatBE(ts) {
  const dt = toUtcDateTime(ts);
  if (!dt) return "—";
  return dt.setZone(TZ).toFormat("dd/LL/yyyy HH:mm");
}

function minutesBetween(a, b) {
  const start = toUtcDateTime(a);
  const end = toUtcDateTime(b);
  if (!start || !end) return 0;

  const diff = end.diff(start, "minutes").minutes;
  return diff > 0 ? Math.floor(diff) : 0; // negatieve => 0
}

function beDateKey(dtUtc) {
  if (!dtUtc) return null;
  return dtUtc.setZone(TZ).toFormat("yyyy-LL-dd"); // workday key
}

// --------------------
// Fallback engine: status + flags
// --------------------
function computeStatusAndFlags({ firstIn, lastOut, inCount, outCount }) {
  const flags = [];

  if ((inCount || 0) > 1 || (outCount || 0) > 1) {
    flags.push("MULTIPLE_SCANS");
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
    // expliciet negatieve duur check
    const dtIn = toUtcDateTime(firstIn);
    const dtOut = toUtcDateTime(lastOut);
    if (dtIn && dtOut && dtOut < dtIn) {
      flags.push("NEGATIVE_DURATION");
      return { status: "ONVOLLEDIG", flags, duration: 0 };
    }

    const duration = minutesBetween(firstIn, lastOut);
    return { status: "AFGEROND", flags, duration };
  }

  return { status: "—", flags, duration: 0 };
}

function humanStatus(status) {
  switch (status) {
    case "AFGEROND":
      return "✅ afgerond";
    case "OPEN":
      return "⏳ open";
    case "ONVOLLEDIG":
      return "⚠️ onvolledig";
    default:
      return "—";
  }
}

function renderFlags(flags) {
  if (!flags || flags.length === 0) return "—";
  return flags.map((f) => `<code>${escapeHtml(f)}</code>`).join(" ");
}

// --------------------
// Pattern detection (fraude-benadering = herhaling -> review)
// --------------------
function isProblemDay(flags) {
  const set = new Set(flags || []);
  return (
    set.has("IN_WITHOUT_OUT") ||
    set.has("OUT_WITHOUT_IN") ||
    set.has("NEGATIVE_DURATION")
  );
}

function isMultipleScanDay(flags) {
  return (flags || []).includes("MULTIPLE_SCANS");
}

function renderReviewBadge(isReview) {
  return isReview ? `<code>REVIEW_RECOMMENDED</code>` : "—";
}

async function computeReviewStats(employeeId) {
  // Haal alle events van de laatste N dagen
  const events = await all(
    `SELECT direction, timestamp
     FROM scan_events
     WHERE employee_id = $1
       AND timestamp >= NOW() - ($2 || ' days')::interval
     ORDER BY timestamp ASC`,
    [employeeId, REVIEW_WINDOW_DAYS]
  );

  // Groepeer per Belgische datum
  const byDay = new Map(); // dayKey -> { ins: [], outs: [] }
  for (const ev of events) {
    const dtUtc = toUtcDateTime(ev.timestamp);
    if (!dtUtc) continue;
    const dayKey = beDateKey(dtUtc);
    if (!dayKey) continue;

    if (!byDay.has(dayKey)) byDay.set(dayKey, { ins: [], outs: [] });
    const bucket = byDay.get(dayKey);

    if (ev.direction === "IN") bucket.ins.push(ev.timestamp);
    if (ev.direction === "OUT") bucket.outs.push(ev.timestamp);
  }

  let problemDays = 0;
  let multipleScanDays = 0;

  for (const [, bucket] of byDay.entries()) {
    const ins = bucket.ins;
    const outs = bucket.outs;

    const firstIn = ins.length ? ins[0] : null;
    const lastOut = outs.length ? outs[outs.length - 1] : null;

    const { flags } = computeStatusAndFlags({
      firstIn,
      lastOut,
      inCount: ins.length,
      outCount: outs.length,
    });

    if (isProblemDay(flags)) problemDays += 1;
    if (isMultipleScanDay(flags)) multipleScanDays += 1;
  }

  const reviewRecommended =
    problemDays >= REVIEW_THRESHOLD_PROBLEM_DAYS ||
    multipleScanDays >= REVIEW_THRESHOLD_MULTIPLE_SCANS_DAYS;

  return { reviewRecommended, problemDays, multipleScanDays };
}

// --------------------
// Route
// --------------------
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
    `SELECT id, display_name
     FROM employees
     WHERE company_id=$1
     ORDER BY id`,
    [company.id]
  );

  const rows = [];

  for (const e of employees) {
    // "Huidige werkdag": datum van laatste IN (BE) of laatste OUT als er geen IN is
    const lastInRow = await get(
      `SELECT timestamp
       FROM scan_events
       WHERE employee_id = $1 AND direction='IN'
       ORDER BY timestamp DESC LIMIT 1`,
      [e.id]
    );

    const lastOutRow = await get(
      `SELECT timestamp
       FROM scan_events
       WHERE employee_id = $1 AND direction='OUT'
       ORDER BY timestamp DESC LIMIT 1`,
      [e.id]
    );

    const lastInUtc = toUtcDateTime(lastInRow?.timestamp);
    const lastOutUtc = toUtcDateTime(lastOutRow?.timestamp);

    const workdayKey = beDateKey(lastInUtc || lastOutUtc); // yyyy-MM-dd in BE

    let firstIn = null;
    let lastOut = null;
    let inCount = 0;
    let outCount = 0;

    if (workdayKey) {
      const dayEvents = await all(
        `SELECT direction, timestamp
         FROM scan_events
         WHERE employee_id = $1
           AND (timestamp AT TIME ZONE 'Europe/Brussels')::date = $2::date
         ORDER BY timestamp ASC`,
        [e.id, workdayKey]
      );

      const ins = dayEvents.filter((ev) => ev.direction === "IN");
      const outs = dayEvents.filter((ev) => ev.direction === "OUT");

      inCount = ins.length;
      outCount = outs.length;

      firstIn = ins.length ? ins[0].timestamp : null;
      lastOut = outs.length ? outs[outs.length - 1].timestamp : null;
    }

    const { status, flags, duration } = computeStatusAndFlags({
      firstIn,
      lastOut,
      inCount,
      outCount,
    });

    // Pattern stats (laatste N dagen)
    const { reviewRecommended, problemDays, multipleScanDays } =
      await computeReviewStats(e.id);

    rows.push(`
      <tr>
        <td>${escapeHtml(e.display_name)}</td>
        <td>${workdayKey ? escapeHtml(workdayKey) : "—"}</td>
        <td>${formatBE(firstIn)}</td>
        <td>${formatBE(lastOut)}</td>
        <td>${duration}</td>
        <td>${humanStatus(status)}</td>
        <td>${renderFlags(flags)}</td>
        <td>
          ${renderReviewBadge(reviewRecommended)}
          ${
            reviewRecommended
              ? `<div class="muted" style="margin-top:4px;">
                   ${problemDays} probleemdagen / ${REVIEW_WINDOW_DAYS}d
                   ${multipleScanDays ? `• ${multipleScanDays} multi-scan dagen` : ""}
                 </div>`
              : ""
          }
        </td>
      </tr>
    `);
  }

  res.send(
    layout(
      "Rapport",
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

module.exports = router;
