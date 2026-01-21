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
  // behoud jouw stijl: kort & uniek genoeg voor demo
  return crypto.randomBytes(4).toString("hex");
}

function getDemoSession(req) {
  return String(req.cookies?.demo_session || "").trim();
}

async function getCompany(req) {
  const sid = getDemoSession(req);
  if (!sid) return null;

  return await get(
    `SELECT id, name FROM companies WHERE demo_session_id = $1 ORDER BY id LIMIT 1`,
    [sid]
  );
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

async function ensureScantag(companyId) {
  const tag = await get(
    `SELECT id FROM scantags WHERE company_id = $1 ORDER BY id ASC LIMIT 1`,
    [companyId]
  );
  if (tag) return tag.id;

  const inserted = await get(
    `INSERT INTO scantags (company_id, name) VALUES ($1,$2) RETURNING id`,
    [companyId, "ScanTag"]
  );
  return inserted?.id || null;
}

/* =========================
   STEP 1 — Company
   ========================= */

router.get("/wizard/company", async (req, res) => {
  // als er geen demo_session is, moet je eerst naar account
  if (!getDemoSession(req)) return res.redirect("/demo/account");

  const company = await getCompany(req);

  // als company al bestaat voor deze session, toon doorlink
  if (company) {
    return res.send(
      layoutDemo(
        "STAP 1",
        `
        <div class="demo-kicker">DEMO UITTESTEN — IN 3 STAPPEN</div>
        <h1 class="demo-title">STAP 1.</h1>

        <p class="demo-lead">Vul de naam van jouw onderneming in.</p>

        <p class="demo-muted">Onderneming: <b>${escapeHtml(company.name)}</b></p>

        <div class="demo-actions">
          <a class="demo-btn primary" href="/wizard/employees">VOLGENDE</a>
        </div>
        `
      )
    );
  }

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
          <button class="demo-btn primary" type="submit">VOLGENDE</button>
        </div>
      </form>
      `
    )
  );
});

router.post("/wizard/company", async (req, res) => {
  const sid = getDemoSession(req);
  if (!sid) return res.redirect("/demo/account");

  const name = String(req.body.name || "").trim();
  if (!name) return res.redirect("/wizard/company");

  // voorkom dubbele companies voor dezelfde session
  const existing = await getCompany(req);
  if (existing) return res.redirect("/wizard/employees");

  const inserted = await get(
    `INSERT INTO companies (name, demo_session_id) VALUES ($1,$2) RETURNING id`,
    [name, sid]
  );

  if (inserted?.id) {
    await ensureScantag(inserted.id);
  }

  return res.redirect("/wizard/employees");
});

/* =========================
   STEP 2 — Employees
   ========================= */

router.get("/wizard/employees", async (req, res) => {
  const company = await getCompany(req);
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

      <p class="demo-muted">Onderneming: <b>${escapeHtml(company.name)}</b></p>

      <form method="POST" action="/wizard/employees" class="demo-form">
        <label class="demo-label">Familienaam</label>
        <input class="demo-input" name="last_name" required />

        <label class="demo-label">Voornaam</label>
        <input class="demo-input" name="first_name" required />

        <div class="demo-actions">
          <button class="demo-btn primary" type="submit">TOEVOEGEN</button>
        </div>
      </form>

      ${
        employees.length > 0
          ? `
        <div class="demo-tablewrap" style="margin-top:16px;">
          <table class="demo-table">
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
        </div>
        `
          : ""
      }

      <div class="demo-actions" style="margin-top:16px;">
        <a class="demo-btn ghost" href="/wizard/company">TERUG</a>
        ${
          employees.length >= 2
            ? `<a class="demo-btn primary" href="/wizard/reference">VOLGENDE</a>`
            : `<button class="demo-btn primary" type="button" disabled>VOLGENDE</button>`
        }
      </div>
      `
    )
  );
});

router.post("/wizard/employees", async (req, res) => {
  const company = await getCompany(req);
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
  const company = await getCompany(req);
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
