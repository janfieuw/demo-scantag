function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/* Standaard layout (admin / rapporten) */
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
  ${bodyHtml}
</body>
</html>`;
}

/* DEMO / WIZARD layout */
function layoutDemo(title, leftHtml) {
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

    <!-- LINKER KANT -->
    <aside class="demo-left">
      <div class="demo-left-inner">
        ${leftHtml}
      </div>

      <div class="demo-brand">
        <div class="demo-logo">PUNCTOO</div>
      </div>
    </aside>

    <!-- RECHTER KANT -->
    <section class="demo-right" aria-hidden="true">
      <img
        src="/static/demo-lady.png"
        class="demo-right-lady"
        alt=""
        loading="eager"
      />
    </section>

  </div>
</body>
</html>`;
}

module.exports = {
  layout,
  layoutDemo,
  escapeHtml,
};
