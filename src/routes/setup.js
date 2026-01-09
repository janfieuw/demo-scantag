const express = require("express");
const { get, all, run } = require("../db");
const { layout, escapeHtml } = require("../ui/layout");

const router = express.Router();

// Helpers
async function getCompany() {
  return await get(`SELECT id, name FROM companies ORDER BY id LIMIT 1`);
}

async function getEmployees(companyId) {
  return await all(
    `SELECT id, code FROM employees WHERE company_id = $1 ORDER BY id`,
    [companyId]
  );
}

async function getScantag(companyId) {
  return await get(
    `SELECT id, name FROM scantags WHERE company_id = $1 ORDER BY id LIMIT 1`,
    [companyId]
  );
}

// Wizard home
router.get("/setup", async (req, res) => {
  const company = await getCompany();
  const employees = company ? await getEmployees(company.id) : [];
  const tag = company ? await getScantag(company.id) : null;

  const companyOk = !!company;
  const employeesOk = employees.length === 2;
  const tagOk = !!tag;

  res.send(
    layout(
      "Setup",
      `<div class="card">
        <h1>Setup (Pilot)</h1>
        <p class="muted">Beperkt tot 1 bedrijf en 2 werknemers.</p>

        <table>
          <thead><tr><th>Stap</th><th>Status</th></tr></thead>
          <tbody>
            <tr>
              <td><a href="/setup/company">1) Bedrijf</a></td>
              <td>${companyOk ? "✅ OK" : "❌ ontbreekt"}</td>
            </tr>
            <tr>
              <td><a href="/setup/employees">2) Werknemers (2)</a></td>
              <td>${employeesOk ? "✅ OK" : `❌ ${employees.length}/2`}</td>
            </tr>
            <tr>
              <td>3) ScanTag</td>
              <td>${tagOk ? "✅ OK" : "❌ ontbreekt"}</td>
            </tr>
          </tbody>
        </table>

        <div class="row" style="margin-top:14px;">
          <a class="btn" href="/setup/company">Start setup</a>
          ${companyOk && employeesOk && tagOk ? `<a class="btn secondary" href="/tags">Genereer QR’s</a>` : ""}
        </div>

        ${
          companyOk
            ? `<p class="muted" style="margin-top:14px;">
                 Huidig bedrijf: <b>${escapeHtml(company.name)}</b>
               </p>`
            : ""
        }
      </div>`
    )
  );
});

// Step 1: company
router.get("/setup/company", async (req, res) => {
  const company = await getCompany();

  if (company) {
    return res.send(
      layout(
        "Bedrijf",
        `<div class="card">
          <h1>Bedrijf</h1>
          <p class="muted">Er kan maar 1 bedrijf bestaan in deze pilot.</p>

          <p>Huidig bedrijf: <b>${escapeHtml(company.name)}</b></p>

          <div class="row" style="margin-top:14px;">
            <a class="btn secondary" href="/setup/employees">Volgende: werknemers</a>
            <a class="btn secondary" href="/setup">Terug</a>
          </div>
        </div>`
      )
    );
  }

  res.send(
    layout(
      "Bedrijf aanmaken",
      `<div class="card">
        <h1>Voeg een bedrijf toe</h1>
        <form method="POST" action="/setup/company">
          <label class="muted" for="name">Bedrijfsnaam</label><br/>
          <input id="name" name="name" placeholder="Bedrijf..." required />
          <div style="height:12px"></div>
          <button class="btn" type="submit">Voeg toe</button>
        </form>

        <div class="row" style="margin-top:14px;">
          <a class="btn secondary" href="/setup">Terug</a>
        </div>
      </div>`
    )
  );
});

router.post("/setup/company", async (req, res) => {
  const name = String(req.body.name || "").trim();
  if (!name) return res.redirect("/setup/company");

  const existing = await getCompany();
  if (existing) return res.redirect("/setup/company");

  // create company
  const inserted = await get(
    `INSERT INTO companies (name) VALUES ($1) RETURNING id`,
    [name]
  );

  // create 1 scantag for this company
  await run(
    `INSERT INTO scantags (company_id, name) VALUES ($1, $2)`,
    [inserted.id, "ScanTag"]
  );

  res.redirect("/setup/company");
});

// Step 2: employees (exactly 2)
router.get("/setup/employees", async (req, res) => {
  const company = await getCompany();
  if (!company) return res.redirect("/setup/company");

  const employees = await getEmployees(company.id);

  const list = employees
    .map(
      (e, idx) => `<tr><td>${idx + 1}</td><td>${escapeHtml(e.code)}</td></tr>`
    )
    .join("");

  const canAdd = employees.length < 2;

  res.send(
    layout(
      "Werknemers",
      `<div class="card">
        <h1>Voeg twee werknemers toe</h1>
        <p class="muted">Max 2 werknemers in de pilot. Codes zijn wat werknemers ingeven bij eerste IN-scan.</p>

        <table>
          <thead><tr><th>#</th><th>Werknemer code</th></tr></thead>
          <tbody>${list || ""}</tbody>
        </table>

        ${
          canAdd
            ? `<hr />
               <form method="POST" action="/setup/employees">
                 <label class="muted" for="code">Werknemer code</label><br/>
                 <input id="code" name="code" placeholder="WERKNEMER1" required />
                 <div style="height:12px"></div>
                 <button class="btn" type="submit">Voeg toe</button>
               </form>`
            : `<p class="muted" style="margin-top:14px;">✅ 2 werknemers toegevoegd.</p>`
        }

        <div class="row" style="margin-top:14px;">
          <a class="btn secondary" href="/setup">Terug</a>
          ${
            employees.length === 2
              ? `<a class="btn" href="/tags">Genereer QR’s</a>`
              : ""
          }
        </div>
      </div>`
    )
  );
});

router.post("/setup/employees", async (req, res) => {
  const company = await getCompany();
  if (!company) return res.redirect("/setup/company");

  const employees = await getEmployees(company.id);
  if (employees.length >= 2) return res.redirect("/setup/employees");

  const code = String(req.body.code || "").trim().toUpperCase();
  if (!code) return res.redirect("/setup/employees");

  // Insert employee
  try {
    await run(
      `INSERT INTO employees (company_id, code) VALUES ($1, $2)`,
      [company.id, code]
    );
  } catch (e) {
    // ignore duplicates, just show page again
  }

  res.redirect("/setup/employees");
});

module.exports = router;
