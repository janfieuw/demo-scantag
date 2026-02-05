// src/ui/layout.js

function escapeHtml(v) {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function layout(title, html) {
  return `<!doctype html>
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
 * layoutDemo(title, leftHtml, options?)
 * - VASTE linkerkolom: 760px (geen per-page width meer)
 * - options.bodyClass blijft mogelijk (voor kleine page tweaks indien ooit nodig)
 */
function layoutDemo(title, leftHtml, options = {}) {
  const bodyClass = String(options.bodyClass || "").trim();

  return `<!doctype html>
<html lang="nl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title || "PUNCTOO")}</title>

  <!-- Font -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet">

  <!-- styles via /static (app.js mount) -->
  <link rel="stylesheet" href="/static/demo.css" />
</head>

<body class="demo-body ${escapeHtml(bodyClass)}">
  <div class="demo-shell">
    <!-- LEFT — GEEL -->
    <div class="demo-left">
      <div class="demo-left-content">
        <div class="demo-left-inner">
          ${leftHtml || ""}
        </div>
      </div>

      <div class="demo-left-footer">
        <img class="demo-logo" src="/static/logo.png" alt="" />
      </div>
    </div>

    <!-- RIGHT — MUUR + DAME -->
    <div class="demo-right">
      <img class="demo-right-lady" src="/static/demo-lady.png" alt="" />
    </div>
  </div>

  <!-- Copy helper (gebruikt door tags: data-copy="...") -->
  <script>
    (function () {
      function copyText(text) {
        if (!text) return;

        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(function(){}, function(){
            window.prompt("Kopieer link:", text);
          });
          return;
        }
        window.prompt("Kopieer link:", text);
      }

      document.addEventListener("click", function (e) {
        var btn = e.target.closest("[data-copy]");
        if (!btn) return;
        e.preventDefault();
        copyText(btn.getAttribute("data-copy"));
      });
    })();
  </script>
</body>
</html>`;
}

module.exports = { layoutDemo, layout, escapeHtml };
