const express = require("express");
const crypto = require("crypto");
const { get, run } = require("../db");
const { COOKIE_NAME, IS_PROD } = require("../config");
const { layout, escapeHtml } = require("../ui/layout");
const { cardHeader } = require("../ui/components");

const router = express.Router();

function makeToken() {
  return crypto.randomBytes(24).toString("hex");
}

async function resolveTag(tagId) {
  return await get(
    `SELECT st.id AS tag_id, c.id AS company_id, c.name AS company_name
     FROM scantags st
     JOIN companies c ON c.id = st.company_id
     WHERE st.id = $1`,
    [tagId]
  );
}

router.post("/pair", async (req, res) => {
  const tagId = Number(req.body.tagId);
  const employeeCode = String(req.body.employeeCode || "").trim().toUpperCase();

  const tag = await resolveTag(tagId);
  if (!tag) return res.status(404).send(layout("Onbekend", `<div class="card"><h1>Onbekende tag</h1></div>`));

  const emp = await get(
    `SELECT id, code FROM employees WHERE company_id = $1 AND UPPER(code) = UPPER($2)`,
    [tag.company_id, employeeCode]
  );

  if (!emp) {
    return res.send(
      layout(
        "Onbekende ID",
        `<div class="card">
          ${cardHeader(tag.company_name, "IN")}
          <div style="height:10px"></div>
          <div class="big">❌ Onbekende ID</div>
          <p class="muted">ID bestaat niet. Probeer opnieuw.</p>
          <div class="row" style="margin-top:14px;">
            <a class="btn" href="/t/${tag.tag_id}/in">Opnieuw</a>
          </div>
        </div>`
      )
    );
  }

  // 1 binding per werknemer + clear old token
  await run(`DELETE FROM device_bindings WHERE employee_id = $1`, [emp.id]);
  const existingToken = req.cookies[COOKIE_NAME];
  if (existingToken) await run(`DELETE FROM device_bindings WHERE token = $1`, [existingToken]);

  const token = makeToken();
  await run(`INSERT INTO device_bindings (company_id, employee_id, token) VALUES ($1,$2,$3)`, [
    tag.company_id,
    emp.id,
    token,
  ]);

  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: IS_PROD,
    sameSite: "lax",
    maxAge: 1000 * 60 * 60 * 24 * 365,
  });

  // Redirect to IN scan endpoint to log the IN (and show result)
  res.redirect(`/t/${tag.tag_id}/in`);
});

module.exports = router;
