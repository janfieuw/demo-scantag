// src/routes/device.js
const express = require("express");
const { get } = require("../db");
const { layout } = require("../ui/layout");
const { cardHeader } = require("../ui/components");

const router = express.Router();

/**
 * Resolve ScanTag + bedrijf
 */
async function resolveTag(tagId) {
  return await get(
    `SELECT st.id, c.name AS company_name
     FROM scantags st
     JOIN companies c ON c.id = st.company_id
     WHERE st.id = $1`,
    [tagId]
  );
}

/**
 * Entry point via QR
 * /t/:tagId
 */
router.get("/t/:tagId", async (req, res) => {
  const tagId = Number(req.params.tagId);
  const tag = await resolveTag(tagId);

  if (!tag) {
    return res
      .status(404)
      .send(layout("Onbekende ScanTag", `<div class="card"><h1>Onbekende ScanTag</h1></div>`));
  }

  res.send(
    layout(
      "Scan",
      `
      <div class="card">
        ${cardHeader(tag.company_name, "SCAN")}
        <p>Kies actie:</p>
        <div class="row">
          <a class="btn" href="/t/${tagId}/in">IN</a>
          <a class="btn" href="/t/${tagId}/out">OUT</a>
        </div>
      </div>
      `
    )
  );
});

/**
 * IN / OUT doorsturen naar bestaande scan-logica
 */
router.get("/t/:tagId/:direction(in|out)", async (req, res) => {
  const { tagId, direction } = req.params;

  // We hergebruiken scan.js volledig
  res.redirect(`/scan/${tagId}/${direction}`);
});

module.exports = router;
