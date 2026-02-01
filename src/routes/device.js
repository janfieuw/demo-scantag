// src/routes/device.js
const express = require("express");
const { DateTime } = require("luxon");
const { get, run } = require("../db");
const { COOKIE_NAME, IS_PROD } = require("../config");
const { layout, escapeHtml } = require("../ui/layout");
const { cardHeader } = require("../ui/components");

const router = express.Router();
const TZ = "Europe/Brussels";
const COOLDOWN_MINUTES = 5;

// Cache of scan_events extra kolommen bestaan (ignored/source)
let scanEventsHasIgnoredCols = null;

async function detectScanEventsColumns() {
  if (scanEventsHasIgnoredCols !== null) return scanEventsHasIgnoredCols;

  const row = await get(
    `
    SELECT
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='scan_events' AND column_name='ignored'
      ) AS has_ignored,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='scan_events' AND column_name='ignored_reason'
      ) AS has_ignored_reason,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='scan_events' AND column_name='source'
      ) AS has_source
    `
  );

  scanEventsHasIgnoredCols = {
    has_ignored: row?.has_ignored === true,
    has_ignored_reason: row?.has_ignored_reason === true,
    has_source: row?.has_source === true,
  };

  return scanEventsHasIgnoredCols;
}

function nowTs() {
  return DateTime.now().setZone(TZ).toJSDate();
}

async function resolveTag(tagId) {
  return await get(
    `SELECT st.id AS tag_id, st.name AS tag_name, c.id AS company_id, c.name AS company_name
     FROM scantags st
     JOIN companies c ON c.id = st.company_id
     WHERE st.id = $1`,
    [tagId]
  );
}

function renderScanShell({ companyName, modeLabel, headline, bodyHtml }) {
  return layout(
    `ScanTag — ${companyName}`,
    `
    <div class="card">
      ${cardHeader(companyName, modeLabel)}
      <div style="height:10px"></div>
      <div class="big">${escapeHtml(headline)}</div>
      <div style="height:10px"></div>
      ${bodyHtml || ""}
    </div>
    `
  );
}

function renderChoosePage(tag) {
  return renderScanShell({
    companyName: tag.company_name,
    modeLabel: "SCAN",
    headline: "Kies actie",
    bodyHtml: `
      <p class="muted">ScanTag: <b>${escapeHtml(tag.tag_name || "ScanTag")}</b></p>
      <div class="row" style="margin-top:14px;">
        <a class="btn" href="/t/${tag.tag_id}/in">IN</a>
        <a class="btn secondary" href="/t/${tag.tag_id}/out">OUT</a>
      </div>
    `,
  });
}

function renderPairPage(tag, direction) {
  const dirUp = direction.toUpperCase();
  return renderScanShell({
    companyName: tag.company_name,
    modeLabel: dirUp,
    headline: "Koppel dit toestel",
    bodyHtml: `
      <p class="muted">
        Dit toestel is nog niet gekoppeld aan een werknemer.
        Vul de werknemer-code in.
      </p>

      <form method="POST" action="/pair">
        <input type="hidden" name="tagId" value="${tag.tag_id}" />
        <input type="hidden" name="direction" value="${escapeHtml(direction)}" />

        <label class="muted" for="employeeCode">Werknemer-code</label><br/>
        <input id="employeeCode" name="employeeCode" placeholder="bv. WERKNEMER1" required />

        <div style="height:12px"></div>
        <button class="btn" type="submit">KOPPEL EN SCAN ${dirUp}</button>
      </form>

      <div class="row" style="margin-top:14px;">
        <a class="btn secondary" href="/t/${tag.tag_id}">Terug</a>
      </div>
    `,
  });
}

async function getBoundEmployee(companyId, token) {
  if (!token) return null;
  return await get(
    `
    SELECT
      db.employee_id,
      e.first_name,
      e.last_name,
      e.display_name
    FROM device_bindings db
    JOIN employees e ON e.id = db.employee_id
    WHERE db.company_id = $1
      AND db.token = $2
    LIMIT 1
    `,
    [companyId, token]
  );
}

function employeeLabel(emp) {
  const fn = String(emp.first_name || "").trim();
  const ln = String(emp.last_name || "").trim();
  if (ln || fn) return `${ln} ${fn}`.trim();
  return String(emp.display_name || "").trim() || `#${emp.employee_id}`;
}

async function getLastNonIgnoredEvent(employeeId) {
  const cols = await detectScanEventsColumns();

  if (cols.has_ignored) {
    return await get(
      `
      SELECT direction, "timestamp"
      FROM scan_events
      WHERE employee_id=$1 AND ignored = FALSE
      ORDER BY "timestamp" DESC
      LIMIT 1
      `,
      [employeeId]
    );
  }

  return await get(
    `
    SELECT direction, "timestamp"
    FROM scan_events
    WHERE employee_id=$1
    ORDER BY "timestamp" DESC
    LIMIT 1
    `,
    [employeeId]
  );
}

async function insertScanEvent({
  companyId,
  employeeId,
  scantagId,
  direction,
  ts,
  ignored,
  ignored_reason,
}) {
  const cols = await detectScanEventsColumns();

  if (cols.has_source && cols.has_ignored && cols.has_ignored_reason) {
    await run(
      `
      INSERT INTO scan_events
        (company_id, employee_id, scantag_id, direction, "timestamp", source, ignored, ignored_reason)
      VALUES
        ($1,$2,$3,$4,$5,$6,$7,$8)
      `,
      [
        companyId,
        employeeId,
        scantagId,
        direction,
        ts,
        "SCAN",
        ignored === true,
        ignored_reason || null,
      ]
    );
    return;
  }

  await run(
    `
    INSERT INTO scan_events
      (company_id, employee_id, scantag_id, direction, "timestamp")
    VALUES
      ($1,$2,$3,$4,$5)
    `,
    [companyId, employeeId, scantagId, direction, ts]
  );
}

function renderScanResult(tag, direction, empLabel, ts, ignored, reason) {
  const dirUp = direction.toUpperCase();
  const timeStr = DateTime.fromJSDate(ts, { zone: TZ }).toFormat("dd/LL/yyyy HH:mm:ss");

  const headline = ignored ? "SCAN GENEGEERD" : "SCAN GEREGISTREERD";
  const extra = ignored
    ? `<p class="muted">Reden: <code>${escapeHtml(reason || "COOLDOWN")}</code></p>`
    : "";

  return renderScanShell({
    companyName: tag.company_name,
    modeLabel: dirUp,
    headline,
    bodyHtml: `
      <p class="muted">
        Werknemer: <b>${escapeHtml(empLabel)}</b><br/>
        ScanTag: <b>${escapeHtml(tag.tag_name || "ScanTag")}</b><br/>
        Tijd: <b>${escapeHtml(timeStr)}</b>
      </p>
      ${extra}

      <div class="row" style="margin-top:14px;">
        <a class="btn" href="/t/${tag.tag_id}/${direction}">Nog een ${dirUp}</a>
        <a class="btn secondary" href="/t/${tag.tag_id}">Kies actie</a>
        <a class="btn secondary" href="/reports">Rapporten</a>
      </div>
    `,
  });
}

/* =========================
   Routes
   ========================= */

// QR entry point (optioneel)
router.get("/t/:tagId", async (req, res) => {
  const tagId = Number(req.params.tagId);
  const tag = await resolveTag(tagId);
  if (!tag) return res.status(404).send(layout("Onbekend", `<div class="card"><h1>Onbekende tag</h1></div>`));
  return res.send(renderChoosePage(tag));
});

// IN/OUT
router.get("/t/:tagId/:direction(in|out)", async (req, res) => {
  const tagId = Number(req.params.tagId);
  const direction = String(req.params.direction || "").toLowerCase(); // in/out
  const dirDb = direction.toUpperCase(); // IN/OUT

  const tag = await resolveTag(tagId);
  if (!tag) return res.status(404).send(layout("Onbekend", `<div class="card"><h1>Onbekende tag</h1></div>`));

  // Check binding cookie
  const token = req.cookies[COOKIE_NAME];
  const bound = await getBoundEmployee(tag.company_id, token);

  if (!bound) {
    // Niet gekoppeld → toon pairing UI (POST /pair)
    return res.send(renderPairPage(tag, direction));
  }

  const ts = nowTs();

  // Cooldown check
  const last = await getLastNonIgnoredEvent(bound.employee_id);
  if (last && last.timestamp) {
    const lastTs = new Date(last.timestamp);
    const diffMin = (ts - lastTs) / 60000;

    if (diffMin >= 0 && diffMin < COOLDOWN_MINUTES) {
      // genegeerd
      const cols = await detectScanEventsColumns();
      if (cols.has_ignored && cols.has_ignored_reason) {
        await insertScanEvent({
          companyId: tag.company_id,
          employeeId: bound.employee_id,
          scantagId: tag.tag_id,
          direction: dirDb,
          ts,
          ignored: true,
          ignored_reason: "COOLDOWN_5_MIN",
        });
      }
      return res.send(
        renderScanResult(
          tag,
          direction,
          employeeLabel(bound),
          ts,
          true,
          "COOLDOWN_5_MIN"
        )
      );
    }
  }

  // Log scan
  await insertScanEvent({
    companyId: tag.company_id,
    employeeId: bound.employee_id,
    scantagId: tag.tag_id,
    direction: dirDb,
    ts,
    ignored: false,
    ignored_reason: null,
  });

  return res.send(renderScanResult(tag, direction, employeeLabel(bound), ts, false, null));
});

module.exports = router;
