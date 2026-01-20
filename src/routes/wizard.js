const express = require("express");
const crypto = require("crypto");
const { DateTime } = require("luxon");
const { get, all, run } = require("../db");
const { layoutDemo, escapeHtml } = require("../ui/layout");

const router = express.Router();

// Wizard en referentietijd werken in Belgische tijd
const TZ = "Europe/Brussels";

// --------------------------
// GATE: account vóór wizard
// --------------------------
router.use((req, res, next) => {
  if (req.path === "/wizard/reset") return next();

  const hasDemo = req.cookies && req.cookies.demo_account === "1";
  if (!hasDemo) return res.redirect("/demo/account");

  return next();
});

// --------------------------
// Helpers
// --------------------------
async function getCompany() {
  return await get(`SELECT id, name FROM companies ORDER BY id LIMIT 1`);
}

async function getEmployees(companyId) {
  return await all(
    `SELECT id, display_name, scan_code, reference_mode
     FROM employees
     WHERE company_id = $1
     ORDER BY id`,
    [companyId]
  );
}

async function getEmployee(companyId, employeeId) {
  return await get(
    `SELECT id, company_id, display_name, scan_code, reference_mode
     FROM employees
     WHERE id=$1 AND company_id=$2
     LIMIT 1`,
    [employeeId, companyId]
  );
}

async function getScantag(companyId) {
  return await get(
    `SELECT id, name FROM scantags WHERE company_id = $1 ORDER BY id LIMIT 1`,
    [companyId]
  );
}

function weekdayLabel(dow) {
  return (
    {
      1: "ma",
      2: "di",
      3: "wo",
      4: "do",
      5: "vr",
      6: "za",
      7: "zo",
    }[dow] || String(dow)
  );
}

function generateScanCode() {
  return crypto.randomBytes(7).toString("base64url");
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

// --------------------------
// Reset: alles leeg
// --------------------------
router.post("/wizard/reset", async (req, res) => {
  await run(`DELETE FROM scan_events`);
  await run(`DELETE FROM device_bindings`);
  await run(`DELETE FROM employee_reference_calendar`);
  await run(`DELETE FROM employee_reference_pattern`);
  await run(`DELETE FROM scantags`);
  await run(`DELETE FROM employees`);
  await run(`DELETE FROM companies`);

  res.redirect("/wizard/company");
});

// Smartphone loskoppelen (binding verwijderen) voor 1 werknemer
router.post("/wizard/employees/unbind", async (req, res) => {
  const company = await getCompany();
  if (!company) return res.redirect("/wizard/company");

  const employeeId = Number(req.body.employee_id);
  if (!employeeId) return res.redirect("/wizard/employees");

  const emp = await get(
    `SELECT id FROM employees WHERE id = $1 AND company_id = $2 LIMIT 1`,
    [employeeId, company.id]
  );
  if (!emp) return res.redirect("/wizard/employees");

  await run(`DELETE FROM device_bindings WHERE employee_id = $1`, [employeeId]);

  return res.redirect("/wizard/employees");
});

// --------------------------
// STEP 1 — Onderneming
// --------------------------
router.get("/wizard/company", async (req, res) => {
  const company = await getCompany();

  if (company) {
    return res.send(
      layoutDemo(
        "DEMO — STAP 1",
        `
          <div class="demo-kicker">DEMO UITTESTEN — IN 3 STAPPEN</div>
          <h1 class="demo-title">STAP 1.</h1>
          <p class="demo-lead">Vul de naam van jouw onderneming in.</p>

          <p class="demo-muted">Onderneming: <b>${escapeHtml(company.name)}</b></p>

          <div class="demo-actions">
            <a class="demo-btn primary" href="/wizard/employees">VOLGENDE</a>

            <form method="POST" action="/wizard/reset" style="margin:0;">
              <button class="demo-btn secondary" type="submit">RESET</button>
            </form>
          </div>

          <div class="demo-footer">
            <div class="demo-brand">PUNCTOO</div>
            <div class="demo-sub">PUNCTOO Demo</div>
            <div class="demo-sub">ScanTag + referentietijd (rooster/kalender)</div>
          </div>
        `
      )
    );
  }

  // GEEN form-in-form: reset-form staat NA het hoofd-formulier
  return res.send(
    layoutDemo(
      "DEMO — STAP 1",
      `
        <div class="demo-kicker">DEMO UITTESTEN — IN 3 STAPPEN</div>
        <h1 class="demo-title">STAP 1.</h1>
        <p class="demo-lead">Vul de naam van jouw onderneming in.</p>

        <form class="demo-form" method="POST" action="/wizard/company">
          <label class="demo-label" for="name">Onderneming</label>
          <input class="demo-input" id="name" name="name" placeholder="bv. BEDRIJF VANDENAVENNE" required />

          <div class="demo-actions">
            <button class="demo-btn primary" type="submit">VOLGENDE</button>
          </div>
        </form>

        <div class="demo-actions" style="margin-top:12px;">
          <form method="POST" action="/wizard/reset" style="margin:0;">
            <button class="demo-btn secondary" type="submit">RESET</button>
          </form>
        </div>

        <div class="demo-footer">
          <div class="demo-brand">PUNCTOO</div>
          <div class="demo-sub">PUNCTOO Demo</div>
          <div class="demo-sub">ScanTag + referentietijd (rooster/kalender)</div>
        </div>
      `
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

  await run(`INSERT INTO scantags (company_id, name) VALUES ($1,$2)`, [
    inserted.id,
    "ScanTag",
  ]);

  return res.redirect("/wizard/company");
});

// --------------------------
// STEP 2 — Werknemers + activatiecode
// --------------------------
router.get("/wizard/employees", async (req, res) => {
  const company = await getCompany();
  if (!company) return res.redirect("/wizard/company");

  const employees = await getEmployees(company.id);
  const canAdd = employees.length < 2;

  const listRows = employees
    .map(
      (e, i) => `
        <tr>
          <td>${i + 1}</td>
          <td>${escapeHtml(e.display_name)}</td>
          <td><code>${escapeHtml(e.scan_code)}</code></td>
          <td>
            <form method="POST" action="/wizard/employees/unbind" style="margin:0;">
              <input type="hidden" name="employee_id" value="${e.id}" />
              <button class="demo-btn ghost" type="submit">Smartphone loskoppelen</button>
            </form>
          </td>
        </tr>
      `
    )
    .join("");

  const addForm = canAdd
    ? `
      <form class="demo-form" method="POST" action="/wizard/employees/add" style="margin-top:16px;">
        <label class="demo-label" for="display_name">Naam werknemer (${employees.length + 1}/2)</label>
        <input class="demo-input" id="display_name" name="display_name" placeholder="bv. JAN" required />
        <div class="demo-actions">
          <button class="demo-btn primary" type="submit">TOEVOEGEN</button>
        </div>
      </form>
    `
    : `<p class="demo-muted" style="margin-top:14px;">✅ 2 werknemers toegevoegd.</p>`;

  const nextBtn =
    employees.length === 2
      ? `<a class="demo-btn primary" href="/wizard/reference">VOLGENDE</a>`
      : `<button class="demo-btn primary" type="button" disabled>VOLGENDE</button>`;

  return res.send(
    layoutDemo(
      "DEMO — STAP 2",
      `
        <div class="demo-kicker">DEMO UITTESTEN — IN 3 STAPPEN</div>
        <h1 class="demo-title">STAP 2.</h1>

        <p class="demo-lead">
          Voeg twee werknemers toe. Na toevoegen wordt automatisch een <b>activatiecode</b> gegenereerd.
        </p>

        <p class="demo-muted">Onderneming: <b>${escapeHtml(company.name)}</b></p>

        <div class="demo-tablewrap">
          <table class="demo-table">
            <thead>
              <tr><th>#</th><th>Werknemer</th><th>Activatiecode</th><th>Actie</th></tr>
            </thead>
            <tbody>${listRows}</tbody>
          </table>
        </div>

        ${addForm}

        <div class="demo-actions" style="margin-top:18px;">
          <a class="demo-btn ghost" href="/wizard/company">TERUG</a>
          ${nextBtn}
          <form method="POST" action="/wizard/reset" style="margin:0;">
            <button class="demo-btn secondary" type="submit">RESET</button>
          </form>
        </div>

        <div class="demo-footer">
          <div class="demo-brand">PUNCTOO</div>
          <div class="demo-sub">PUNCTOO Demo</div>
          <div class="demo-sub">ScanTag + referentietijd (rooster/kalender)</div>
        </div>
      `
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

// --------------------------
// STEP 3 — Referentietijd (ROOSTER/KALENDER)
// --------------------------
async function isEmployeeReferenceOk(employeeId) {
  const modeRow = await get(`SELECT reference_mode FROM employees WHERE id=$1`, [
    employeeId,
  ]);
  const mode = modeRow?.reference_mode || null;

  if (mode === "ROOSTER") {
    const r = await get(
      `SELECT 1 FROM employee_reference_pattern
       WHERE employee_id=$1 AND expected_minutes > 0
       LIMIT 1`,
      [employeeId]
    );
    return !!r;
  }

  if (mode === "KALENDER") {
    const r = await get(
      `SELECT 1 FROM employee_reference_calendar
       WHERE employee_id=$1 AND expected_minutes > 0
       LIMIT 1`,
      [employeeId]
    );
    return !!r;
  }

  return false;
}

router.get("/wizard/reference", async (req, res) => {
  const company = await getCompany();
  if (!company) return res.redirect("/wizard/company");

  const employees = await getEmployees(company.id);
  if (employees.length < 2) return res.redirect("/wizard/employees");

  const okMap = new Map();
  for (const e of employees) {
    okMap.set(e.id, await isEmployeeReferenceOk(e.id));
  }
  const allOk = employees.every((e) => okMap.get(e.id) === true);

  const rows = employees
    .map((e, idx) => {
      const mode = e.reference_mode || "";
      const isOk = okMap.get(e.id) === true;

      return `
        <tr>
          <td>${idx + 1}</td>
          <td>${escapeHtml(e.display_name || "—")}</td>
          <td>
            <form method="POST" action="/wizard/reference/open" style="display:flex; gap:10px; align-items:center; margin:0;">
              <input type="hidden" name="employee_id" value="${e.id}" />
              <select class="demo-select" name="mode" required>
                <option value="" ${mode === "" ? "selected" : ""} disabled>Kies…</option>
                <option value="ROOSTER" ${mode === "ROOSTER" ? "selected" : ""}>Rooster</option>
                <option value="KALENDER" ${mode === "KALENDER" ? "selected" : ""}>Kalender</option>
              </select>
              <button class="demo-btn primary" type="submit">VUL AAN</button>
            </form>
          </td>
          <td>
            ${
              isOk
                ? `<span class="demo-badge ok">OK</span>`
                : `<span class="demo-badge warn">Niet ingevuld</span>`
            }
          </td>
        </tr>
      `;
    })
    .join("");

  const nextBtn = allOk
    ? `<a class="demo-btn primary" href="/wizard/qrs">VOLGENDE</a>`
    : `<button class="demo-btn primary" type="button" disabled>VOLGENDE</button>`;

  return res.send(
    layoutDemo(
      "DEMO — STAP 3",
      `
        <div class="demo-kicker">DEMO UITTESTEN — IN 3 STAPPEN</div>
        <h1 class="demo-title">STAP 3.</h1>

        <p class="demo-lead">
          Kies per werknemer <b>Rooster</b> of <b>Kalender</b> en klik daarna op <b>Vul aan</b>.
          Je komt na opslaan terug naar deze stap.
        </p>

        <p class="demo-muted">Onderneming: <b>${escapeHtml(company.name)}</b></p>

        <div class="demo-tablewrap">
          <table class="demo-table">
            <thead><tr><th>#</th><th>Werknemer</th><th>Instelling</th><th>Status</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>

        <div class="demo-actions" style="margin-top:18px;">
          <a class="demo-btn ghost" href="/wizard/employees">TERUG</a>
          ${nextBtn}
          <form method="POST" action="/wizard/reset" style="margin:0;">
            <button class="demo-btn secondary" type="submit">RESET</button>
          </form>
        </div>

        <div class="demo-footer">
          <div class="demo-brand">PUNCTOO</div>
          <div class="demo-sub">PUNCTOO Demo</div>
          <div class="demo-sub">ScanTag + referentietijd (rooster/kalender)</div>
        </div>
      `
    )
  );
});

router.post("/wizard/reference/open", async (req, res) => {
  const company = await getCompany();
  if (!company) return res.redirect("/wizard/company");

  const employeeId = Number(req.body.employee_id || 0);
  const mode = String(req.body.mode || "").trim().toUpperCase();

  if (!employeeId || (mode !== "ROOSTER" && mode !== "KALENDER")) {
    return res.redirect("/wizard/reference");
  }

  const emp = await getEmployee(company.id, employeeId);
  if (!emp) return res.redirect("/wizard/reference");

  await run(`UPDATE employees SET reference_mode=$1 WHERE id=$2`, [
    mode,
    employeeId,
  ]);

  if (mode === "ROOSTER") {
    return res.redirect(`/wizard/reference/rooster?employeeId=${employeeId}`);
  }
  return res.redirect(`/wizard/reference/kalender?employeeId=${employeeId}`);
});

// --------- ROOSTER ---------
router.get("/wizard/reference/rooster", async (req, res) => {
  const company = await getCompany();
  if (!company) return res.redirect("/wizard/company");

  const employeeId = Number(req.query.employeeId || 0);
  if (!employeeId) return res.redirect("/wizard/reference");

  const emp = await getEmployee(company.id, employeeId);
  if (!emp) return res.redirect("/wizard/reference");

  const existing = await all(
    `SELECT weekday, expected_minutes
     FROM employee_reference_pattern
     WHERE employee_id=$1
     ORDER BY weekday ASC`,
    [employeeId]
  );
  const map = new Map(
    existing.map((r) => [Number(r.weekday), Number(r.expected_minutes)])
  );

  const rows = [1, 2, 3, 4, 5, 6, 7]
    .map((dow) => {
      const val = map.get(dow) ?? "";
      return `
        <tr>
          <td><b>${weekdayLabel(dow)}</b></td>
          <td><input class="demo-input" style="max-width:160px;" type="number" min="0" name="m_${dow}" placeholder="min" value="${escapeHtml(val)}" /></td>
        </tr>
      `;
    })
    .join("");

  return res.send(
    layoutDemo(
      "DEMO — PATROON",
      `
        <div class="demo-kicker">DEMO UITTESTEN — IN 3 STAPPEN</div>
        <h1 class="demo-title">PATROON.</h1>
        <p class="demo-muted">Werknemer: <b>${escapeHtml(emp.display_name || "—")}</b></p>
        <p class="demo-lead">Vul de referentietijd in (in minuten) per weekdag. Leeg of 0 = geen referentietijd op die dag.</p>

        <form class="demo-form" method="POST" action="/wizard/reference/rooster/save">
          <input type="hidden" name="employee_id" value="${employeeId}" />

          <div class="demo-tablewrap">
            <table class="demo-table">
              <thead><tr><th>Dag</th><th>Referentietijd (min)</th></tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>

          <div class="demo-actions" style="margin-top:18px;">
            <a class="demo-btn ghost" href="/wizard/reference">ANNULEREN</a>
            <button class="demo-btn primary" type="submit">OPSLAAN EN TERUG NAAR STAP 3</button>
          </div>
        </form>
      `
    )
  );
});

router.post("/wizard/reference/rooster/save", async (req, res) => {
  const company = await getCompany();
  if (!company) return res.redirect("/wizard/company");

  const employeeId = Number(req.body.employee_id || 0);
  if (!employeeId) return res.redirect("/wizard/reference");

  const emp = await getEmployee(company.id, employeeId);
  if (!emp) return res.redirect("/wizard/reference");

  await run(`UPDATE employees SET reference_mode='ROOSTER' WHERE id=$1`, [
    employeeId,
  ]);

  await run(`DELETE FROM employee_reference_pattern WHERE employee_id=$1`, [
    employeeId,
  ]);

  for (const dow of [1, 2, 3, 4, 5, 6, 7]) {
    const raw = req.body[`m_${dow}`];
    if (raw === undefined) continue;

    const minutes = Number(raw);
    if (!Number.isFinite(minutes) || minutes <= 0) continue;

    await run(
      `INSERT INTO employee_reference_pattern (employee_id, weekday, expected_minutes)
       VALUES ($1,$2,$3)
       ON CONFLICT (employee_id, weekday) DO UPDATE
       SET expected_minutes=EXCLUDED.expected_minutes`,
      [employeeId, dow, Math.floor(minutes)]
    );
  }

  return res.redirect("/wizard/reference");
});

// --------- KALENDER ---------
async function getLockedCalendarDays(employeeId) {
  const locked = await all(
    `SELECT DISTINCT (timestamp AT TIME ZONE 'Europe/Brussels')::date AS day
     FROM scan_events
     WHERE employee_id=$1
       AND direction='IN'
     ORDER BY day ASC`,
    [employeeId]
  );

  const lockedSet = new Set(
    locked.map((r) => {
      const d =
        r.day instanceof Date
          ? DateTime.fromJSDate(r.day, { zone: TZ }).toISODate()
          : String(r.day).slice(0, 10);
      return d;
    })
  );

  return lockedSet;
}

router.get("/wizard/reference/kalender", async (req, res) => {
  const company = await getCompany();
  if (!company) return res.redirect("/wizard/company");

  const employeeId = Number(req.query.employeeId || 0);
  if (!employeeId) return res.redirect("/wizard/reference");

  const emp = await getEmployee(company.id, employeeId);
  if (!emp) return res.redirect("/wizard/reference");

  const lockedSet = await getLockedCalendarDays(employeeId);

  const existing = await all(
    `SELECT day, expected_minutes
     FROM employee_reference_calendar
     WHERE employee_id=$1
     ORDER BY day ASC`,
    [employeeId]
  );

  const existingMap = new Map(
    existing.map((r) => {
      const d =
        r.day instanceof Date
          ? DateTime.fromJSDate(r.day, { zone: TZ }).toISODate()
          : String(r.day).slice(0, 10);
      return [d, Number(r.expected_minutes)];
    })
  );

  const today = DateTime.now().setZone(TZ).startOf("day");
  const days = [];
  for (let i = 0; i < 15; i++) {
    days.push(today.plus({ days: i }).toISODate());
  }

  const rows = days
    .map((d) => {
      const val = existingMap.get(d) ?? "";
      const isLocked = lockedSet.has(d);

      return `
        <tr>
          <td><code>${escapeHtml(d)}</code></td>
          <td style="display:flex; gap:10px; align-items:center;">
            <input class="demo-input" style="max-width:160px;"
              type="number" min="0"
              name="m_${escapeHtml(d)}"
              placeholder="min"
              value="${escapeHtml(val)}"
              ${isLocked ? "disabled" : ""} />
            ${isLocked ? `<span class="demo-badge warn">LOCKED</span>` : ``}
          </td>
        </tr>
      `;
    })
    .join("");

  return res.send(
    layoutDemo(
      "DEMO — KALENDER",
      `
        <div class="demo-kicker">DEMO UITTESTEN — IN 3 STAPPEN</div>
        <h1 class="demo-title">KALENDER.</h1>
        <p class="demo-muted">Werknemer: <b>${escapeHtml(emp.display_name || "—")}</b></p>

        <p class="demo-lead">
          Je hoeft enkel de dagen in te vullen waarop je zeker een scan-IN zal hebben.
          Leeg of 0 = geen referentietijd op die dag.
        </p>
        <p class="demo-muted">De demo is beperkt tot de volgende 15 dagen.</p>
        <p class="demo-muted">
          <b>Opgelet:</b> dagen waarop al een <b>IN-scan</b> is geregistreerd kunnen niet meer aangepast worden.
        </p>

        <form class="demo-form" method="POST" action="/wizard/reference/kalender/save">
          <input type="hidden" name="employee_id" value="${employeeId}" />

          <div class="demo-tablewrap">
            <table class="demo-table">
              <thead><tr><th>Dag</th><th>Referentietijd (min)</th></tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>

          <hr style="margin:18px 0;" />

          <p class="demo-muted"><b>Extra dag toevoegen</b> (optioneel)</p>
          <div class="demo-row" style="gap:10px; align-items:end;">
            <div>
              <label class="demo-label">Dag</label>
              <input class="demo-input" type="date" name="extra_day" />
            </div>
            <div>
              <label class="demo-label">Minuten</label>
              <input class="demo-input" type="number" min="0" name="extra_minutes" placeholder="min" />
            </div>
          </div>

          <div class="demo-actions" style="margin-top:18px;">
            <a class="demo-btn ghost" href="/wizard/reference">ANNULEREN</a>
            <button class="demo-btn primary" type="submit">OPSLAAN EN TERUG NAAR STAP 3</button>
          </div>
        </form>
      `
    )
  );
});

router.post("/wizard/reference/kalender/save", async (req, res) => {
  const company = await getCompany();
  if (!company) return res.redirect("/wizard/company");

  const employeeId = Number(req.body.employee_id || 0);
  if (!employeeId) return res.redirect("/wizard/reference");

  const emp = await getEmployee(company.id, employeeId);
  if (!emp) return res.redirect("/wizard/reference");

  await run(`UPDATE employees SET reference_mode='KALENDER' WHERE id=$1`, [
    employeeId,
  ]);

  await run(
    `
    DELETE FROM employee_reference_calendar
    WHERE employee_id=$1
      AND day NOT IN (
        SELECT DISTINCT (timestamp AT TIME ZONE 'Europe/Brussels')::date
        FROM scan_events
        WHERE employee_id=$1 AND direction='IN'
      )
    `,
    [employeeId]
  );

  const lockedSet = await getLockedCalendarDays(employeeId);

  for (const [key, value] of Object.entries(req.body || {})) {
    if (!key.startsWith("m_")) continue;

    const day = key.slice(2);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    if (lockedSet.has(day)) continue;

    const minutes = Number(value);
    if (!Number.isFinite(minutes) || minutes <= 0) continue;

    await run(
      `INSERT INTO employee_reference_calendar (employee_id, day, expected_minutes)
       VALUES ($1,$2,$3)
       ON CONFLICT (employee_id, day) DO UPDATE
       SET expected_minutes=EXCLUDED.expected_minutes`,
      [employeeId, day, Math.floor(minutes)]
    );
  }

  const extraDay = String(req.body.extra_day || "").slice(0, 10);
  const extraMinutes = Number(req.body.extra_minutes);

  if (
    extraDay &&
    /^\d{4}-\d{2}-\d{2}$/.test(extraDay) &&
    Number.isFinite(extraMinutes) &&
    extraMinutes > 0 &&
    !lockedSet.has(extraDay)
  ) {
    await run(
      `INSERT INTO employee_reference_calendar (employee_id, day, expected_minutes)
       VALUES ($1,$2,$3)
       ON CONFLICT (employee_id, day) DO UPDATE
       SET expected_minutes=EXCLUDED.expected_minutes`,
      [employeeId, extraDay, Math.floor(extraMinutes)]
    );
  }

  return res.redirect("/wizard/reference");
});

// --------------------------
// STEP 4 — QR / ScanTag
// --------------------------
router.get("/wizard/qrs", async (req, res) => {
  const company = await getCompany();
  if (!company) return res.redirect("/wizard/company");

  const employees = await getEmployees(company.id);
  if (employees.length < 2) return res.redirect("/wizard/employees");

  for (const e of employees) {
    const ok = await isEmployeeReferenceOk(e.id);
    if (!ok) return res.redirect("/wizard/reference");
  }

  const tag = await getScantag(company.id);
  if (!tag) {
    await run(`INSERT INTO scantags (company_id, name) VALUES ($1,$2)`, [
      company.id,
      "ScanTag",
    ]);
  }

  return res.redirect("/tags");
});

module.exports = router;
