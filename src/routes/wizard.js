const express = require("express");
const crypto = require("crypto");
const { get, all, run } = require("../db");
const { layout, escapeHtml } = require("../ui/layout");

const router = express.Router();

async function getCompany() {
  return await get(`SELECT id, name FROM companies ORDER BY id LIMIT 1`);
}

async function getEmployees(companyId) {
  return await all(
    `SELECT id, display_name, scan_code
     FROM employees
     WHERE company_id = $1
     ORDER BY id`,
    [companyId]
  );
}

async function getScantag(companyId) {
  return await get(
    `SELECT id, name FROM scantags WHERE company_id = $1 ORDER BY id LIMIT 1`,
    [companyId]
  );
}

function generateScanCode() {
  return crypto.randomBytes(7).toString("base64url"); // ~10 chars
}

async function generateUniqueScanCode(companyId) {
  for (let i = 0; i < 10; i++) {
    const code = generateScanCode();
    const exists = await get(
      `SELECT 1 FROM employees WHERE company_id = $1 AND scan_code = $2 LIMIT 1`,
      [companyId, code]
    );
    if (!exists) return code;
  }
  throw new Error("Failed to generate unique scan code");
}

// Reset: alles leeg
router.post("/wizard/reset", async (req, res) => {
  await run(`DELETE FROM scan_events`);
  await run(`DELETE FROM device_bindings`);
  await run(`DELETE FROM scantags`);
  await run(`DELETE FROM employees`);
  await run(`DELETE FROM companies`);
  res.redirect("/wizard/company");
});

// STEP 1
router.get("/wizard/company", async (req, res) => {
  const company = await getCompany();

  if (company) {
    return res.send(
      layout(
        "Wizard - Onderneming",
        `<div class="card">
          <h1>1) Voeg jouw onderneming toe</h1>
          <p class="muted">Pilot: 1 onderneming, 2 werknemers.</p>

          <p>Huidige onderneming: <b>${escapeHtml(company.name)}</b></p>

          <div class="row" style="margin-top:14px;">
            <a class="btn" href="/wizard/employees">Volgende</a>
            <form method="POST" action="/wizard/reset">
              <button class="btn secondary" type="submit">Opnieuw beginnen</button>
            </form>
          </div>
        </div>`
      )
    );
  }

  return res.send(
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

        <div class="row" style="margin-top:14px;">
          <form method="POST" action="/wizard/reset">
            <button class="btn secondary" type="submit">Opnieuw beginnen</button>
          </form>
        </div>
      </div>`
    )
  );
});

router.post("/wizard/company", async (req, res) => {
  const name = String(req.body.name || "").trim();
  if (!name) return res.redirect("/wizard/company");

  const existing = await getCompany();
  if (existing) return res.redirect("/wizard/company");

  const inserted = await get(
    `INSERT INTO companies (name) VALUES ($1) RETURNING id`,
    [name]
  );

  await run(
    `INSERT INTO scantags (company_id, name) VALUES ($1,$2)`,
    [inserted.id, "ScanTag"]
  );

  return res.redirect("/wizard/company");
});

// STEP 2
router.get("/wizard/employees", async (req, res) => {
  const company = await getCompany();
  if (!company) return res.redirect("/wizard/company");

  const employees = await getEmployees(company.id);
  const canAdd = employees.length < 2;

  const list = employees
    .map(
      (e, i) => `<tr>
        <td>${i + 1}</td>
        <td>${escapeHtml(e.display_name)}</td>
        <td><code>${escapeHtml(e.scan_code)}</code></td>
      </tr>`
    )
    .join("");

  return res.send(
    layout(
      "Wizard - Werknemers",
      `<div class="card">
        <h1>2) Voeg twee werknemers toe</h1>
        <p class="muted">
          Vul de naam in van de werknemer. Na toevoegen wordt automatisch een <b>activatiecode</b> gegenereerd.
          Deze code gebruik je straks om de smartphone te <b>activeren</b>.
        </p>
        <p class="muted">Onderneming: <b>${escapeHtml(company.name)}</b></p>

        <table>
          <thead><tr><th>#</th><th>Naam</th><th>Activatiecode</th></tr></thead>
          <tbody>${list}</tbody>
        </table>

        ${
          canAdd
            ? `<hr />
               <form method="POST" action="/wizard/employees/add">
                 <label class="muted" for="display_name">Naam werknemer (${employees.length + 1}/2)</label><br/>
                 <input id="display_name" name="display_name" placeholder="bv. JAN" required />
                 <div style="height:12px"></div>
                 <button class="btn" type="submit">Voeg toe</button>
               </form>`
            : `<p class="muted" style="margin-top:14px;">✅ 2 werknemers toegevoegd.</p>`
        }

        <div class="row" style="margin-top:14px;">
          <a class="btn secondary" href="/wizard/company">Terug</a>
          ${
            employees.length === 2
              ? `<a class="btn" href="/wizard/qrs">Volgende</a>`
              : ""
          }
          <form method="POST" action="/wizard/reset">
            <button class="btn secondary" type="submit">Opnieuw beginnen</button>
          </form>
        </div>
      </div>`
    )
  );
});

router.post("/wizard/employees/add", async (req, res) => {
  const company = await getCompany();
  if (!company) return res.redirect("/wizard/company");

  const employees = await getEmployees(company.id);
  if (employees.length >= 2) return res.redirect("/wizard/employees");

  const displayName = String(req.body.display_name || "").trim();
  if (!displayName) return res.redirect("/wizard/employees");

  const scanCode = await generateUniqueScanCode(company.id);

  await run(
    `INSERT INTO employees (company_id, display_name, scan_code)
     VALUES ($1,$2,$3)`,
    [company.id, displayName, scanCode]
  );

  return res.redirect("/wizard/employees");
});

// STEP 3
router.get("/wizard/qrs", async (req, res) => {
  const company = await getCompany();
  if (!company) return res.redirect("/wizard/company");

  const employees = await getEmployees(company.id);
  if (employees.length < 2) return res.redirect("/wizard/employees");

  const tag = await getScantag(company.id);
  if (!tag) {
    await run(
      `INSERT INTO scantags (company_id, name) VALUES ($1,$2)`,
      [company.id, "ScanTag"]
    );
  }

  return res.redirect("/tags");
});

module.exports = router;
