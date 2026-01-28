const express = require("express");
const crypto = require("crypto");
const { layout, layoutDemo, escapeHtml } = require("../ui/layout");

const router = express.Router();

function renderWithDemoLayout(title, leftHtml) {
  if (typeof layoutDemo === "function") return layoutDemo(title, leftHtml);
  return layout(title, leftHtml);
}

function isLikelyEmail(v) {
  const s = String(v || "").trim();
  return s.length >= 5 && s.includes("@") && s.includes(".");
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
        Maak eerst een account aan. Kies een e-mailadres als login en een paswoord.
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

        <div class="demo-spacer"></div>

        <label class="demo-label" for="password2">Herhaal paswoord</label>
        <input class="demo-input" id="password2" name="password2" type="password" required />

        <div class="demo-actions">
          <button class="demo-btn primary" type="submit">VOLGENDE</button>
        </div>
      </form>
    `
  );
}

router.get("/demo/account", async (req, res) => {
  return res.send(renderAccount());
});

router.post("/demo/account", async (req, res) => {
  const email = String(req.body.email || "").trim();
  const password = String(req.body.password || "");
  const password2 = String(req.body.password2 || "");

  if (!isLikelyEmail(email)) {
    return res
      .status(400)
      .send(renderAccount({ error: "Vul een geldig e-mailadres in.", email }));
  }
  if (password.length < 6) {
    return res
      .status(400)
      .send(renderAccount({ error: "Paswoord moet minstens 6 tekens zijn.", email }));
  }
  if (password !== password2) {
    return res
      .status(400)
      .send(renderAccount({ error: "Paswoorden komen niet overeen.", email }));
  }

  // Per login een aparte demo-session id (koppelt bedrijven/werknemers aan deze browser)
  const demoSession = crypto.randomBytes(16).toString("hex");

  // cookie options
  const cookieOpts = {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production", // ✅ werkt nu correct door trust proxy in app.js
    maxAge: 1000 * 60 * 60 * 12, // 12u
  };

  res.cookie("demo_account", "1", cookieOpts);
  res.cookie("demo_session", demoSession, cookieOpts);

  return res.redirect("/wizard/company");
});

module.exports = router;
