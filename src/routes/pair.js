import express from "express";
import { layout } from "../ui/layout.js";

const router = express.Router();

/**
 * PAIR DEVICE – UI
 * Toont enkel:
 * - Punctoo logo
 * - titel
 * - input werknemer-code
 * - bevestig knop
 */
router.get("/pair/:tagId/:direction", async (req, res) => {
  const { tagId, direction } = req.params;

  const html = `
    <div class="pair-wrapper">
      <img
        src="/styles/logo_punctoo_groot_opgeel.png"
        alt="Punctoo"
        class="pair-logo"
      />

      <div class="pair-title">
        KOPPELEN SMARTPHONE
      </div>

      <div class="pair-subtitle">
        Geef éénmalig ID:
      </div>

      <form method="POST" action="/pair/${tagId}/${direction}">
        <input
          type="text"
          name="employee_code"
          class="pair-input"
          placeholder="bv. 981d14c0"
          required
          autofocus
        />

        <button type="submit" class="pair-button">
          BEVESTIG
        </button>
      </form>
    </div>
  `;

  res.send(
    layout({
      title: "Punctoo – Koppelen",
      body: html,
      hideBackgroundImage: true, // enkel geel
    })
  );
});

export default router;
