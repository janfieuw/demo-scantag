// src/routes/device.js
const express = require("express");
const { DateTime } = require("luxon");
const { get, run } = require("../db");
const { COOKIE_NAME } = require("../config");
const { escapeHtml } = require("../ui/layout");

const router = express.Router();

const TZ = "Europe/Brussels";
const COOLDOWN_MINUTES = 5;

// 0 = geen redirect
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
  // Eenvoudig keuzescherm (optioneel)
  return `<!doctype html>
<html lang="nl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Scan — ${escapeHtml(tag.company_name)}</title>
  <style>
    html, body { margin:0; padding:0; height:100%; background:#FDC500; font-family: Arial, Helvetica, sans-serif; }
    .wrap { height:100%; display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; }
    .logo { width: 220px; max-width: 80vw; margin-bottom: 18px; }
    .btnrow { display:flex; gap:12px; }
    a { display:inline-block; padding:12px 20px; border-radius:10px; text-decoration:none; font-weight:700; }
    .primary { background:#000; color:#fff; }
    .ghost { border:2px solid #000; color:#000; background:transparent; }
  </style>
</head>
<body>
  <div class="wrap">
    <img class="logo" src="/static/logo_punctoo_groot_opgeel.png" alt="Punctoo" />
    <div class="btnrow">
      <a class="primary" href="/t/${tag.tag_id}/in">IN</a>
      <a class="ghost" href="/t/${tag.tag_id}/out">OUT</a>
    </div>
  </div>
</body>
</html>`;
}

function renderPairPage(tag, direction) {
  // Jouw gewenste mockup: logo + titel + subtitel + input + knop, alles centraal
  return `<!doctype html>
<html lang="nl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Punctoo – Koppelen</title>
  <style>
    html, body { margin:0; padding:0; height:100%; background:#FDC500; font-family: Arial, Helvetica, sans-serif; }
    .wrap { height:100%; display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; padding:24px; box-sizing:border-box; }
    .logo { width: 240px; max-width: 80vw; margin-bottom: 28px; }
    .title { font-size: 14px; letter-spacing: .08em; text-transform: uppercase; margin-bottom: 6px; }
    .subtitle { font-size: 14px; margin-bottom: 14px; }
    .input { width: 240px; max-width: 86vw; padding: 12px 12px; border-radius: 8px; border: none; font-size: 16px; text-align:center; box-sizing:border-box; }
    .btn { margin-top: 14px; width: 240px; max-width: 86vw; padding: 12px 12px; border-radius: 10px; border: none; background:#000; color:#fff; font-weight:700; letter-spacing:.06em; text-transform: uppercase; }
  </style>
</head>
<body>
  <div class="wrap">
    <img class="logo" src="/static/logo_punctoo_groot_opgeel.png" alt="Punctoo" />

    <div class="title">KOPPELEN SMARTPHONE</div>
    <div class="subtitle">Geef éénmalig ID:</div>

    <form method="POST" action="/pair">
      <input type="hidden" name="tagId" value="${tag.tag_id}" />
      <input type="hidden" name="direction" value="${escapeHtml(direction)}" />

      <input class="input" name="employeeCode" placeholder="bv. 981d14c0" required autofocus />
      <button class="btn" type="submit">BEVESTIG</button>
    </form>
  </div>
</body>
</html>`;
}

/* =========================
   Routes
   ========================= */

// QR entrypoint (optioneel): kies IN/OUT
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

// IN/OUT (crash-proof)
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

  // check binding
  const token = req.cookies[COOKIE_NAME];
  const bound = await getBoundEmployee(tag.company_id, token);

  if (!bound) {
    // niet gekoppeld → pairing scherm
    return res.send(renderPairPage(tag, direction));
  }

  const ts = nowTs();
  const dirDb = direction.toUpperCase();

  // cooldown check
  const last = await getLastNonIgnoredEvent(bound.employee_id);
  if (last && last.timestamp) {
    const lastTs = new Date(last.timestamp);
    const diffMin = (ts - lastTs) / 60000;

    if (diffMin >= 0 && diffMin < COOLDOWN_MINUTES) {
      // log ignored als kolommen bestaan
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

      // notok png
      return res.send(
        renderImageOnly({
          ok: false,
          redirectUrl: `/t/${tag.tag_id}`,
          redirectMs: AUTO_REDIRECT_MS_NOTOK,
        })
      );
    }
  }

  // log scan
  await insertScanEvent({
    companyId: tag.company_id,
    employeeId: bound.employee_id,
    scantagId: tag.tag_id,
    direction: dirDb,
    ts,
    ignored: false,
    ignored_reason: null,
  });

  // ok png
  return res.send(
    renderImageOnly({
      ok: true,
      redirectUrl: `/t/${tag.tag_id}`,
      redirectMs: AUTO_REDIRECT_MS_OK,
    })
  );
});

module.exports = router;
