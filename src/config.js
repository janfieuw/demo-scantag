const PORT = Number(process.env.PORT || 3000);
const NODE_ENV = process.env.NODE_ENV || "development";
const IS_PROD = NODE_ENV === "production";

const COOKIE_NAME = process.env.COOKIE_NAME || "punctoo_device_token";
const COOLDOWN_MINUTES = Number.isFinite(Number(process.env.COOLDOWN_MINUTES))
  ? Number(process.env.COOLDOWN_MINUTES)
  : 60;

const DATABASE_URL = process.env.DATABASE_URL;

module.exports = {
  PORT,
  NODE_ENV,
  IS_PROD,
  COOKIE_NAME,
  COOLDOWN_MINUTES,
  DATABASE_URL,
};
