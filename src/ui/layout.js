function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function layout(title, bodyHtml) {
  return `<!doctype html>
<html lang="nl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="/static/base.css" />
</head>
<body>
  <div class="wrap">
    ${bodyHtml}
  </div>
</body>
</html>`;
}

// Demo / Wizard layout (zoals in de "schermen-demo" mock): split-screen
// Links: gele kolom met inhoud. Rechts: vaste sfeer-afbeelding.
function layoutDemo(title, leftHtml, opts = {}) {
  const rightTitle = opts.rightTitle ? escapeHtml(opts.rightTitle) : "";
  const rightSubtitle = opts.rightSubtitle ? escapeHtml(opts.rightSubtitle) : "";

  return `<!doctype html>
<html lang="nl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="/static/base.css" />
  <link rel="stylesheet" href="/static/demo.css" />
</head>
<body class="demo-body">
  <div class="demo-shell">
    <aside class="demo-left">
      <div class="demo-left-inner">
        ${leftHtml}
      </div>

      <div class="demo-brand">
        <div class="demo-logo">PUNCTOO</div>
      </div>
    </aside>

    <section class="demo-right" aria-hidden="true">
      <div class="demo-right-overlay">
        ${rightTitle ? `<div class="demo-right-title">${rightTitle}</div>` : ""}
        ${rightSubtitle ? `<div class="demo-right-subtitle">${rightSubtitle}</div>` : ""}
      </div>
    </section>
  </div>
</body>
</html>`;
}

module.exports = { layout, layoutDemo, escapeHtml };
