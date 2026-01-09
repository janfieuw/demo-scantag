const { run } = require("./index");

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
}

module.exports = { initDb };
