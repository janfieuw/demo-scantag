const { Pool } = require("pg");
const { DATABASE_URL, IS_PROD } = require("../config");

if (!DATABASE_URL) {
  console.error("❌ DATABASE_URL ontbreekt. Zet dit in Railway Variables.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: IS_PROD ? { rejectUnauthorized: false } : false,
});

async function run(sql, params = []) {
  return await pool.query(sql, params);
}

async function get(sql, params = []) {
  const res = await pool.query(sql, params);
  return res.rows[0] || null;
}

async function all(sql, params = []) {
  const res = await pool.query(sql, params);
  return res.rows || [];
}

module.exports = { pool, run, get, all };
