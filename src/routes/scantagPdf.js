const express = require("express");
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
  const inUrl = `${baseUrl}/t/${tagId}/in`;
  const outUrl = `${baseUrl}/t/${tagId}/out`;

  const inPng = await QRCode.toBuffer(inUrl, { margin: 1, width: 600 });
  const outPng = await QRCode.toBuffer(outUrl, { margin: 1, width: 600 });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="punctoo-scantag-${tagId}.pdf"`);

  const doc = new PDFDocument({ size: "A4", margin: 36 });
  doc.pipe(res);

  // Header
  doc.fontSize(20).text("PUNCTOO ScanTag", { align: "left" });
  doc.moveDown(0.3);
  doc.fontSize(12).text(`Bedrijf: ${tag.company_name}`);
  doc.fontSize(12).text(`Tag: ${tag.tag_name}`);
  doc.moveDown(1);

  // Layout: 2 kolommen
  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const colWidth = (pageWidth - 24) / 2;
  const topY = doc.y;

  // IN box
  doc.roundedRect(doc.page.margins.left, topY, colWidth, 320, 12).stroke();
  doc.fontSize(16).text("IN", doc.page.margins.left + 12, topY + 12);
  doc.image(inPng, doc.page.margins.left + 12, topY + 44, { fit: [colWidth - 24, 220], align: "center" });
  doc.fontSize(8).text(inUrl, doc.page.margins.left + 12, topY + 270, { width: colWidth - 24 });

  // OUT box
  const x2 = doc.page.margins.left + colWidth + 24;
  doc.roundedRect(x2, topY, colWidth, 320, 12).stroke();
  doc.fontSize(16).text("OUT", x2 + 12, topY + 12);
  doc.image(outPng, x2 + 12, topY + 44, { fit: [colWidth - 24, 220], align: "center" });
  doc.fontSize(8).text(outUrl, x2 + 12, topY + 270, { width: colWidth - 24 });

  doc.moveDown(20);
  doc.end();
});

module.exports = router;
