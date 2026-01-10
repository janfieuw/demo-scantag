const express = require("express");
const crypto = require("crypto");
const { get, run } = require("../db");
const { COOLDOWN_MINUTES, COOKIE_NAME, IS_PROD } = require("../config");
const { layout, escapeHtml } = require("../ui/layout");
const { cardHeader } = require("../ui/components");

const router = express.Router();

function makeToken() {
  return crypto.randomBytes(24).toString("hex");
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

async function resolveBinding(token) {
  if (!token) return null;
  return await get(
    `SELECT db.company_id, e.id AS employee_id, e.display_name, e.scan_code
     FROM device_bindings db
     JOIN employees e ON e.id = db.employee_id
     WHERE db.token = $1`,
    [token]
  );
}

async function shouldCooldown(employeeId, direction) {
  const row = await get(
    `SELECT
       CASE
         WHEN MAX(timestamp) IS NULL THEN false
         WHEN NOW() - MAX(timestamp) < ($1 || ' minutes')::interval THEN true
         ELSE false
       END AS is_cooldown
     FROM scan_events
     WHERE employee_id = $2 AND direction = $3`,
    [COOLDOWN_MINUTES, employeeId, direction]
  );
  return row?.is_cooldown === true;
}

async function logScanEvent({ companyId, employeeId, tagId, direction }) {
  const cooldown = await shouldCooldown(employeeId, direction);
  if (cooldown) {
    return { skipped: true, reason: `Cooldown (${COOLDOWN_MINUTES} min)` };
  }

  const inserted = await get(
    `INSERT INTO scan_events (company_id, employee_id, scantag_id, direction)
     VALUES ($1,$2,$3,$4)
     RETURNING id`,
    [companyId, employeeId, tagId, direction]
  );

  const event = await get(
    `SELECT se.timestamp,
            e.display_name,
            c.name AS company_name,
            st.name AS tag_name
     FROM scan_events se
     JOIN employees e ON e.id = se.employee_id
     JOIN companies c ON c.id = se.company_id
     JOIN scantags st ON st.id = se.scantag_id
     WHERE se.id = $1`,
    [inserted.id]
  );

  return { skipped: false, event };
}

// IN scan
router.get("/t/:tagId/in", async (req, res) => {
  const tag = await resolveTag(Number(req.params.tagId));
  if (!tag) {
    return res.status(404).send(layout("Onbekend", `<div class="card"><h1>Onbekende ScanTag</h1></div>`));
  }

  const binding = await resolveBinding(req.cookies[COOKIE_NAME]);

  // Geen binding of andere company => ACTIVEER smartphone (met activatiecode)
  if (!binding || binding.company_id !== tag.company_id) {
    return res.send(
      layout(
        "Activeer smartphone",
        `<div class="card">
          ${cardHeader(tag.company_name, "IN")}
          <div style="height:10px"></div>
          <div class="big">Activeer smartphone</div>
          <p class="muted">
            Geef de <b>activatiecode</b> in die je kreeg bij het toevoegen van de werknemer.
          </p>

          <form method="POST" action="/activate">
            <input type="hidden" name="tagId" value="${tag.tag_id}" />
            <label class="muted" for="code">Activatiecode</label><br/>
            <input id="code" name="scan_code" placeholder="bv. HGk52Dclu" autocomplete="off" required />
            <div style="height:12px"></div>
            <button class="btn" type="submit">Activeer & registreer IN</button>
          </form>

          <div class="row" style="margin-top:14px;">
            <a class="btn secondary" href="/wizard/company">Wizard</a>
            <a class="btn secondary" href="/tags">QR’s</a>
          </div>
        </div>`
      )
    );
  }

  // Binding ok => registreer IN
  const result = await logScanEvent({
    companyId: tag.company_id,
    employeeId: binding.employee_id,
    tagId: tag.tag_id,
    direction: "IN",
  });

  if (result.skipped) {
    return res.send(
      layout(
        "Genegeerd",
        `<div class="card">
          ${cardHeader(tag.company_name, "IN")}
          <div style="height:10px"></div>
          <div class="big">⏱️ Genegeerd</div>
          <p class="muted">${escapeHtml(result.reason)}</p>
          <p class="muted">Werknemer: <b>${escapeHtml(binding.display_name)}</b></p>
          <div class="row" style="margin-top:14px;">
            <a class="btn secondary" href="/tags">QR’s</a>
            <a class="btn secondary" href="/admin">Rapport</a>
          </div>
        </div>`
      )
    );
  }

  const ev = result.event;
  return res.send(
    layout(
      "IN geregistreerd",
      `<div class="card">
        ${cardHeader(ev.company_name, "IN")}
        <div style="height:10px"></div>
        <div class="big">✅ IN</div>
        <p style="margin:0; font-size:18px;">Werknemer: <b>${escapeHtml(ev.display_name)}</b></p>
        <p class="muted" style="margin-top:8px;">
          Tijd: <b>${escapeHtml(ev.timestamp)}</b><br/>
          Tag: ${escapeHtml(ev.tag_name)}
        </p>
        <div class="row" style="margin-top:14px;">
          <a class="btn secondary" href="/tags">QR’s</a>
          <a class="btn secondary" href="/admin">Rapport</a>
        </div>
      </div>`
    )
  );
});

// OUT scan
router.get("/t/:tagId/out", async (req, res) => {
  const tag = await resolveTag(Number(req.params.tagId));
  if (!tag) {
    return res.status(404).send(layout("Onbekend", `<div class="card"><h1>Onbekende ScanTag</h1></div>`));
  }

  const binding = await resolveBinding(req.cookies[COOKIE_NAME]);

  // OUT zonder activatie => geen activatie via OUT
  if (!binding || binding.company_id !== tag.company_id) {
    return res.send(
      layout(
        "Eerst activeren",
        `<div class="card">
          ${cardHeader(tag.company_name, "OUT")}
          <div style="height:10px"></div>
          <div class="big">Eerst activeren</div>
          <p class="muted">Deze smartphone is nog niet geactiveerd. Dit kan alleen via een <b>IN</b>-scan.</p>
          <div class="row" style="margin-top:14px;">
            <a class="btn" href="/t/${tag.tag_id}/in">Scan IN om te activeren</a>
            <a class="btn secondary" href="/tags">QR’s</a>
          </div>
        </div>`
      )
    );
  }

  const result = await logScanEvent({
    companyId: tag.company_id,
    employeeId: binding.employee_id,
    tagId: tag.tag_id,
    direction: "OUT",
  });

  if (result.skipped) {
    return res.send(
      layout(
        "Genegeerd",
        `<div class="card">
          ${cardHeader(tag.company_name, "OUT")}
          <div style="height:10px"></div>
          <div class="big">⏱️ Genegeerd</div>
          <p class="muted">${escapeHtml(result.reason)}</p>
          <p class="muted">Werknemer: <b>${escapeHtml(binding.display_name)}</b></p>
          <div class="row" style="margin-top:14px;">
            <a class="btn secondary" href="/admin">Rapport</a>
          </div>
        </div>`
      )
    );
  }

  const ev = result.event;
  return res.send(
    layout(
      "OUT geregistreerd",
      `<div class="card">
        ${cardHeader(ev.company_name, "OUT")}
        <div style="height:10px"></div>
        <div class="big">✅ OUT</div>
        <p style="margin:0; font-size:18px;">Werknemer: <b>${escapeHtml(ev.display_name)}</b></p>
        <p class="muted" style="margin-top:8px;">
          Tijd: <b>${escapeHtml(ev.timestamp)}</b><br/>
          Tag: ${escapeHtml(ev.tag_name)}
        </p>
        <div class="row" style="margin-top:14px;">
          <a class="btn secondary" href="/admin">Rapport</a>
        </div>
      </div>`
    )
  );
});

// ACTIVATIE endpoint (post)
router.post("/activate", async (req, res) => {
  const tagId = Number(req.body.tagId);
  const scanCode = String(req.body.scan_code || "").trim();

  const tag = await resolveTag(tagId);
  if (!tag) {
    return res.status(404).send(layout("Onbekend", `<div class="card"><h1>Onbekende ScanTag</h1></div>`));
  }

  if (!scanCode) {
    return res.redirect(`/t/${tagId}/in`);
  }

  // Zoek werknemer via scan_code (niet via naam)
  const emp = await get(
    `SELECT id, display_name
     FROM employees
     WHERE company_id = $1 AND scan_code = $2
     LIMIT 1`,
    [tag.company_id, scanCode]
  );

  if (!emp) {
    return res.send(
      layout(
        "Onbekende code",
        `<div class="card">
          ${cardHeader(tag.company_name, "IN")}
          <div style="height:10px"></div>
          <div class="big">❌ Onbekende activatiecode</div>
          <p class="muted">Controleer de code en probeer opnieuw.</p>
          <div class="row" style="margin-top:14px;">
            <a class="btn" href="/t/${tagId}/in">Opnieuw</a>
            <a class="btn secondary" href="/wizard/employees">Bekijk codes</a>
          </div>
        </div>`
      )
    );
  }

  // 1 binding per werknemer + verwijder eventuele binding op deze cookie
  await run(`DELETE FROM device_bindings WHERE employee_id = $1`, [emp.id]);

  const existingToken = req.cookies[COOKIE_NAME];
  if (existingToken) {
    await run(`DELETE FROM device_bindings WHERE token = $1`, [existingToken]);
  }

  const token = makeToken();
  await run(
    `INSERT INTO device_bindings (company_id, employee_id, token)
     VALUES ($1,$2,$3)`,
    [tag.company_id, emp.id, token]
  );

  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: IS_PROD,
    sameSite: "lax",
    maxAge: 1000 * 60 * 60 * 24 * 365,
  });

  // Na activatie: registreer meteen IN
  // We redirecten naar IN endpoint zodat dezelfde flow/HTML gebruikt wordt.
  return res.redirect(`/t/${tagId}/in`);
});

module.exports = router;
