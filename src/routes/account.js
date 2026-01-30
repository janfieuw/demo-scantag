// src/routes/account.js
const express = require("express");
const crypto = require("crypto");
const { get, run } = require("../db");
const { layout, layoutDemo, escapeHtml } = require("../ui/layout");

const router = express.Router();

/* =========================
   Helpers
   ========================= */

function renderWithDemoLayout(title, leftHtml) {
  if (typeof layoutDemo === "function") return layoutDemo(title, leftHtml);
  return layout(title, leftHtml);
}

function isLikelyEmail(v) {
  const s = String(v || "").trim();
  return s.length >= 5 && s.includes("@") && s.includes(".");
}

function makeDemoSessionId() {
  return crypto.randomBytes(16).toString("hex");
}

// Password hashing (built-in crypto, no extra deps)
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(password), salt, 64).toString("hex");
  // format: scrypt$salt$hash
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  try {
    const parts = String(stored || "").split("$");
    if (parts.length !== 3) return false;
    const [algo, salt, hash] = parts;
    if (algo !== "scrypt") return false;

    const test = crypto.scryptSync(String(password), salt, 64).toString("hex");
    // timing-safe compare
    const a = Buffer.from(test, "hex");
    const b = Buffer.from(hash, "hex");
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
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

function renderAccount({ error = "", email = "" } = {}) {
  const errorHtml = error
    ? `<div class="demo-alert" role="alert">${escapeHtml(error)}</div>`
    : "";

  return renderWithDemoLayout(
    "DEMO — ACCOUNT",
    `
      <div class="demo-kicker">DEMO UITTESTEN — IN 3 STAPPEN</div>
      <div class="demo-title">ACCOUNT.</div>

      <p class="demo-lead">
        Log in met je e-mailadres en paswoord.
        Bestaat je account nog niet? Dan maken we het automatisch aan.
      </p>

      ${errorHtml}

      <form class="demo-form" method="POST" action="/demo/account">
        <label class="demo-label" for="email">E-mail</label>
        <input class="demo-input" id="email" name="email" type="email"
          placeholder="bv. jan@bedrijf.be"
          value="${escapeHtml(email)}" required />

        <div class="demo-spacer"></div>

        <label class="demo-label" for="password">Paswoord</label>
        <input class="demo-input" id="password" name="password" type="password"
          placeholder="min. 6 tekens" required />

        <div class="demo-actions" style="display:flex; gap:10px;">
          <button class="demo-btn primary" type="submit">VOLGENDE</button>
          <a class="demo-btn ghost" href="/demo/logout">UITLOGGEN</a>
        </div>

        <p class="demo-muted" style="margin-top:14px;">
          Tip: gebruik altijd dezelfde login om je QR’s, scans en fallbacks verder te testen.
        </p>
      </form>
    `
  );
}

/* =========================
   Routes
   ========================= */

router.get("/demo/account", async (req, res) => {
  // Als je al een demo_session hebt, ga meteen naar wizard
  const sid = String(req.cookies?.demo_session || "").trim();
  if (sid) return res.redirect("/wizard/company");

  return res.send(renderAccount());
});

router.post("/demo/account", async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");

  if (!isLikelyEmail(email)) {
    return res.status(400).send(
      renderAccount({ error: "Vul een geldig e-mailadres in.", email })
    );
  }
  if (password.length < 6) {
    return res.status(400).send(
      renderAccount({ error: "Paswoord moet minstens 6 tekens zijn.", email })
    );
  }

  // Bestaat account al?
  const existing = await get(
    `SELECT id, email, password_hash, demo_session_id
     FROM demo_accounts
     WHERE email = $1
     LIMIT 1`,
    [email]
  );

  if (existing) {
    // Login
    const ok = verifyPassword(password, existing.password_hash);
    if (!ok) {
      return res.status(401).send(
        renderAccount({ error: "Fout paswoord voor dit e-mailadres.", email })
      );
    }

    // ✅ Reuse dezelfde demo_session_id → company/employees blijven bestaan
    res.cookie("demo_account", "1", cookieOpts());
    res.cookie("demo_session", existing.demo_session_id, cookieOpts());
    return res.redirect("/wizard/company");
  }

  // Register (automatisch)
  const demoSessionId = makeDemoSessionId();
  const passwordHash = hashPassword(password);

  await run(
    `INSERT INTO demo_accounts (email, password_hash, demo_session_id)
     VALUES ($1,$2,$3)`,
    [email, passwordHash, demoSessionId]
  );

  res.cookie("demo_account", "1", cookieOpts());
  res.cookie("demo_session", demoSessionId, cookieOpts());
  return res.redirect("/wizard/company");
});

router.get("/demo/logout", async (req, res) => {
  res.clearCookie("demo_account");
  res.clearCookie("demo_session");
  return res.redirect("/demo/account");
});

module.exports = router;
