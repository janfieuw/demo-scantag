// src/routes/account.js
const express = require("express");
const crypto = require("crypto");
const { get, run } = require("../db");
const { layout, layoutDemo, escapeHtml } = require("../ui/layout");

const router = express.Router();

/* =========================
   Helpers
   ========================= */

function renderWithDemoLayout(title, leftHtml, options = {}) {
  if (typeof layoutDemo === "function") {
    return layoutDemo(title, leftHtml, options);
  }
  return layout(title, leftHtml);
}

function isLikelyEmail(v) {
  const s = String(v || "").trim();
  return s.length >= 5 && s.includes("@") && s.includes(".");
}

function makeDemoSessionId() {
  return crypto.randomBytes(16).toString("hex");
}

/* ===== Password hashing ===== */

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  try {
    const [algo, salt, hash] = stored.split("$");
    if (algo !== "scrypt") return false;

    const test = crypto.scryptSync(password, salt, 64).toString("hex");
    return crypto.timingSafeEqual(
      Buffer.from(test, "hex"),
      Buffer.from(hash, "hex")
    );
  } catch {
    return false;
  }
}

function cookieOpts() {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 1000 * 60 * 60 * 24 * 30, // 30 dagen
  };
}

function setDemoCookies(res, demoSessionId) {
  res.cookie("demo_account", "1", cookieOpts());
  res.cookie("demo_session", demoSessionId, cookieOpts());
}

/* =========================
   Views
   ========================= */

function renderLogin({ error = "", email = "" } = {}) {
  const errorHtml = error
    ? `<div class="demo-alert">${escapeHtml(error)}</div>`
    : "";

  return renderWithDemoLayout(
    "DEMO — LOGIN",
    `
      <div class="demo-kicker">DEMO UITTESTEN — IN 3 STAPPEN</div>
      <div class="demo-title">ACCOUNT.</div>

      <p class="demo-lead">
        Login: vul je e-mailadres en paswoord in.<br />
        Heb je nog geen account?
        <a href="/demo/signup" class="demo-link">Maak deze dan eerst aan.</a>
      </p>

      ${errorHtml}

      <form class="demo-form" method="POST" action="/demo/login">
        <label class="demo-label">E-mail</label>
        <input class="demo-input" name="email" type="email"
          value="${escapeHtml(email)}" required />

        <label class="demo-label">Paswoord</label>
        <input class="demo-input" name="password" type="password" required />

        <div class="demo-actions">
          <button class="demo-btn primary">VOLGENDE</button>
          <a class="demo-btn ghost" href="/demo/logout">UITLOGGEN</a>
        </div>
      </form>
    `
  );
}

function renderSignup({ error = "", email = "" } = {}) {
  const errorHtml = error
    ? `<div class="demo-alert">${escapeHtml(error)}</div>`
    : "";

  return renderWithDemoLayout(
    "DEMO — ACCOUNT AANMAKEN",
    `
      <div class="demo-kicker">DEMO UITTESTEN — IN 3 STAPPEN</div>
      <div class="demo-title">ACCOUNT AANMAKEN.</div>

      <p class="demo-lead">
        Maak een account aan.<br />
        Heb je al een account?
        <a href="/demo/login" class="demo-link">Ga naar login.</a>
      </p>

      ${errorHtml}

      <form class="demo-form" method="POST" action="/demo/signup">
        <label class="demo-label">E-mail</label>
        <input class="demo-input" name="email" type="email"
          value="${escapeHtml(email)}" required />

        <label class="demo-label">Paswoord</label>
        <input class="demo-input" name="password" type="password" required />

        <label class="demo-label">Herhaal paswoord</label>
        <input class="demo-input" name="password2" type="password" required />

        <div class="demo-actions">
          <button class="demo-btn primary">ACCOUNT AANMAKEN</button>
          <a class="demo-btn ghost" href="/demo/login">ANNULEREN</a>
        </div>
      </form>
    `
  );
}

/* =========================
   Routes
   ========================= */

router.get("/demo/account", (req, res) => {
  res.redirect("/demo/login");
});

router.get("/demo/login", (req, res) => {
  res.send(renderLogin());
});

router.post("/demo/login", async (req, res) => {
  const email = String(req.body.email || "").toLowerCase().trim();
  const password = String(req.body.password || "");

  const account = await get(
    `SELECT password_hash, demo_session_id
     FROM demo_accounts
     WHERE email = $1`,
    [email]
  );

  if (!account || !verifyPassword(password, account.password_hash)) {
    return res.send(renderLogin({
      error: "Ongeldige login.",
      email
    }));
  }

  setDemoCookies(res, account.demo_session_id);
  res.redirect("/wizard/company");
});

router.get("/demo/signup", (req, res) => {
  res.send(renderSignup());
});

router.post("/demo/signup", async (req, res) => {
  const { email, password, password2 } = req.body;

  if (password !== password2) {
    return res.send(renderSignup({
      error: "Paswoorden komen niet overeen.",
      email
    }));
  }

  const exists = await get(
    `SELECT 1 FROM demo_accounts WHERE email=$1`,
    [email]
  );

  if (exists) {
    return res.send(renderSignup({
      error: "Account bestaat al. Ga naar login.",
      email
    }));
  }

  const demoSessionId = makeDemoSessionId();
  await run(
    `INSERT INTO demo_accounts (email, password_hash, demo_session_id)
     VALUES ($1,$2,$3)`,
    [email, hashPassword(password), demoSessionId]
  );

  setDemoCookies(res, demoSessionId);
  res.redirect("/wizard/company");
});

router.get("/demo/logout", (req, res) => {
  res.clearCookie("demo_account");
  res.clearCookie("demo_session");
  res.redirect("/demo/login");
});

module.exports = router;
