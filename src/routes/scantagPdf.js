// src/routes/scantagPdf.js
const express = require("express");
const path = require("path");
const PDFDocument = require("pdfkit");
const QRCode = require("qrcode");
const { get } = require("../db");

const router = express.Router();

function getBaseUrl(req) {
  return `${req.protocol}://${req.get("host")}`;
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

  // ✅ per ScanTag: 2 QR's IN/OUT
  const inUrl = `${baseUrl}/t/${tagId}/in`;
  const outUrl = `${baseUrl}/t/${tagId}/out`;

  // QR images
  const inPng = await QRCode.toBuffer(inUrl, { margin: 1, width: 900 });
  const outPng = await QRCode.toBuffer(outUrl, { margin: 1, width: 900 });

  // Template image (plaats dit bestand in src/styles/)
  const templatePath = path.join(__dirname, "..", "styles", "scantag-template.png");

  // Template pixel size (matcht jouw TEMPLATE_2.png)
  const TEMPLATE_W = 1772;
  const TEMPLATE_H = 1182;

  // Detecteerde QR-vakken in template (px) — links & rechts
  const LEFT_BOX = { x: 258, y: 390, w: 383, h: 383 };
  const RIGHT_BOX = { x: 1120, y: 390, w: 383, h: 383 };

  // PDF response headers
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="punctoo-scantag-${tagId}.pdf"`);

  // A4 landscape, full bleed (geen margin) → template vult de pagina
  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 0 });
  doc.pipe(res);

  const pageW = doc.page.width;
  const pageH = doc.page.height;

  // Plaats template als achtergrond (stretched naar pagina)
  doc.image(templatePath, 0, 0, { width: pageW, height: pageH });

  // Schaalfactoren om template-px → pdf-pt te mappen (stretched)
  const sx = pageW / TEMPLATE_W;
  const sy = pageH / TEMPLATE_H;

  // Padding binnen het vak (zodat zwarte rand van template zichtbaar blijft)
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

    doc.image(pngBuf, innerX, innerY, { fit: [innerW, innerH], align: "center", valign: "center" });
  }

  placeQr(inPng, LEFT_BOX);
  placeQr(outPng, RIGHT_BOX);

  doc.end();
});

module.exports = router;
