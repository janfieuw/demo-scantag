const express = require("express");
const { layout, layoutDemo, escapeHtml } = require("../ui/layout");

const router = express.Router();

function renderDemo(title, leftHtml) {
  if (typeof layoutDemo === "function") return layoutDemo(title, leftHtml);
  // Fallback (keeps app working if layoutDemo is missing)
  return layout(title, `<div class="card">${leftHtml}</div>`);
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ""));
}

router.get("/demo/account", async (req, res) => {
  const error = String(req.query.error || "");

  const errorHtml = error
    ? `<div class="demo-error">${escapeHtml(error)}</div>`
    : "";

  const left = `
    <div class="demo-step">
      <div class="demo-kicker">DEMO UITTESTEN<br/>IN 3 STAPPEN.</div>
      <div class="demo-title">ACCOUNT.</div>
      <div class="demo-text">Maak eerst een account aan.</div>
      <div class="demo-text">Kies een e-mail adres als login en een paswoord.</div>

      ${errorHtml}

      <form method="POST" action="/demo/account" class="demo-form">
        <label class="demo-label" for="email">E-MAIL</label>
        <input class="demo-input" id="email" name="email" type="email" required />

        <label class="demo-label" for="password">PASWOORD</label>
        <input class="demo-input" id="password" name="password" type="password" required />

        <label class="demo-label" for="password2">HERHAAL PASWOORD</label>
        <input class="demo-input" id="password2" name="password2" type="password" required />

        <div class="demo-actions">
          <button class="demo-btn" type="submit">VOLGENDE</button>
        </div>
      </form>

      <div class="demo-brand">
        <div class="demo-brand-title">PUNCTOO</div>
        <div class="demo-brand-sub">PUNCTOO Demo</div>
      </div>
    </div>
  `;

  return res.send(renderDemo("Demo - Account", left));
});

router.post("/demo/account", async (req, res) => {
  const email = String(req.body.email || "").trim();
  const password = String(req.body.password || "");
  const password2 = String(req.body.password2 || "");

  if (!isValidEmail(email)) {
    return res.redirect("/demo/account?error=Vul%20een%20geldig%20e-mail%20adres%20in");
  }
  if (!password || password.length < 6) {
    return res.redirect("/demo/account?error=Paswoord%20moet%20minstens%206%20tekens%20zijn");
  }
  if (password !== password2) {
    return res.redirect("/demo/account?error=Paswoorden%20komen%20niet%20overeen");
  }

  // Demo: geen echte user-table. We onthouden enkel dat er "een account" is aangemaakt.
  res.cookie("demo_account", "1", {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    maxAge: 1000 * 60 * 60 * 24 * 7, // 7 dagen
  });
  res.cookie("demo_email", email, {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    maxAge: 1000 * 60 * 60 * 24 * 7,
  });

  return res.redirect("/wizard/company");
});

module.exports = router;
