const { run, get } = require("./index");

async function initDb() {
  await run(`
    CREATE TABLE IF NOT EXISTS companies (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL
    );
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS employees (
      id SERIAL PRIMARY KEY,
      company_id INT NOT NULL REFERENCES companies(id),
      code TEXT NOT NULL,
      UNIQUE(company_id, code)
    );
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS scantags (
      id SERIAL PRIMARY KEY,
      company_id INT NOT NULL REFERENCES companies(id),
      name TEXT NOT NULL
    );
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS device_bindings (
      id SERIAL PRIMARY KEY,
      company_id INT NOT NULL REFERENCES companies(id),
      employee_id INT NOT NULL REFERENCES employees(id),
      token TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS scan_events (
      id SERIAL PRIMARY KEY,
      company_id INT NOT NULL REFERENCES companies(id),
      employee_id INT NOT NULL REFERENCES employees(id),
      scantag_id INT NOT NULL REFERENCES scantags(id),
      direction TEXT NOT NULL CHECK (direction IN ('IN','OUT')),
      timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await run(`CREATE INDEX IF NOT EXISTS idx_device_bindings_token ON device_bindings(token);`);
  await run(`CREATE INDEX IF NOT EXISTS idx_scan_events_employee ON scan_events(employee_id);`);

  // Seed (pilot): 1 bedrijf + 2 werknemers + 1 tag
  const c = await get(`SELECT COUNT(*)::int AS n FROM companies;`);
  if ((c?.n || 0) > 0) return;

  await run(`INSERT INTO companies (name) VALUES ($1)`, ["PUNCTOO DEMO"]);
  await run(`INSERT INTO employees (company_id, code) VALUES (1,'WERKNEMER1')`);
  await run(`INSERT INTO employees (company_id, code) VALUES (1,'WERKNEMER2')`);
  await run(`INSERT INTO scantags (company_id, name) VALUES (1,'ScanTag DEMO')`);
}

module.exports = { initDb };
