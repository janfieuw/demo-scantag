// src/ui/layout.js

/**
 * Veilig HTML escapen (nodig voor titles e.d.)
 */
function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Simpele layout (niet-demo pagina's)
 */
function layout(title, html) {
  return `<!DOCTYPE html>
<html lang="nl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title || "PUNCTOO")}</title>
</head>
<body>
  ${html || ""}
</body>
</html>`;
}

/**
 * Demo layout met gele strook + grijze achtergrond
 * options:
 *   - width: number (bv. 850)
 */
function layoutDemo(title, contentHtml, options = {}) {
  const widthClass = options.width
    ? `demo-page--w${options.width}`
    : "";

  return `<!DOCTYPE html>
<html lang="nl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title || "PUNCTOO")}</title>

  <!-- CORRECTE CSS PATH -->
  <link rel="stylesheet" href="/static/demo.css" />
</head>

<body class="demo-body">
  <div class="demo-page ${widthClass}">
    <!-- GELE LINKERKOLOM -->
    <div class="demo-strip">
      ${contentHtml || ""}
    </div>

    <!-- GRIJZE RECHTERZONE -->
    <div class="demo-bg"></div>
  </div>
</body>
</html>`;
}

module.exports = {
  layout,
  layoutDemo,
  escapeHtml
};
