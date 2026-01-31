// src/routes/scantagPdf.js
const express = require("express");
const path = require("path");
const fs = require("fs");
const PDFDocument = require("pdfkit");
const QRCode = require("qrcode");
const { get } = require("../db");

const router = express.Router();

function getBaseUrl(req) {
  // Railway zit vaak achter proxy; req.protocol kan dan mis zijn.
  // Daarom: prefer X-Forwarded-Proto als aanwezig.
  const proto = (req.headers["x-forwarded-proto"] || req.protocol || "https")
    .toString()
    .split(",")[0]
    .trim();
  const host = req.get("host");
  return `${proto}://${host}`;
}

async function resolveTag(tagId) {
  return await get(
    `SELECT st.id AS tag_id, st.name AS tag_name, c.name AS company_name
     FROM scantags st
     JOIN companies c ON c.id = st.company_id
     WHERE st.id = $1`,
    [tagId]
  );
}

router.get("/scantag/:tagId.pdf", async (req, res) => {
  const tagId = Number(req.params.tagId);
  const tag = await resolveTag(tagId);
  if (!tag) return res.status(404).send("Unknown ScanTag");

  const baseUrl = getBaseUrl(req);

  // ✅ per ScanTag: 2 QR's (IN/OUT)
  const inUrl = `${baseUrl}/t/${tagId}/in`;
  const outUrl = `${baseUrl}/t/${tagId}/out`;

  // QR images
  const inPng = await QRCode.toBuffer(inUrl, { margin: 1, width: 900 });
  const outPng = await QRCode.toBuffer(outUrl, { margin: 1, width: 900 });

  // Template image (moet bestaan in src/styles/)
  const templatePath = path.join(__dirname, "..", "styles", "scantag-template.png");
  if (!fs.existsSync(templatePath)) {
    return res
      .status(500)
      .send(
        `Template ontbreekt: ${templatePath}. Plaats je template daar als "scantag-template.png".`
      );
  }

  // Template pixel size (matcht jouw TEMPLATE_2.png)
  const TEMPLATE_W = 1772;
  const TEMPLATE_H = 1182;

  // QR vakken in template (px)
  const LEFT_BOX = { x: 258, y: 390, w: 383, h: 383 };
  const RIGHT_BOX = { x: 1120, y: 390, w: 383, h: 383 };

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="punctoo-scantag-${tagId}.pdf"`
  );

  // A4 landscape, full bleed
  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 0 });
  doc.pipe(res);

  const pageW = doc.page.width;
  const pageH = doc.page.height;

  // achtergrond template
  doc.image(templatePath, 0, 0, { width: pageW, height: pageH });

  // schaalfactoren template→pdf
  const sx = pageW / TEMPLATE_W;
  const sy = pageH / TEMPLATE_H;

  // padding binnen QR-vak zodat rand zichtbaar blijft
  const PAD = 16;

  function placeQr(pngBuf, box) {
    const x = box.x * sx;
    const y = box.y * sy;
    const w = box.w * sx;
    const h = box.h * sy;

    const innerX = x + PAD * sx;
    const innerY = y + PAD * sy;
    const innerW = w - 2 * PAD * sx;
    const innerH = h - 2 * PAD * sy;

    doc.image(pngBuf, innerX, innerY, {
      fit: [innerW, innerH],
      align: "center",
      valign: "center",
    });
  }

  // Links = IN, rechts = OUT
  placeQr(inPng, LEFT_BOX);
  placeQr(outPng, RIGHT_BOX);

  doc.end();
});

module.exports = router;
