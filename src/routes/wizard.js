const express = require("express");
const { get, all, run } = require("../db");
const { layout, escapeHtml } = require("../ui/layout");

const router = express.Router();

async function getCompany() {
  return await get(`SELECT id, name FROM companies ORDER BY id LIMIT 1`);
}
async function getEmployees(companyId) {
  return await all(`SELECT id, code FROM employees WHERE company_id = $1 ORDER BY id`, [companyId]);
}
async function getScantag(companyId) {
  return await get(`SELECT id, name FROM scantags WHERE company_id = $1 ORDER BY id LIMIT 1`, [companyId]);
}

// Reset wizard (pilot): alles leegmaken
router.post("/wizard/reset", async (req, res) => {
  await run(`DELETE FROM scan_events`);
  await run(`DELETE FROM device_bindings`);
  await run(`DELETE FROM scantags`);
  await run(`DELETE FROM employees`);
  await run(`DELETE FROM companies`);
  res.redirect("/wizard/company");
});

// STEP 1: Company
router.get("/wizard/company", async (req, res) => {
  const company = await getCompany();
  if (company) return res.redirect("/wizard/employees");

  res.send(
    layout(
      "Wizard - Onderneming",
      `<div class="card">
        <h1>1) Voeg onderneming toe</h1>
        <p class="muted">Pilot: 1 onderneming, 2 werknemers.</p>

        <form method="POST" action="/wizard/company">
          <label class="muted" for="name">Ondernemingsnaam</label><br/>
          <input id="name" name="name" placeholder="bv. BEDRIJF VANDENAVENNE" required />
          <div style="height:12px"></div>
          <button class="btn" type="submit">Volgende</button>
        </form>
      </div>`
    )
  );
});

router.post("/wizard/company", async (req, res) => {
  const name = String(req.body.name || "").trim();
  if (!name) return res.redirect("/wizard/company");

  const existing = await getCompany();
  if (existing) return res.redirect("/wizard/employees");

  const inserted = await get(`INSERT INTO companies (name) VALUES ($1) RETURNING id`, [name]);

  // automatisch 1 scantag aanmaken voor dit bedrijf
  await run(`INSERT INTO scantags (company_id, name) VALUES ($1,$2)`, [inserted.id, "ScanTag"]);

  res.redirect("/wizard/employees");
});

// STEP 2: Employees (exact 2)
router.get("/wizard/employees", async (req, res) => {
  const company = await getCompany();
  if (!company) return res.redirect("/wizard/company");

  const employees = await getEmployees(company.id);
  if (employees.length >= 2) return res.redirect("/wizard/qrs");

  const list = employees
    .map((e, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(e.code)}</td></tr>`)
    .join("");

  res.send(
    layout(
      "Wizard - Werknemers",
      `<div class="card">
        <h1>2) Voeg twee werknemers toe</h1>
        <p class="muted">Werknemer-code is wat je ingeeft bij de eerste IN-scan.</p>

        <p class="muted">Onderneming: <b>${escapeHtml(company.name)}</b></p>

        <table>
          <thead><tr><th>#</th><th>Werknemer code</th></tr></thead>
          <tbody>${list}</tbody>
        </table>

        <hr />

        <form method="POST" action="/wizard/employees">
          <label class="muted" for="code">Werknemer code (${employees.length + 1}/2)</label><br/>
          <input id="code" name="code" placeholder="bv. PETER" required />
          <div style="height:12px"></div>
          <button class="btn" type="submit">Voeg toe</button>
        </form>

        <div class="row" style="margin-top:14px;">
          <form method="POST" action="/wizard/reset">
            <button class="btn secondary" type="submit">Opnieuw beginnen</button>
          </form>
        </div>
      </div>`
    )
  );
});

router.post("/wizard/employees", async (req, res) => {
  const company = await getCompany();
  if (!company) return res.redirect("/wizard/company");

  const employees = await getEmployees(company.id);
  if (employees.length >= 2) return res.redirect("/wizard/qrs");

  const code = String(req.body.code || "").trim().toUpperCase();
  if (!code) return res.redirect("/wizard/employees");

  try {
    await run(`INSERT INTO employees (company_id, code) VALUES ($1,$2)`, [company.id, code]);
  } catch (e) {
    // duplicate -> gewoon terug
  }

  const updated = await getEmployees(company.id);
  if (updated.length >= 2) return res.redirect("/wizard/qrs");

  res.redirect("/wizard/employees");
});

// STEP 3: QR's (we hergebruiken gewoon /tags als view, maar via wizard-route)
router.get("/wizard/qrs", async (req, res) => {
  const company = await getCompany();
  if (!company) return res.redirect("/wizard/company");

  const employees = await getEmployees(company.id);
  if (employees.length < 2) return res.redirect("/wizard/employees");

  const tag = await getScantag(company.id);
  if (!tag) {
    await run(`INSERT INTO scantags (company_id, name) VALUES ($1,$2)`, [company.id, "ScanTag"]);
  }

  // vanaf hier toon je gewoon de QR pagina
  return res.redirect("/tags");
});

module.exports = router;
