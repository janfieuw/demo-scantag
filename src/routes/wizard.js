const express = require("express");
const crypto = require("crypto");
const { DateTime } = require("luxon");
const { get, all, run } = require("../db");
const { layout, escapeHtml } = require("../ui/layout");

const router = express.Router();

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
        <td>
          <form method="POST" action="/wizard/employees/unbind" style="margin:0;">
            <input type="hidden" name="employee_id" value="${e.id}" />
            <button class="btn secondary" type="submit">Smartphone loskoppelen</button>
          </form>
        </td>
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
          <thead><tr><th>#</th><th>Naam</th><th>Activatiecode</th><th>Actie</th></tr></thead>
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
              ? `<a class="btn" href="/wizard/reference">Volgende</a>`
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
      return `<tr>
        <td>${idx + 1}</td>
        <td>${escapeHtml(e.display_name || "—")}</td>
        <td>
          <form method="POST" action="/wizard/reference/open" style="margin:0; display:flex; gap:10px; align-items:center;">
            <input type="hidden" name="employee_id" value="${e.id}" />
            <select name="mode" required>
              <option value="" ${mode === "" ? "selected" : ""} disabled>Kies…</option>
              <option value="ROOSTER" ${mode === "ROOSTER" ? "selected" : ""}>Rooster</option>
              <option value="KALENDER" ${mode === "KALENDER" ? "selected" : ""}>Kalender</option>
            </select>
            <button class="btn" type="submit">Vul aan</button>
          </form>
        </td>
        <td>${isOk ? "<span class=\"badge ok\">OK</span>" : "<span class=\"badge warn\">Niet ingevuld</span>"}</td>
      </tr>`;
    })
    .join("");

  return res.send(
    layout(
      "Wizard - Referentietijd",
      `<div class="card">
        <h1>3) Stel referentietijd in</h1>
        <p class="muted">
          Kies per werknemer <b>Rooster</b> of <b>Kalender</b> en klik daarna op <b>Vul aan</b>.
          Je komt na opslaan terug naar deze stap.
        </p>
        <p class="muted">Onderneming: <b>${escapeHtml(company.name)}</b></p>

        <table>
          <thead><tr><th>#</th><th>Werknemer</th><th>Instelling</th><th>Status</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>

        <div class="row" style="margin-top:14px;">
          <a class="btn secondary" href="/wizard/employees">Terug</a>
          ${
            allOk
              ? `<a class="btn" href="/wizard/qrs">Volgende</a>`
              : `<button class="btn" type="button" disabled style="opacity:.5; cursor:not-allowed;">Volgende</button>`
          }
          <form method="POST" action="/wizard/reset">
            <button class="btn secondary" type="submit">Opnieuw beginnen</button>
          </form>
        </div>
      </div>`
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
      return `<tr>
        <td><b>${weekdayLabel(dow)}</b></td>
        <td><input type="number" min="0" name="m_${dow}" placeholder="min" value="${escapeHtml(val)}" /></td>
      </tr>`;
    })
    .join("");

  return res.send(
    layout(
      "Rooster invullen",
      `<div class="card">
        <h1>Rooster invullen</h1>
        <p class="muted">Werknemer: <b>${escapeHtml(emp.display_name || "—")}</b></p>
        <p class="muted">Vul de referentietijd in (in minuten) per weekdag. Leeg of 0 = geen referentietijd op die dag.</p>

        <form method="POST" action="/wizard/reference/rooster/save">
          <input type="hidden" name="employee_id" value="${employeeId}" />
          <table>
            <thead><tr><th>Dag</th><th>Referentietijd (min)</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>

          <div class="row" style="margin-top:14px;">
            <a class="btn secondary" href="/wizard/reference">Annuleren</a>
            <button class="btn" type="submit">Opslaan</button>
          </div>
        </form>
      </div>`
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

  // PG kan DATE als Date-object teruggeven. We normaliseren altijd naar yyyy-mm-dd.
  const existingMap = new Map(
    existing.map((r) => {
      const d = r.day instanceof Date
        ? DateTime.fromJSDate(r.day, { zone: TZ }).toISODate()
        : String(r.day).slice(0, 10);
      return [d, Number(r.expected_minutes)];
    })
  );

  // Toon standaard komende 14 dagen als invullijst (sparse; lege dagen = geen referentietijd)
  // Belangrijk: we gebruiken unieke field-names per datum om parsing-bugs (arrays vs. single values) te vermijden.
  const today = DateTime.now().setZone(TZ).startOf("day");
  const days = [];
  for (let i = 0; i < 14; i++) {
    days.push(today.plus({ days: i }).toISODate());
  }

  const rows = days
    .map((d) => {
      const val = existingMap.get(d) ?? "";
      return `<tr>
        <td><code>${escapeHtml(d)}</code></td>
        <td>
          <input type="number" min="0" name="m_${escapeHtml(d)}" placeholder="min" value="${escapeHtml(val)}" />
        </td>
      </tr>`;
    })
    .join("");

  return res.send(
    layout(
      "Kalender invullen",
      `<div class="card">
        <h1>Kalender invullen</h1>
        <p class="muted">Werknemer: <b>${escapeHtml(emp.display_name || "—")}</b></p>
        <p class="muted">Vul referentietijd in per dag (in minuten). Leeg of 0 = geen referentietijd op die dag.</p>
        <p class="muted">Tip: 8u = 480 minuten.</p>

        <form method="POST" action="/wizard/reference/kalender/save">
          <input type="hidden" name="employee_id" value="${employeeId}" />

          <table>
            <thead><tr><th>Dag</th><th>Referentietijd (min)</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>

          <hr />
          <p class="muted"><b>Extra dag toevoegen</b> (optioneel)</p>
          <div class="row" style="gap:10px; align-items:end;">
            <div>
              <label class="muted">Dag</label><br/>
              <input type="date" name="extra_day" />
            </div>
            <div>
              <label class="muted">Minuten</label><br/>
              <input type="number" min="0" name="extra_minutes" placeholder="min" />
            </div>
          </div>

          <div class="row" style="margin-top:14px;">
            <a class="btn secondary" href="/wizard/reference">Annuleren</a>
            <button class="btn" type="submit">Opslaan</button>
          </div>
        </form>
      </div>`
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
  await run(`DELETE FROM employee_reference_calendar WHERE employee_id=$1`, [employeeId]);

  // We verwachten velden m_YYYY-MM-DD. Dit is robuuster dan arrays met dezelfde name.
  for (const [key, value] of Object.entries(req.body || {})) {
    if (!key.startsWith("m_")) continue;
    const day = key.slice(2);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;

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
  if (extraDay && /^\d{4}-\d{2}-\d{2}$/.test(extraDay) && Number.isFinite(extraMinutes) && extraMinutes > 0) {
    await run(
      `INSERT INTO employee_reference_calendar (employee_id, day, expected_minutes)
       VALUES ($1,$2,$3)
       ON CONFLICT (employee_id, day) DO UPDATE SET expected_minutes=EXCLUDED.expected_minutes`,
      [employeeId, extraDay, Math.floor(extraMinutes)]
    );
  }

  return res.redirect("/wizard/reference");
});

// STEP 4 — QR / ScanTag
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
