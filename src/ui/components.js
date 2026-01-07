const { escapeHtml } = require("./layout");

function cardHeader(companyName, direction) {
  const pill =
    direction === "IN"
      ? `<span class="pill in">IN</span>`
      : direction === "OUT"
      ? `<span class="pill out">OUT</span>`
      : "";

  return `<div class="row header">
    <div class="muted strong">${escapeHtml(companyName)}</div>
    <div>${pill}</div>
  </div>`;
}

module.exports = { cardHeader };
