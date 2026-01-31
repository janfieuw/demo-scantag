function layoutDemo(title, bodyHtml, options = {}) {
  const widthClass = options.width
    ? `demo-page--w${options.width}`
    : "";

  return `<!DOCTYPE html>
<html lang="nl">
<head>
  <meta charset="utf-8" />
  <title>${title}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <link rel="stylesheet" href="/styles/demo.css" />
</head>
<body>

  <div class="demo-page ${widthClass}">
    <div class="demo-strip">
      ${bodyHtml}
    </div>

    <div class="demo-bg"></div>
  </div>

</body>
</html>`;
}

module.exports = { layoutDemo };
