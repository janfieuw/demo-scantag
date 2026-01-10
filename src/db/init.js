const { run } = require("./index");

async function initDb() {
  await run(`
    CREATE TABLE IF NOT EXISTS companies (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL
    );
  `);

  // Basistabel employees (nieuw model)
  await run(`
    CREATE TABLE IF NOT EXISTS employees (
      id SERIAL PRIMARY KEY,
      company_id INT NOT NULL REFERENCES companies(id),
      display_name TEXT,
      scan_code TEXT
    );
  `);

  // Migratie-light: als de tabel al bestond met oude kolommen, zorgen we dat nieuwe kolommen bestaan.
  await run(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS display_name TEXT;`);
  await run(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS scan_code TEXT;`);

  // Als je vroeger "code" had, kopieer dat naar scan_code (zodat oude rows niet crashen).
  // (Als kolom 'code' niet bestaat, faalt dit; daarom doen we dit met een DO-block.)
  await run(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name='employees' AND column_name='code'
      ) THEN
        EXECUTE 'UPDATE employees SET scan_code = COALESCE(scan_code, code)';
      END IF;
    END $$;
  `);

  // Unieke scan_code per bedrijf (maar laat NULL toe voor oude data)
  await run(`
    CREATE UNIQUE INDEX IF NOT EXISTS employees_company_scan_code_uq
    ON employees(company_id, scan_code)
    WHERE scan_code IS NOT NULL;
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
