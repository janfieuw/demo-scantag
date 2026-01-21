// routes/scan.js
//
// Scan endpoints voor QR / ScanTag
// - GET /scan/:code/in
// - GET /scan/:code/out
//
// DB (jouw schema):
// scan_events: id, company_id, employee_id, scantag_id, direction, "timestamp", [source], [ignored], [ignored_reason]
//
// Deze route:
// - zoekt werknemer via employees.scan_code = :code
// - neemt company_id van employee
// - zoekt scantag_id (eerste scantag van company, of NULL als niet gevonden)
// - voert cooldown check uit (laatste NIET-genegeerde scan binnen 5 minuten -> ignore)
// - logt scan (en eventueel ignored flags als kolommen bestaan)

const express = require("express");
const { DateTime } = require("luxon");
const { get, run } = require("../db");
const { layoutDemo, escapeHtml } = require("../ui/layout");

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

function renderScanResult({ title, headline, lines = [], ok = true }) {
  const list = lines.map((l) => `<div class="demo-muted">${escapeHtml(l)}</div>`).join("");

  return layoutDemo(
    title,
    `
      <div class="demo-kicker">PUNCTOO — SCAN</div>
      <h1 class="demo-title">${escapeHtml(headline)}</h1>

      <div style="margin-top:10px;">
        ${list}
      </div>

      <div class="demo-actions" style="margin-top:18px;">
        <a class="demo-btn primary" href="/reports">RAPPORTEN</a>
        <a class="demo-btn ghost" href="/wizard/company">DEMO</a>
      </div>
    `
  );
}

async function findEmployeeByScanCode(code) {
  // We proberen eerst met first_name/last_name, maar vallen terug op display_name als je schema dat zo heeft.
  const employee = await get(
    `
    SELECT
      id,
      company_id,
      scan_code,
      first_name,
      last_name,
      display_name
    FROM employees
    WHERE scan_code = $1
    LIMIT 1
    `,
    [code]
  );

  return employee || null;
}

async function getScantagIdForCompany(companyId) {
  // In jouw wizard werd een scantag aangemaakt. Neem de eerste.
  const tag = await get(
    `SELECT id FROM scantags WHERE company_id = $1 ORDER BY id ASC LIMIT 1`,
    [companyId]
  );
  return tag?.id || null;
}

function employeeLabel(emp) {
  const fn = (emp.first_name || "").trim();
  const ln = (emp.last_name || "").trim();
  if (ln || fn) return `${ln} ${fn}`.trim();
  return (emp.display_name || "").trim() || `#${emp.id}`;
}

async function getLastNonIgnoredEvent(employeeId) {
  // Als ignored kolom bestaat, filter ignored=false. Anders: gewoon laatste event.
  const cols = await detectScanEventsColumns();

  if (cols.has_ignored) {
    return await get(
      `
      SELECT direction, "timestamp"
      FROM scan_events
      WHERE employee_id = $1 AND ignored = FALSE
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
    WHERE employee_id = $1
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

  // We proberen een "rijke" insert als kolommen bestaan
  if (cols.has_source && cols.has_ignored && cols.has_ignored_reason) {
    await run(
      `
      INSERT INTO scan_events
        (company_id, employee_id, scantag_id, direction, "timestamp", source, ignored, ignored_reason)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8)
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

  // Minimaal: jouw huidige schema
  await run(
    `
    INSERT INTO scan_events
      (company_id, employee_id, scantag_id, direction, "timestamp")
    VALUES
      ($1, $2, $3, $4, $5)
    `,
    [companyId, employeeId, scantagId, direction, ts]
  );
}

async function handleScan(req, res, direction) {
  const code = String(req.params.code || "").trim();

  if (!code) {
    return res.status(400).send(
      renderScanResult({
        title: "SCAN — FOUT",
        headline: "ONGELDIGE CODE",
        lines: ["Geen code gevonden in de URL."],
        ok: false,
      })
    );
  }

  const emp = await findEmployeeByScanCode(code);
  if (!emp) {
    return res.status(404).send(
      renderScanResult({
        title: "SCAN — FOUT",
        headline: "ONBEKENDE CODE",
        lines: [`Activatiecode: ${code}`, "Geen werknemer gevonden voor deze code."],
        ok: false,
      })
    );
  }

  const companyId = emp.company_id;
  const employeeId = emp.id;
  const scantagId = await getScantagIdForCompany(companyId);

  const ts = nowTs();

  // Cooldown check (5 min na laatste scan)
  const last = await getLastNonIgnoredEvent(employeeId);

  if (last && last.timestamp) {
    const lastTs = new Date(last.timestamp);
    const diffMin = (ts - lastTs) / 60000;

    if (diffMin >= 0 && diffMin < COOLDOWN_MINUTES) {
      // Genegeerd door cooldown
      // Als ignored kolommen bestaan: log het; anders: return zonder insert
      const cols = await detectScanEventsColumns();

      if (cols.has_ignored && cols.has_ignored_reason) {
        await insertScanEvent({
          companyId,
          employeeId,
          scantagId,
          direction,
          ts,
          ignored: true,
          ignored_reason: "COOLDOWN_5_MIN",
        });
      }

      return res.send(
        renderScanResult({
          title: "SCAN — OK",
          headline: "SCAN GENEGEERD",
          lines: [
            `Werknemer: ${employeeLabel(emp)}`,
            `Richting: ${direction}`,
            `Cooldown: ${COOLDOWN_MINUTES} minuten`,
            "Deze scan viel binnen de cooldown en werd genegeerd.",
          ],
          ok: true,
        })
      );
    }
  }

  // Extra fallback: als iemand exact dezelfde richting 2x na elkaar scant (buiten cooldown),
  // loggen we toch: rapport-engine zal dit later correct interpreteren (IN na IN, OUT na OUT).
  await insertScanEvent({
    companyId,
    employeeId,
    scantagId,
    direction,
    ts,
    ignored: false,
    ignored_reason: null,
  });

  return res.send(
    renderScanResult({
      title: "SCAN — OK",
      headline: "SCAN GEREGISTREERD",
      lines: [
        `Werknemer: ${employeeLabel(emp)}`,
        `Richting: ${direction}`,
        `Tijd: ${DateTime.fromJSDate(ts, { zone: TZ }).toFormat("dd/LL/yyyy HH:mm:ss")}`,
      ],
      ok: true,
    })
  );
}

router.get("/scan/:code/in", async (req, res) => {
  try {
    return await handleScan(req, res, "IN");
  } catch (err) {
    console.error("Scan IN failed:", err);
    return res.status(500).send(
      renderScanResult({
        title: "SCAN — FOUT",
        headline: "SERVERFOUT",
        lines: ["Er ging iets mis bij het verwerken van de scan."],
        ok: false,
      })
    );
  }
});

router.get("/scan/:code/out", async (req, res) => {
  try {
    return await handleScan(req, res, "OUT");
  } catch (err) {
    console.error("Scan OUT failed:", err);
    return res.status(500).send(
      renderScanResult({
        title: "SCAN — FOUT",
        headline: "SERVERFOUT",
        lines: ["Er ging iets mis bij het verwerken van de scan."],
        ok: false,
      })
    );
  }
});

module.exports = router;
