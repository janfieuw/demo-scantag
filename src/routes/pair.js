// src/routes/pair.js
const express = require("express");
const crypto = require("crypto");
const { get, run } = require("../db");
const { COOKIE_NAME, IS_PROD } = require("../config");
const { layout } = require("../ui/layout");
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
  const employeeCodeRaw = String(req.body.employeeCode || "").trim(); // activatiecode
  const directionRaw = String(req.body.direction || "in").trim().toLowerCase();
  const direction = directionRaw === "out" ? "out" : "in";

  const tag = await resolveTag(tagId);
  if (!tag) {
    return res
      .status(404)
      .send(layout("Onbekend", `<div class="card"><h1>Onbekende tag</h1></div>`));
  }

  // ✅ zoek op scan_code (activatiecode)
  const emp = await get(
    `SELECT id, scan_code
     FROM employees
     WHERE company_id = $1
       AND UPPER(scan_code) = UPPER($2)
     LIMIT 1`,
    [tag.company_id, employeeCodeRaw]
  );

  if (!emp) {
    return res.send(
      layout(
        "Onbekende activatiecode",
        `<div class="card">
          ${cardHeader(tag.company_name, direction.toUpperCase())}
          <div style="height:10px"></div>
          <div class="big">❌ Onbekende activatiecode</div>
          <p class="muted">Activatiecode bestaat niet. Probeer opnieuw.</p>
          <div class="row" style="margin-top:14px;">
            <a class="btn" href="/t/${tag.tag_id}/${direction}">Opnieuw</a>
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

  // ✅ Belangrijk: paired=1 -> device.js slaat cooldown over
  res.redirect(`/t/${tag.tag_id}/${direction}?paired=1`);
});

module.exports = router;
