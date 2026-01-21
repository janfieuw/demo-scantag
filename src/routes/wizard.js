// src/routes/wizard.js
const express = require("express");
const crypto = require("crypto");
const { get, all, run } = require("../db");
const { layoutDemo, escapeHtml } = require("../ui/layout");

const router = express.Router();

/* =========================
   Helpers
   ========================= */

function generateScanCode() {
  return crypto.randomBytes(4).toString("hex");
}

async function getCompany() {
  return await get(`SELECT id, name FROM companies ORDER BY id LIMIT 1`);
}

async function getEmployees(companyId) {
  return await all(
    `
    SELECT
      id,
      first_name,
      last_name,
      display_name,
      scan_code
    FROM employees
    WHERE company_id = $1
    ORDER BY
      last_name ASC NULLS LAST,
      first_name ASC NULLS LAST,
      display_name ASC,
      id ASC
    `,
    [companyId]
  );
}

/* =========================
   STEP 1 — Company
   ========================= */

router.get("/wizard/company", async (req, res) => {
  return res.send(
    layoutDemo(
      "STAP 1",
      `
      <div class="demo-kicker">DEMO UITTESTEN — IN 3 STAPPEN</div>
      <h1 class="demo-title">STAP 1.</h1>

      <p class="demo-lead">Vul de naam van jouw onderneming in.</p>

      <form method="POST" action="/wizard/company" class="demo-form">
        <label class="demo-label">Onderneming</label>
        <input class="demo-input" name="name" required />
        <div class="demo-actions">
          <button class="demo-btn primary">VOLGENDE</button>
        </div>
      </form>
      `
    )
  );
});

router.post("/wizard/company", async (req, res) => {
  const name = String(req.body.name || "").trim();
  if (!name) return res.redirect("/wizard/company");

  await run(`INSERT INTO companies (name) VALUES ($1)`, [name]);
  return res.redirect("/wizard/employees");
});

/* =========================
   STEP 2 — Employees
   ========================= */

router.get("/wizard/employees", async (req, res) => {
  const company = await getCompany();
  if (!company) return res.redirect("/wizard/company");

  const employees = await getEmployees(company.id);

  const rows = employees
    .map(
      (e, idx) => `
      <tr>
        <td>${idx + 1}</td>
        <td>${escapeHtml(e.last_name || "")}</td>
        <td>${escapeHtml(e.first_name || "")}</td>
        <td><code>${escapeHtml(e.scan_code)}</code></td>
      </tr>
    `
    )
    .join("");

  return res.send(
    layoutDemo(
      "STAP 2",
      `
      <div class="demo-kicker">DEMO UITTESTEN — IN 3 STAPPEN</div>
      <h1 class="demo-title">STAP 2.</h1>

      <p class="demo-lead">
        Voeg twee werknemers toe. Na toevoegen wordt automatisch een activatiecode gegenereerd.
      </p>

      <form method="POST" action="/wizard/employees" class="demo-form">
        <label class="demo-label">Familienaam</label>
        <input class="demo-input" name="last_name" required />

        <label class="demo-label">Voornaam</label>
        <input class="demo-input" name="first_name" required />

        <div class="demo-actions">
          <button class="demo-btn primary">TOEVOEGEN</button>
        </div>
      </form>

      ${
        employees.length > 0
          ? `
        <table class="demo-table" style="margin-top:16px;">
          <thead>
            <tr>
              <th>#</th>
              <th>Familienaam</th>
              <th>Voornaam</th>
              <th>Activatiecode</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        `
          : ""
      }

      <div class="demo-actions" style="margin-top:16px;">
        <a class="demo-btn ghost" href="/wizard/company">TERUG</a>
        ${
          employees.length >= 2
            ? `<a class="demo-btn primary" href="/wizard/reference">VOLGENDE</a>`
            : ""
        }
      </div>
      `
    )
  );
});

router.post("/wizard/employees", async (req, res) => {
  const company = await getCompany();
  if (!company) return res.redirect("/wizard/company");

  const firstName = String(req.body.first_name || "").trim();
  const lastName = String(req.body.last_name || "").trim();

  if (!firstName || !lastName) {
    return res.redirect("/wizard/employees");
  }

  const displayName = `${lastName} ${firstName}`;
  const scanCode = generateScanCode();

  await run(
    `
    INSERT INTO employees
      (company_id, first_name, last_name, display_name, scan_code)
    VALUES
      ($1, $2, $3, $4, $5)
    `,
    [company.id, firstName, lastName, displayName, scanCode]
  );

  return res.redirect("/wizard/employees");
});

/* =========================
   STEP 3 — Reference time
   ========================= */

router.get("/wizard/reference", async (req, res) => {
  const company = await getCompany();
  if (!company) return res.redirect("/wizard/company");

  return res.send(
    layoutDemo(
      "STAP 3",
      `
      <div class="demo-kicker">DEMO UITTESTEN — IN 3 STAPPEN</div>
      <h1 class="demo-title">STAP 3.</h1>

      <p class="demo-lead">
        Referentietijd instellen per werknemer.
      </p>

      <div class="demo-actions">
        <a class="demo-btn primary" href="/tags">NAAR TAGS</a>
      </div>
      `
    )
  );
});

module.exports = router;
