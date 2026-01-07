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
    `SELECT db.company_id, e.id AS employee_id, e.code AS employee_code
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
  if (cooldown) return { skipped: true, reason: `Cooldown (${COOLDOWN_MINUTES} min)` };

  const inserted = await get(
    `INSERT INTO scan_events (company_id, employee_id, scantag_id, direction)
     VALUES ($1,$2,$3,$4)
     RETURNING id`,
    [companyId, employeeId, tagId, direction]
  );

  const event = await get(
    `SELECT se.timestamp, e.code AS employee_code, c.name AS company_name, st.name AS tag_name
     FROM scan_events se
     JOIN employees e ON e.id = se.employee_id
     JOIN companies c ON c.id = se.company_id
     JOIN scantags st ON st.id = se.scantag_id
     WHERE se.id = $1`,
    [inserted.id]
  );

  return { skipped: false, event };
}

function notPairedOutPage(companyName, tagId) {
  return `<div class="card">
    ${cardHeader(companyName, "OUT")}
    <div style="height:10px"></div>
    <div class="big">Eerst koppelen</div>
    <p class="muted">Dit toestel is nog niet gekoppeld. Koppelen kan alleen via een <b>IN</b>-scan.</p>
    <div class="row" style="margin-top:14px;">
      <a class="btn" href="/t/${tagId}/in">Scan IN om te koppelen</a>
      <a class="btn secondary" href="/tags">Tags</a>
    </div>
  </div>`;
}

router.get("/t/:tagId/in", async (req, res) => {
  const tag = await resolveTag(Number(req.params.tagId));
  if (!tag) return res.status(404).send(layout("Onbekend", `<div class="card"><h1>Onbekende tag</h1></div>`));

  const binding = await resolveBinding(req.cookies[COOKIE_NAME]);
  if (!binding || binding.company_id !== tag.company_id) {
    return res.send(
      layout(
        "Koppelen",
        `<div class="card">
          ${cardHeader(tag.company_name, "IN")}
          <div style="height:10px"></div>
          <div class="big">Koppel toestel</div>
          <p class="muted">Eerste scan op dit toestel. Geef je werknemer-ID in en registreer meteen je IN.</p>
          <form method="POST" action="/pair">
            <input type="hidden" name="tagId" value="${tag.tag_id}" />
            <label class="muted" for="code">Werknemer-ID</label><br/>
            <input id="code" name="employeeCode" placeholder="WERKNEMER1" autocomplete="off" required />
            <div style="height:12px"></div>
            <button class="btn" type="submit">Koppel & registreer</button>
          </form>
        </div>`
      )
    );
  }

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
          <p class="muted">Werknemer: <b>${escapeHtml(binding.employee_code)}</b></p>
          <div class="row" style="margin-top:14px;">
            <a class="btn secondary" href="/tags">Tags</a>
          </div>
        </div>`
      )
    );
  }

  const ev = result.event;
  res.send(
    layout(
      "Geregistreerd",
      `<div class="card">
        ${cardHeader(ev.company_name, "IN")}
        <div style="height:10px"></div>
        <div class="big">✅ IN</div>
        <p style="margin:0; font-size:18px;">Werknemer: <b>${escapeHtml(ev.employee_code)}</b></p>
        <p class="muted" style="margin-top:8px;">Tijd: <b>${escapeHtml(ev.timestamp)}</b><br/>Tag: ${escapeHtml(ev.tag_name)}</p>
        <div class="row" style="margin-top:14px;">
          <a class="btn secondary" href="/tags">Tags</a>
        </div>
      </div>`
    )
  );
});

router.get("/t/:tagId/out", async (req, res) => {
  const tag = await resolveTag(Number(req.params.tagId));
  if (!tag) return res.status(404).send(layout("Onbekend", `<div class="card"><h1>Onbekende tag</h1></div>`));

  const binding = await resolveBinding(req.cookies[COOKIE_NAME]);
  if (!binding || binding.company_id !== tag.company_id) {
    return res.send(layout("Eerst koppelen", notPairedOutPage(tag.company_name, tag.tag_id)));
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
          <p class="muted">Werknemer: <b>${escapeHtml(binding.employee_code)}</b></p>
          <div class="row" style="margin-top:14px;">
            <a class="btn secondary" href="/tags">Tags</a>
          </div>
        </div>`
      )
    );
  }

  const ev = result.event;
  res.send(
    layout(
      "Geregistreerd",
      `<div class="card">
        ${cardHeader(ev.company_name, "OUT")}
        <div style="height:10px"></div>
        <div class="big">✅ OUT</div>
        <p style="margin:0; font-size:18px;">Werknemer: <b>${escapeHtml(ev.employee_code)}</b></p>
        <p class="muted" style="margin-top:8px;">Tijd: <b>${escapeHtml(ev.timestamp)}</b><br/>Tag: ${escapeHtml(ev.tag_name)}</p>
        <div class="row" style="margin-top:14px;">
          <a class="btn secondary" href="/tags">Tags</a>
        </div>
      </div>`
    )
  );
});

module.exports = router;
