// src/routes/device.js
const express = require("express");
const { DateTime } = require("luxon");
const { get, run } = require("../db");
const { COOKIE_NAME, IS_PROD } = require("../config");
const { layoutDemo, escapeHtml } = require("../ui/layout");

const router = express.Router();

const TZ = "Europe/Brussels";
const COOLDOWN_MINUTES = 5;

// 0 = geen redirect (blijft op scherm)
// bv 1200 = 1.2s en dan terug naar /t/:tagId (kies actie)
const AUTO_REDIRECT_MS_OK = 1200;
const AUTO_REDIRECT_MS_NOTOK = 1500;

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

async function getBoundEmployee(companyId, token) {
  if (!token) return null;
  return await get(
    `
    SELECT
      db.employee_id,
      e.first_name,
      e.last_name,
      e.display_name,
      e.scan_code
    FROM device_bindings db
    JOIN employees e ON e.id = db.employee_id
    WHERE db.company_id = $1
      AND db.token = $2
    LIMIT 1
    `,
    [companyId, token]
  );
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

/* =========================
   UI helpers
   ========================= */

function renderImageOnly({ ok, redirectUrl, redirectMs }) {
  const img = ok ? "/static/scan-ok.png" : "/static/scan-notok.png";
  const sec = redirectMs > 0 ? Math.round(redirectMs / 1000) : 0;
  const meta =
    redirectUrl && sec > 0
      ? `<meta http-equiv="refresh" content="${sec};url=${escapeHtml(redirectUrl)}">`
      : "";

  return `<!doctype html>
<html lang="nl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${ok ? "Scan geslaagd" : "Scan niet gelukt"}</title>
  ${meta}
  <style>
    html, body { margin:0; padding:0; height:100%; background:#FDC500; }
    .wrap { height:100%; display:flex; align-items:center; justify-content:center; }
    img { max-width: 92vw; max-height: 92vh; width:auto; height:auto; display:block; }
  </style>
</head>
<body>
  <div class="wrap">
    <img src="${img}" alt="${ok ? "Scan geslaagd" : "Scan niet gelukt"}" />
  </div>
</body>
</html>`;
}

function renderChoosePage(tag) {
  return layoutDemo(
    `ScanTag — ${tag.company_name}`,
    `
      <div class="demo-kicker">${escapeHtml(tag.company_name)}</div>
      <h1 class="demo-title">SCAN.</h1>

      <p class="demo-muted">ScanTag: <b>${escapeHtml(tag.tag_name || "ScanTag")}</b></p>

      <div class="demo-actions" style="margin-top:16px;">
        <a class="demo-btn primary" href="/t/${tag.tag_id}/in">IN</a>
        <a class="demo-btn ghost" href="/t/${tag.tag_id}/out">OUT</a>
      </div>
    `
  );
}

function renderPairPage(tag, direction) {
  const dirUp = direction.toUpperCase();

  return layoutDemo(
    `Koppelen — ${tag.company_name}`,
    `
      <div class="demo-kicker">${escapeHtml(tag.company_name)}</div>
      <h1 class="demo-title">${escapeHtml(dirUp)}.</h1>

      <p class="demo-lead">
        KOPPELEN SMARTPHONE<br/>
        Geef éénmalig ID:
      </p>

      <form class="demo-form" method="POST" action="/pair">
        <input type="hidden" name="tagId" value="${tag.tag_id}" />
        <input type="hidden" name="direction" value="${escapeHtml(direction)}" />

        <label class="demo-label">ID</label>
        <input class="demo-input" name="employeeCode" placeholder="bv. 981d14c0" required />

        <div class="demo-actions" style="margin-top:10px;">
          <button class="demo-btn primary" type="submit">BEVESTIG</button>
          <a class="demo-btn ghost" href="/t/${tag.tag_id}">TERUG</a>
        </div>
      </form>
    `
  );
}

/* =========================
   Routes
   ========================= */

// Kies IN/OUT (optioneel entrypoint)
router.get("/t/:tagId", async (req, res) => {
  const tagId = Number(req.params.tagId);
  const tag = await resolveTag(tagId);
  if (!tag) {
    return res
      .status(404)
      .send(
        renderImageOnly({
          ok: false,
          redirectUrl: "/",
          redirectMs: AUTO_REDIRECT_MS_NOTOK,
        })
      );
  }
  return res.send(renderChoosePage(tag));
});

// IN/OUT (crash-proof, validate in code)
router.get("/t/:tagId/:direction", async (req, res) => {
  const tagId = Number(req.params.tagId);
  const direction = String(req.params.direction || "").toLowerCase();

  if (direction !== "in" && direction !== "out") {
    return res.status(404).send("Not found");
  }

  const tag = await resolveTag(tagId);
  if (!tag) {
    return res
      .status(404)
      .send(
        renderImageOnly({
          ok: false,
          redirectUrl: "/",
          redirectMs: AUTO_REDIRECT_MS_NOTOK,
        })
      );
  }

  // Binding check
  const token = req.cookies[COOKIE_NAME];
  const bound = await getBoundEmployee(tag.company_id, token);

  if (!bound) {
    return res.send(renderPairPage(tag, direction));
  }

  const ts = nowTs();
  const dirDb = direction.toUpperCase();

  // Cooldown check
  const last = await getLastNonIgnoredEvent(bound.employee_id);
  if (last && last.timestamp) {
    const lastTs = new Date(last.timestamp);
    const diffMin = (ts - lastTs) / 60000;

    if (diffMin >= 0 && diffMin < COOLDOWN_MINUTES) {
      // ignored
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
        renderImageOnly({
          ok: false,
          redirectUrl: `/t/${tag.tag_id}`,
          redirectMs: AUTO_REDIRECT_MS_NOTOK,
        })
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

  return res.send(
    renderImageOnly({
      ok: true,
      redirectUrl: `/t/${tag.tag_id}`,
      redirectMs: AUTO_REDIRECT_MS_OK,
    })
  );
});

module.exports = router;
