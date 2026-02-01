// src/routes/wizard.js
const express = require("express");
const crypto = require("crypto");
const { DateTime } = require("luxon");
const { get, all, run } = require("../db");
const { layoutDemo, escapeHtml } = require("../ui/layout");

const router = express.Router();
const TZ = "Europe/Brussels";

/* =========================
   Session helpers
   ========================= */
function getDemoSession(req) {
  return String(req.cookies?.demo_session || "").trim();
}

async function getCompany(req) {
  const sid = getDemoSession(req);
  if (!sid) return null;

  const company = await get(
    `SELECT id, name FROM companies WHERE demo_session_id = $1 ORDER BY id LIMIT 1`,
    [sid]
  );

  return company || null;
}

/* =========================
   Generic helpers
   ========================= */
function generateScanCode() {
  // demo: kort & ok
  return crypto.randomBytes(4).toString("hex");
}

function employeeLabel(e) {
  const fn = String(e.first_name || "").trim();
  const ln = String(e.last_name || "").trim();
  if (ln || fn) return `${ln} ${fn}`.trim();
  return String(e.display_name || "").trim() || `#${e.id}`;
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

/* =========================
   Data helpers
   ========================= */
async function ensureScantag(companyId) {
  const tag = await get(
    `SELECT id FROM scantags WHERE company_id=$1 ORDER BY id ASC LIMIT 1`,
    [companyId]
  );
  if (tag) return tag.id;

  const inserted = await get(
    `INSERT INTO scantags (company_id, name) VALUES ($1,$2) RETURNING id`,
    [companyId, "ScanTag"]
  );
  return inserted?.id || null;
}

async function getEmployees(companyId) {
  return await all(
    `
    SELECT id, first_name, last_name, display_name, scan_code, reference_mode
    FROM employees
    WHERE company_id=$1
    ORDER BY
      last_name ASC NULLS LAST,
      first_name ASC NULLS LAST,
      display_name ASC,
      id ASC
    `,
    [companyId]
  );
}

async function getEmployee(companyId, employeeId) {
  return await get(
    `
    SELECT id, company_id, first_name, last_name, display_name, scan_code, reference_mode
    FROM employees
    WHERE company_id=$1 AND id=$2
    LIMIT 1
    `,
    [companyId, employeeId]
  );
}

/* =========================
   STEP 1 — Company
   ========================= */
router.get("/wizard/company", async (req, res) => {
  if (!getDemoSession(req)) return res.redirect("/demo/account");

  const company = await getCompany(req);

  if (company) {
    return res.send(
      layoutDemo(
        "DEMO — STAP 1",
        `
          <div class="demo-kicker">DEMO UITTESTEN <BR> IN 5 STAPPEN</div>
          <h1 class="demo-title">STAP 2: JOUW ONDERNEMING.</h1>
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
      "DEMO — STAP 1",
      `
        <div class="demo-kicker">DEMO UITTESTEN <BR> IN 5 STAPPEN</div>
        <h1 class="demo-title">STAP 2: JOUW ONDERNEMING.</h1>
        <p class="demo-lead">Vul de naam van jouw onderneming in.</p>

        <form class="demo-form" method="POST" action="/wizard/company">
          <label class="demo-label" for="name">Onderneming</label>
          <input class="demo-input" id="name" name="name" required />

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

  const existing = await getCompany(req);
  if (existing) return res.redirect("/wizard/employees");

  const inserted = await get(
    `INSERT INTO companies (name, demo_session_id) VALUES ($1,$2) RETURNING id`,
    [name, sid]
  );

  if (inserted?.id) await ensureScantag(inserted.id);

  return res.redirect("/wizard/employees");
});

/* =========================
   STEP 2 — Employees
   ========================= */
router.get("/wizard/employees", async (req, res) => {
  const company = await getCompany(req);
  if (!company) return res.redirect("/wizard/company");

  const employees = await getEmployees(company.id);
  const canAdd = employees.length < 2;

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
      "DEMO — STAP 2",
      `
        <div class="demo-kicker">DEMO UITTESTEN <BR> IN 5 STAPPEN</div>
        <h1 class="demo-title">STAP 3: WERKNEMERS.</h1>

        <p class="demo-lead">
          Voeg twee werknemers toe. <br>Na toevoegen wordt automatisch een activatiecode gegenereerd.
          <br>(De codes vind je ook later nog terug).
        </p>

        <p class="demo-muted">Onderneming: <b>${escapeHtml(company.name)}</b></p>

        ${
          canAdd
            ? `
          <form class="demo-form" method="POST" action="/wizard/employees/add" style="margin-top:16px;">
            <label class="demo-label" for="last_name">Familienaam</label>
            <input class="demo-input" id="last_name" name="last_name" required />

            <label class="demo-label" for="first_name">Voornaam</label>
            <input class="demo-input" id="first_name" name="first_name" required />

            <div class="demo-actions">
              <button class="demo-btn primary" type="submit">TOEVOEGEN</button>
            </div>
          </form>
            `
            : `<p class="demo-muted" style="margin-top:14px;">✅ 2 werknemers toegevoegd.</p>`
        }

        <div class="demo-tablewrap scroll-x" style="margin-top:14px;">
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

        <div class="demo-actions" style="margin-top:18px;">
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

router.post("/wizard/employees/add", async (req, res) => {
  const company = await getCompany(req);
  if (!company) return res.redirect("/wizard/company");

  const employees = await getEmployees(company.id);
  if (employees.length >= 2) return res.redirect("/wizard/employees");

  const firstName = String(req.body.first_name || "").trim();
  const lastName = String(req.body.last_name || "").trim();
  if (!firstName || !lastName) return res.redirect("/wizard/employees");

  const displayName = `${lastName} ${firstName}`.trim();
  const scanCode = generateScanCode();

  await run(
    `
    INSERT INTO employees (company_id, first_name, last_name, display_name, scan_code)
    VALUES ($1,$2,$3,$4,$5)
    `,
    [company.id, firstName, lastName, displayName, scanCode]
  );

  return res.redirect("/wizard/employees");
});

/* =========================
   STEP 3 — Reference overview
   ========================= */

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
  const company = await getCompany(req);
  if (!company) return res.redirect("/wizard/company");

  const employees = await getEmployees(company.id);
  if (employees.length < 2) return res.redirect("/wizard/employees");

  const okMap = new Map();
  for (const e of employees) okMap.set(e.id, await isEmployeeReferenceOk(e.id));
  const allOk = employees.every((e) => okMap.get(e.id) === true);

  const rows = employees
    .map((e, idx) => {
      const mode = e.reference_mode || "";
      const isOk = okMap.get(e.id) === true;

      return `
        <tr>
          <td>${idx + 1}</td>
          <td>${escapeHtml(employeeLabel(e))}</td>
          <td>
            <form method="POST" action="/wizard/reference/open"
              style="display:flex; gap:10px; align-items:center; margin:0;">
              <input type="hidden" name="employee_id" value="${e.id}" />
              <select class="demo-select" name="mode" required>
                <option value="" ${mode === "" ? "selected" : ""} disabled>Kies…</option>
                <option value="ROOSTER" ${mode === "ROOSTER" ? "selected" : ""}>Rooster</option>
                <option value="KALENDER" ${mode === "KALENDER" ? "selected" : ""}>Kalender</option>
              </select>
              <button class="demo-btn primary" type="submit">VUL AAN</button>
            </form>
          </td>
          <td>${isOk ? `<span class="demo-badge ok">OK</span>` : `<span class="demo-badge warn">Niet ingevuld</span>`}</td>
        </tr>
      `;
    })
    .join("");

  return res.send(
    layoutDemo(
      "DEMO — STAP 3",
      `
        <div class="demo-kicker">DEMO UITTESTEN <BR> IN 5 STAPPEN</div>
        <h1 class="demo-title">(BELANGRIJKE) STAP 3: REFERENTIETIJDEN.</h1>

        <p class="demo-lead">
          Kies per werknemer <b>Rooster</b> of <b>Kalender</b> en klik daarna op <b>Vul aan</b>.
          Je komt na opslaan terug naar deze stap.
        </p>

        <p class="demo-muted">Onderneming: <b>${escapeHtml(company.name)}</b></p>

        <div class="demo-tablewrap scroll-x" style="margin-top:14px;">
          <table class="demo-table">
            <thead>
              <tr><th>#</th><th>Werknemer</th><th>Instelling</th><th>Status</th></tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>

        <div class="demo-actions" style="margin-top:18px;">
          <a class="demo-btn ghost" href="/wizard/employees">TERUG</a>
          ${
            allOk
              ? `<a class="demo-btn primary" href="/wizard/qrs">VOLGENDE</a>`
              : `<button class="demo-btn primary" type="button" disabled>VOLGENDE</button>`
          }
        </div>
      `
    )
  );
});

router.post("/wizard/reference/open", async (req, res) => {
  const company = await getCompany(req);
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

/* =========================
   ROOSTER (pattern)
   ========================= */

router.get("/wizard/reference/rooster", async (req, res) => {
  const company = await getCompany(req);
  if (!company) return res.redirect("/wizard/company");

  const employeeId = Number(req.query.employeeId || 0);
  if (!employeeId) return res.redirect("/wizard/reference");

  const emp = await getEmployee(company.id, employeeId);
  if (!emp) return res.redirect("/wizard/reference");

  const existing = await all(
    `
    SELECT weekday, expected_minutes
    FROM employee_reference_pattern
    WHERE employee_id=$1
    ORDER BY weekday ASC
    `,
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
          <td>
            <input class="demo-input" style="max-width:160px;"
              type="number" min="0"
              name="m_${dow}" placeholder="min"
              value="${escapeHtml(val)}" />
          </td>
        </tr>
      `;
    })
    .join("");

  return res.send(
    layoutDemo(
      "DEMO — PATROON",
      `
        <div class="demo-kicker">DEMO UITTESTEN <BR> IN 3 STAPPEN</div>
        <h1 class="demo-title">PATROON.</h1>

        <p class="demo-muted">Werknemer: <b>${escapeHtml(employeeLabel(emp))}</b></p>
        <p class="demo-lead">
          Vul de referentietijd in (in minuten) per weekdag. Leeg of 0 = geen referentietijd op die dag.
        </p>

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
            <button class="demo-btn primary" type="submit">OPSLAAN EN TERUG NAAR STAP 4</button>
          </div>
        </form>
      `
    )
  );
});

router.post("/wizard/reference/rooster/save", async (req, res) => {
  const company = await getCompany(req);
  if (!company) return res.redirect("/wizard/company");

  const employeeId = Number(req.body.employee_id || 0);
  if (!employeeId) return res.redirect("/wizard/reference");

  const emp = await getEmployee(company.id, employeeId);
  if (!emp) return res.redirect("/wizard/reference");

  await run(`UPDATE employees SET reference_mode='ROOSTER' WHERE id=$1`, [employeeId]);

  await run(`DELETE FROM employee_reference_pattern WHERE employee_id=$1`, [employeeId]);

  for (const dow of [1, 2, 3, 4, 5, 6, 7]) {
    const raw = req.body[`m_${dow}`];
    const minutes = Number(raw);
    if (!Number.isFinite(minutes) || minutes <= 0) continue;

    await run(
      `
      INSERT INTO employee_reference_pattern (employee_id, weekday, expected_minutes)
      VALUES ($1,$2,$3)
      ON CONFLICT (employee_id, weekday) DO UPDATE
      SET expected_minutes=EXCLUDED.expected_minutes
      `,
      [employeeId, dow, Math.floor(minutes)]
    );
  }

  return res.redirect("/wizard/reference");
});

/* =========================
   KALENDER (next 15 days + extra day)
   ========================= */

async function getLockedCalendarDays(employeeId) {
  // lock days where there is already an IN scan
  const locked = await all(
    `
    SELECT DISTINCT ("timestamp" AT TIME ZONE 'Europe/Brussels')::date AS day
    FROM scan_events
    WHERE employee_id=$1 AND direction='IN'
    ORDER BY day ASC
    `,
    [employeeId]
  );

  const lockedSet = new Set(
    locked.map((r) =>
      r.day instanceof Date
        ? DateTime.fromJSDate(r.day, { zone: TZ }).toISODate()
        : String(r.day).slice(0, 10)
    )
  );

  return lockedSet;
}

router.get("/wizard/reference/kalender", async (req, res) => {
  const company = await getCompany(req);
  if (!company) return res.redirect("/wizard/company");

  const employeeId = Number(req.query.employeeId || 0);
  if (!employeeId) return res.redirect("/wizard/reference");

  const emp = await getEmployee(company.id, employeeId);
  if (!emp) return res.redirect("/wizard/reference");

  const lockedSet = await getLockedCalendarDays(employeeId);

  const existing = await all(
    `
    SELECT day, expected_minutes
    FROM employee_reference_calendar
    WHERE employee_id=$1
    ORDER BY day ASC
    `,
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
  for (let i = 0; i < 15; i++) days.push(today.plus({ days: i }).toISODate());

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
        <div class="demo-kicker">DEMO UITTESTEN <BR> IN 5 STAPPEN</div>
        <h1 class="demo-title">KALENDER.</h1>

        <p class="demo-muted">Werknemer: <b>${escapeHtml(employeeLabel(emp))}</b></p>

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
            <button class="demo-btn primary" type="submit">OPSLAAN EN TERUG NAAR STAP 4</button>
          </div>
        </form>
      `
    )
  );
});

router.post("/wizard/reference/kalender/save", async (req, res) => {
  const company = await getCompany(req);
  if (!company) return res.redirect("/wizard/company");

  const employeeId = Number(req.body.employee_id || 0);
  if (!employeeId) return res.redirect("/wizard/reference");

  const emp = await getEmployee(company.id, employeeId);
  if (!emp) return res.redirect("/wizard/reference");

  await run(`UPDATE employees SET reference_mode='KALENDER' WHERE id=$1`, [employeeId]);

  // verwijder niet-locked entries
  await run(
    `
    DELETE FROM employee_reference_calendar
    WHERE employee_id=$1
      AND day NOT IN (
        SELECT DISTINCT ("timestamp" AT TIME ZONE 'Europe/Brussels')::date
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
      `
      INSERT INTO employee_reference_calendar (employee_id, day, expected_minutes)
      VALUES ($1,$2,$3)
      ON CONFLICT (employee_id, day) DO UPDATE
      SET expected_minutes=EXCLUDED.expected_minutes
      `,
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
      `
      INSERT INTO employee_reference_calendar (employee_id, day, expected_minutes)
      VALUES ($1,$2,$3)
      ON CONFLICT (employee_id, day) DO UPDATE
      SET expected_minutes=EXCLUDED.expected_minutes
      `,
      [employeeId, extraDay, Math.floor(extraMinutes)]
    );
  }

  return res.redirect("/wizard/reference");
});

/* =========================
   STEP 4 — go to tags
   ========================= */
router.get("/wizard/qrs", async (req, res) => {
  const company = await getCompany(req);
  if (!company) return res.redirect("/wizard/company");

  const employees = await getEmployees(company.id);
  if (employees.length < 2) return res.redirect("/wizard/employees");

  for (const e of employees) {
    const ok = await isEmployeeReferenceOk(e.id);
    if (!ok) return res.redirect("/wizard/reference");
  }

  await ensureScantag(company.id);
  return res.redirect("/tags");
});

module.exports = router;
