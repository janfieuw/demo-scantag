// services/fallbacks.js
//
// PUNCTOO — Complete fallback-matrix voor scanverwerking
// - geen live data
// - menselijke fouten ≠ fraude
// - rapporten worden pas gegenereerd
//
// DB schema:
// scan_events(employee_id, direction, timestamp, source, ignored, ignored_reason)

const { DateTime } = require("luxon");

/* =========================
   CONFIG
   ========================= */

const DEFAULTS = {
  tz: "Europe/Brussels",

  cooldownMinutes: 5,      // dubbele scans
  maxPeriodMinutes: 960,   // IN zonder OUT -> auto-close
  minPeriodSeconds: 60,    // te korte / onmogelijke periodes
};

/* =========================
   MAIN ENTRY
   ========================= */

/**
 * Bouw rapportregels op basis van scan_events
 *
 * @param {Array} rawEvents
 *   [{ employee_id, direction, timestamp, source }]
 *
 * @param {Object} options
 * @returns {{ rows: Array, acceptedEvents: Array }}
 */
function buildReportRowsFromScanEvents(rawEvents, options = {}) {
  const cfg = { ...DEFAULTS, ...options };
  const tz = cfg.tz;

  if (!Array.isArray(rawEvents)) {
    return { rows: [], acceptedEvents: [] };
  }

  /* =========================
     Helpers
     ========================= */

  const toDate = (v) => (v instanceof Date ? v : new Date(v));

  const dayOf = (ts) =>
    DateTime.fromJSDate(toDate(ts), { zone: tz }).toISODate();

  function newRow({
    employee_id,
    day,
    start_ts = null,
    end_ts = null,
    minutes = null,
    status,
    message,
    meta = {},
  }) {
    return {
      employee_id,
      day,
      start_ts: start_ts ? toDate(start_ts) : null,
      end_ts: end_ts ? toDate(end_ts) : null,
      minutes: Number.isFinite(minutes) ? Math.floor(minutes) : null,
      status,
      message,
      meta,
    };
  }

  /* =========================
     1) Sort + cooldown filter
     ========================= */

  const events = [...rawEvents].sort(
    (a, b) => toDate(a.timestamp) - toDate(b.timestamp)
  );

  const acceptedEvents = [];
  let lastAcceptedTs = null;

  for (const ev of events) {
    const ts = toDate(ev.timestamp);

    if (lastAcceptedTs) {
      const diffMin = (ts - lastAcceptedTs) / 60000;
      if (diffMin >= 0 && diffMin < cfg.cooldownMinutes) {
        acceptedEvents.push({
          ...ev,
          ignored: true,
          ignored_reason: "COOLDOWN_5_MIN",
        });
        continue;
      }
    }

    acceptedEvents.push({
      ...ev,
      ignored: false,
      ignored_reason: null,
    });

    lastAcceptedTs = ts;
  }

  /* =========================
     2) Interpretatie (matrix)
     ========================= */

  const rows = [];

  let openIn = null;         // { ts, employee_id }
  let lastDir = null;       // 'IN' | 'OUT' | null

  function closeMissingOut(closeTs, meta = {}) {
    if (!openIn) return;

    rows.push(
      newRow({
        employee_id: openIn.employee_id,
        day: dayOf(openIn.ts),
        start_ts: openIn.ts,
        end_ts: closeTs,
        status: "MISSING_OUT",
        message: "geen data wegens ontbrekende scan-OUT",
        meta: { ...meta, rule: "IN_WITHOUT_OUT" },
      })
    );

    openIn = null;
    lastDir = "OUT";
  }

  function missingIn(employee_id, outTs, meta = {}) {
    rows.push(
      newRow({
        employee_id,
        day: dayOf(outTs),
        end_ts: outTs,
        status: "MISSING_IN",
        message: "geen data voorgaande periode wegens ontbrekende scan-IN",
        meta: { ...meta, rule: "OUT_WITHOUT_IN" },
      })
    );

    lastDir = "OUT";
  }

  function invalidPeriod(employee_id, startTs, endTs, meta = {}) {
    rows.push(
      newRow({
        employee_id,
        day: dayOf(startTs),
        start_ts: startTs,
        end_ts: endTs,
        status: "INVALID",
        message: "geen data wegens foutieve scanvolgorde of duur",
        meta: { ...meta, rule: "INVALID_DURATION_OR_ORDER" },
      })
    );

    openIn = null;
    lastDir = "OUT";
  }

  function okPeriod(employee_id, startTs, endTs, minutes) {
    rows.push(
      newRow({
        employee_id,
        day: dayOf(startTs),
        start_ts: startTs,
        end_ts: endTs,
        minutes,
        status: "OK",
        message: "OK",
        meta: { rule: "IN_OUT_OK" },
      })
    );

    openIn = null;
    lastDir = "OUT";
  }

  for (const ev of acceptedEvents) {
    if (ev.ignored) continue;

    const employee_id = ev.employee_id;
    const ts = toDate(ev.timestamp);

    /* -------- IN -------- */
    if (ev.direction === "IN") {
      if (!openIn) {
        openIn = { ts, employee_id };
        lastDir = "IN";
        continue;
      }

      // IN na IN (buiten cooldown)
      closeMissingOut(ts, { closed_by: "NEW_IN" });
      openIn = { ts, employee_id };
      lastDir = "IN";
      continue;
    }

    /* -------- OUT -------- */
    if (ev.direction === "OUT") {
      if (!openIn) {
        // OUT zonder IN
        missingIn(employee_id, ts, { previous_dir: lastDir });
        continue;
      }

      const startTs = openIn.ts;
      const diffSec = (ts - startTs) / 1000;

      if (!Number.isFinite(diffSec) || diffSec < cfg.minPeriodSeconds) {
        invalidPeriod(employee_id, startTs, ts, { diffSec });
        continue;
      }

      const minutes = diffSec / 60;
      okPeriod(employee_id, startTs, ts, minutes);
      continue;
    }
  }

  /* =========================
     3) Auto-close open IN
     ========================= */

  if (openIn) {
    const closeTs = new Date(
      openIn.ts.getTime() + cfg.maxPeriodMinutes * 60000
    );

    closeMissingOut(closeTs, { closed_by: "AUTO_960_MIN" });
  }

  return { rows, acceptedEvents };
}

module.exports = {
  buildReportRowsFromScanEvents,
};
