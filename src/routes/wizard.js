const express = require("express");
const crypto = require("crypto");
const { DateTime } = require("luxon");
const { get, all, run } = require("../db");
const { layoutDemo, escapeHtml } = require("../ui/layout");

const router = express.Router();

// Wizard en referentietijd werken in Belgische tijd
const TZ = "Europe/Brussels";

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

function weekdayLabel(dow) {
  // Luxon: 1=Monday ... 7=Sunday
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

function demoPage(title, kicker, heading, sub, innerHtml) {
  const left = `
    <div class="demo-kicker">${escapeHtml(kicker)}</div>
    <h1 class="demo-title">${escapeHtml(heading)}</h1>
    ${sub ? `<p class="demo-sub">${sub}</p>` : ""}
    ${innerHtml}
  `;
  return layoutDemo(title, left, {
    rightTitle: "PUNCTOO Demo",
    rightSubtitle: "ScanTag + referentietijd (rooster/kalender)",
  });
}

// Reset: alles leeg
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

  // Safety: werknemer moet tot dit bedrijf behoren
  const emp = await get(
    `SELECT id FROM employees WHERE id = $1 AND company_id = $2 LIMIT 1`,
    [employeeId, company.id]
  );
  if (!emp) return res.redirect("/wizard/employees");

  // Loskoppelen = device binding verwijderen
  await run(`DELETE FROM device_bindings WHERE employee_id = $1`, [employeeId]);

  return res.redirect("/wizard/employees");
});

// STEP 1
router.get("/wizard/company", async (req, res) => {
  const company = await getCompany();

  if (company) {
    return res.send(
      demoPage(
        "DEMO – Stap 1",
        "DEMO UITTESTEN – IN 3 STAPPEN",
        "STAP 1.",
        `Vul de naam van jouw onderneming in.`,
        `
        <div class="demo-panel">
          <p class="demo-sub" style="margin:0;">
            Onderneming: <b>${escapeHtml(company.name)}</b>
          </p>
        </div>

        <div class="demo-actions">
          <a class="btn secondary" href="/wizard/reset" onclick="return false;">Opnieuw beginnen</a>
          <a class="btn primary" href="/wizard/employees">VOLGENDE</a>
        </div>

        <form method="POST" action="/wizard/reset" style="margin-top:10px;">
          <button class="btn secondary" type="submit">Opnieuw beginnen</button>
        </form>
        `
      )
    );
  }

  return res.send(
    demoPage(
      "DEMO – Stap 1",
      "DEMO UITTESTEN – IN 3 STAPPEN",
      "STAP 1.",
      `Vul de naam van jouw onderneming in.`,
      `
      <div class="demo-panel">
        <form method="POST" action="/wizard/company">
          <div class="demo-field">
            <label for="name">NAAM ONDERNEMING</label>
            <input id="name" name="name" placeholder="BV. RE:SOURCE" required />
          </div>
          <div class="demo-actions">
            <button class="btn primary" type="submit">VOLGENDE</button>
          </div>
        </form>
      </div>

      <form method="POST" action="/wizard/reset" style="margin-top:10px;">
        <button class="btn secondary" type="submit">Opnieuw beginnen</button>
      </form>
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

  await run(
    `INSERT INTO scantags (company_id, name) VALUES ($1,$2)`,
    [inserted.id, "ScanTag"]
  );

  return res.redirect("/wizard/employees");
});

// STEP 2
router.get("/wizard/employees", async (req, res) => {
  const company = await getCompany();
  if (!company) return res.redirect("/wizard/company");

  const employees = await getEmployees(company.id);
  const canAdd = employees.length < 2;

  const list = employees
    .map(
      (e, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${escapeHtml(e.display_name)}</td>
        <td><b>${escapeHtml(e.scan_code)}</b></td>
        <td>
          <form method="POST" action="/wizard/employees/unbind" style="margin:0;">
            <input type="hidden" name="employee_id" value="${e.id}" />
            <button class="btn secondary" type="submit">Smartphone loskoppelen</button>
          </form>
        </td>
      </tr>`
    )
    .join("");

  const addForm = canAdd
    ? `
      <div class="demo-panel">
        <form method="POST" action="/wizard/employees/add">
          <div class="demo-field">
            <label for="display_name">WERKNEMER ${employees.length + 1} (VAN 2)</label>
            <input id="display_name" name="display_name" placeholder="BV. JAN" required />
          </div>
          <div class="demo-actions">
            <button class="btn primary" type="submit">TOEVOEGEN</button>
          </div>
        </form>
      </div>
    `
    : `<p class="demo-sub">✅ 2 werknemers toegevoegd.</p>`;

  const nextButton = employees.length === 2
    ? `<a class="btn primary" href="/wizard/reference">VOLGENDE</a>`
    : `<button class="btn primary" type="button" disabled style="opacity:.5; cursor:not-allowed;">VOLGENDE</button>`;

  return res.send(
    demoPage(
      "DEMO – Stap 2",
      "DEMO UITTESTEN – IN 3 STAPPEN",
      "STAP 2.",
      `Voeg 2 werknemers toe. PUNCTOO maakt automatisch een <b>activatiecode</b> aan per werknemer.`,
      `
      <div class="demo-panel">
        <p class="demo-sub" style="margin-top:0;">Onderneming: <b>${escapeHtml(company.name)}</b></p>
        <table class="demo-table">
          <thead>
            <tr><th>#</th><th>Werknemer</th><th>Activatiecode</th><th>Actie</th></tr>
          </thead>
          <tbody>${list || `<tr><td colspan="4">Nog geen werknemers.</td></tr>`}</tbody>
        </table>
      </div>

      ${addForm}

      <div class="demo-actions">
        <a class="btn secondary" href="/wizard/company">TERUG</a>
        ${nextButton}
      </div>

      <form method="POST" action="/wizard/reset" style="margin-top:10px;">
        <button class="btn secondary" type="submit">Opnieuw beginnen</button>
      </form>
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

// STEP 3 — Referentietijd (ROOSTER of KALENDER)

async function isEmployeeReferenceOk(employeeId) {
  const modeRow = await get(`SELECT reference_mode FROM employees WHERE id=$1`, [employeeId]);
  const mode = modeRow?.reference_mode || null;
  if (mode === "ROOSTER") {
    const r = await get(
      `SELECT 1 FROM employee_reference_pattern WHERE employee_id=$1 AND expected_minutes > 0 LIMIT 1`,
      [employeeId]
    );
    return !!r;
  }
  if (mode === "KALENDER") {
    const r = await get(
      `SELECT 1 FROM employee_reference_calendar WHERE employee_id=$1 AND expected_minutes > 0 LIMIT 1`,
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
        <td><b>${escapeHtml(e.display_name || "—")}</b></td>
        <td>
          <form method="POST" action="/wizard/reference/open" style="margin:0; display:flex; gap:10px; align-items:center;">
            <input type="hidden" name="employee_id" value="${e.id}" />
            <select name="mode" required>
              <option value="" ${mode === "" ? "selected" : ""} disabled>Kies…</option>
              <option value="ROOSTER" ${mode === "ROOSTER" ? "selected" : ""}>Rooster</option>
              <option value="KALENDER" ${mode === "KALENDER" ? "selected" : ""}>Kalender</option>
            </select>
            <button class="btn primary" type="submit">VUL AAN</button>
          </form>
        </td>
        <td>${isOk ? '<span class="demo-badge ok">OK</span>' : '<span class="demo-badge warn">Niet ingevuld</span>'}</td>
      </tr>`;
    })
    .join("");

  const nextButton = allOk
    ? `<a class="btn primary" href="/wizard/done">VOLGENDE</a>`
    : `<button class="btn primary" type="button" disabled style="opacity:.5; cursor:not-allowed;">VOLGENDE</button>`;

  return res.send(
    demoPage(
      "DEMO – Stap 3",
      "DEMO UITTESTEN – IN 3 STAPPEN",
      "STAP 3.",
      `Stel de referentietijd in per werknemer. Kies <b>Rooster</b> of <b>Kalender</b> en klik op <b>Vul aan</b>.`,
      `
      <div class="demo-panel">
        <p class="demo-sub" style="margin-top:0;">Onderneming: <b>${escapeHtml(company.name)}</b></p>
        <table class="demo-table">
          <thead><tr><th>#</th><th>Werknemer</th><th>Instelling</th><th>Status</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>

      <div class="demo-actions">
        <a class="btn secondary" href="/wizard/employees">TERUG</a>
        ${nextButton}
      </div>

      <form method="POST" action="/wizard/reset" style="margin-top:10px;">
        <button class="btn secondary" type="submit">Opnieuw beginnen</button>
      </form>
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

  await run(`UPDATE employees SET reference_mode=$1 WHERE id=$2`, [mode, employeeId]);

  if (mode === "ROOSTER") {
    return res.redirect(`/wizard/reference/rooster?employeeId=${employeeId}`);
  }
  return res.redirect(`/wizard/reference/kalender?employeeId=${employeeId}`);
});

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
  const map = new Map(existing.map((r) => [Number(r.weekday), Number(r.expected_minutes)]));

  const rows = [1, 2, 3, 4, 5, 6, 7]
    .map((dow) => {
      const val = map.get(dow) ?? "";
      return `
        <tr>
          <td><b>${weekdayLabel(dow)}</b></td>
          <td><input type="number" min="0" name="m_${dow}" placeholder="min" value="${escapeHtml(val)}" /></td>
        </tr>`;
    })
    .join("");

  return res.send(
    demoPage(
      "Rooster invullen",
      "REFERENTIETIJD",
      "PATROON",
      `Werknemer: <b>${escapeHtml(emp.display_name || "—")}</b><br/>Vul de referentietijd in (minuten) per weekdag. Leeg of 0 = geen referentietijd.`,
      `
      <div class="demo-panel">
        <form method="POST" action="/wizard/reference/rooster/save">
          <input type="hidden" name="employee_id" value="${employeeId}" />
          <table class="demo-table">
            <thead><tr><th>Dag</th><th>Referentietijd (min)</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>

          <div class="demo-actions">
            <a class="btn secondary" href="/wizard/reference">TERUG NAAR STAP 3</a>
            <button class="btn primary" type="submit">OPSLAAN</button>
          </div>
        </form>
      </div>
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

  await run(`UPDATE employees SET reference_mode='ROOSTER' WHERE id=$1`, [employeeId]);
  await run(`DELETE FROM employee_reference_pattern WHERE employee_id=$1`, [employeeId]);

  for (const dow of [1, 2, 3, 4, 5, 6, 7]) {
    const raw = req.body[`m_${dow}`];
    if (raw === undefined) continue;
    const minutes = Number(raw);
    if (!Number.isFinite(minutes) || minutes <= 0) continue;

    await run(
      `INSERT INTO employee_reference_pattern (employee_id, weekday, expected_minutes)
       VALUES ($1,$2,$3)
       ON CONFLICT (employee_id, weekday) DO UPDATE SET expected_minutes=EXCLUDED.expected_minutes`,
      [employeeId, dow, Math.floor(minutes)]
    );
  }

  return res.redirect("/wizard/reference");
});

router.get("/wizard/reference/kalender", async (req, res) => {
  const company = await getCompany();
  if (!company) return res.redirect("/wizard/company");

  const employeeId = Number(req.query.employeeId || 0);
  if (!employeeId) return res.redirect("/wizard/reference");

  const emp = await getEmployee(company.id, employeeId);
  if (!emp) return res.redirect("/wizard/reference");

  const existing = await all(
    `SELECT day, expected_minutes
     FROM employee_reference_calendar
     WHERE employee_id=$1
     ORDER BY day ASC`,
    [employeeId]
  );

  // Locked days: vanaf er een IN-scan is, kan referentie van die dag niet meer aangepast worden.
  const lockedRows = await all(
    `SELECT DISTINCT (timestamp AT TIME ZONE 'Europe/Brussels')::date AS day
     FROM scan_events
     WHERE employee_id=$1 AND direction='IN'`,
    [employeeId]
  );
  const lockedSet = new Set(
    lockedRows.map((r) => {
      if (r.day instanceof Date) {
        return DateTime.fromJSDate(r.day, { zone: TZ }).toISODate();
      }
      return String(r.day).slice(0, 10);
    })
  );

  // PG kan DATE als Date-object teruggeven. We normaliseren altijd naar yyyy-mm-dd.
  const existingMap = new Map(
    existing.map((r) => {
      const d = r.day instanceof Date
        ? DateTime.fromJSDate(r.day, { zone: TZ }).toISODate()
        : String(r.day).slice(0, 10);
      return [d, Number(r.expected_minutes)];
    })
  );

  // Toon demo beperkt: komende 15 dagen
  const today = DateTime.now().setZone(TZ).startOf("day");
  const days = [];
  for (let i = 0; i < 15; i++) {
    days.push(today.plus({ days: i }).toISODate());
  }

  const rows = days
    .map((d) => {
      const val = existingMap.get(d) ?? "";
      const locked = lockedSet.has(d);
      return `
        <tr>
          <td><b>${escapeHtml(DateTime.fromISO(d).setZone(TZ).toFormat("cccc"))}</b><br/><code>${escapeHtml(d)}</code></td>
          <td>
            <input type="number" min="0" name="m_${escapeHtml(d)}" placeholder="min" value="${escapeHtml(val)}" ${locked ? "disabled" : ""} />
            ${locked ? '<div style="margin-top:6px;"><span class="demo-badge warn">LOCKED</span></div>' : ""}
          </td>
        </tr>`;
    })
    .join("");

  return res.send(
    demoPage(
      "Kalender invullen",
      "REFERENTIETIJD",
      "KALENDER",
      `Werknemer: <b>${escapeHtml(emp.display_name || "—")}</b><br/>
       Je hoeft enkel de dagen in te vullen waarop je zeker een scan-IN zal hebben.<br/>
       <b>Opgelet:</b> zodra er een IN-scan is op een dag, kan de referentieduur van die dag niet meer aangepast worden.`,
      `
      <div class="demo-panel">
        <p class="demo-sub" style="margin-top:0;">De demo is beperkt tot de volgende 15 dagen.</p>
        <form method="POST" action="/wizard/reference/kalender/save">
          <input type="hidden" name="employee_id" value="${employeeId}" />

          <table class="demo-table">
            <thead><tr><th>Dag</th><th>Referentietijd (min)</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>

          <div class="demo-panel" style="margin-top:12px;">
            <p class="demo-sub" style="margin-top:0;"><b>Extra dag toevoegen</b> (optioneel)</p>
            <div class="demo-row">
              <div class="demo-field">
                <label>Dag</label>
                <input type="date" name="extra_day" />
              </div>
              <div class="demo-field">
                <label>Minuten</label>
                <input type="number" min="0" name="extra_minutes" placeholder="min" />
              </div>
            </div>
          </div>

          <div class="demo-actions">
            <a class="btn secondary" href="/wizard/reference">TERUG NAAR STAP 3</a>
            <button class="btn primary" type="submit">OPSLAAN</button>
          </div>
        </form>
      </div>
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

  await run(`UPDATE employees SET reference_mode='KALENDER' WHERE id=$1`, [employeeId]);

  // Locked days: dagen met een IN-scan mogen niet aangepast/gewist worden.
  const lockedRows = await all(
    `SELECT DISTINCT (timestamp AT TIME ZONE 'Europe/Brussels')::date AS day
     FROM scan_events
     WHERE employee_id=$1 AND direction='IN'`,
    [employeeId]
  );
  const lockedSet = new Set(
    lockedRows.map((r) => {
      if (r.day instanceof Date) {
        return DateTime.fromJSDate(r.day, { zone: TZ }).toISODate();
      }
      return String(r.day).slice(0, 10);
    })
  );

  // Verwijder enkel niet-locked dagen (sparse kalender)
  await run(
    `DELETE FROM employee_reference_calendar
     WHERE employee_id=$1
       AND day NOT IN (
         SELECT DISTINCT (timestamp AT TIME ZONE 'Europe/Brussels')::date
         FROM scan_events
         WHERE employee_id=$1 AND direction='IN'
       )`,
    [employeeId]
  );

  // We verwachten velden m_YYYY-MM-DD. Dit is robuuster dan arrays met dezelfde name.
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
       ON CONFLICT (employee_id, day) DO UPDATE SET expected_minutes=EXCLUDED.expected_minutes`,
      [employeeId, day, Math.floor(minutes)]
    );
  }

  // Optioneel: extra dag toevoegen
  const extraDay = String(req.body.extra_day || "").slice(0, 10);
  const extraMinutes = Number(req.body.extra_minutes);
  if (
    extraDay &&
    /^\d{4}-\d{2}-\d{2}$/.test(extraDay) &&
    !lockedSet.has(extraDay) &&
    Number.isFinite(extraMinutes) &&
    extraMinutes > 0
  ) {
    await run(
      `INSERT INTO employee_reference_calendar (employee_id, day, expected_minutes)
       VALUES ($1,$2,$3)
       ON CONFLICT (employee_id, day) DO UPDATE SET expected_minutes=EXCLUDED.expected_minutes`,
      [employeeId, extraDay, Math.floor(extraMinutes)]
    );
  }

  return res.redirect("/wizard/reference");
});

// DONE
router.get("/wizard/done", async (req, res) => {
  const company = await getCompany();
  if (!company) return res.redirect("/wizard/company");
  const employees = await getEmployees(company.id);
  if (employees.length < 2) return res.redirect("/wizard/employees");
  for (const e of employees) {
    const ok = await isEmployeeReferenceOk(e.id);
    if (!ok) return res.redirect("/wizard/reference");
  }

  return res.send(
    demoPage(
      "AFGEWERKT",
      "DEMO UITTESTEN – IN 3 STAPPEN",
      "AFGEWERKT.",
      `Je demo-omgeving is klaar. Je kan nu de ScanTag bekijken.`,
      `
      <div class="demo-panel">
        <p class="demo-sub" style="margin-top:0;">Onderneming: <b>${escapeHtml(company.name)}</b></p>
        <div class="demo-actions">
          <a class="btn primary" href="/wizard/qrs">LOGIN</a>
        </div>
      </div>
      `
    )
  );
});

// STEP 4 — QR / ScanTag (na "login")
router.get("/wizard/qrs", async (req, res) => {
  const company = await getCompany();
  if (!company) return res.redirect("/wizard/company");

  const employees = await getEmployees(company.id);
  if (employees.length < 2) return res.redirect("/wizard/employees");

  // Gate: referentietijd moet voor iedereen ingevuld zijn
  for (const e of employees) {
    const ok = await isEmployeeReferenceOk(e.id);
    if (!ok) return res.redirect("/wizard/reference");
  }

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
