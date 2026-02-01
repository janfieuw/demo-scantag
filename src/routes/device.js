function renderPairPage(tag, direction) {
  return layoutDemo(
    `Koppelen — ${tag.company_name}`,
    `
      <div style="display:flex; flex-direction:column; align-items:center; text-align:center; margin-top:10px;">
        <img
          src="/static/logo_punctoo_groot_opgeel.png"
          alt="Punctoo"
          style="width:240px; max-width:80vw; height:auto; margin-bottom:18px;"
        />

        <div style="font-size:14px; letter-spacing:.08em; text-transform:uppercase; margin-bottom:6px;">
          KOPPELEN SMARTPHONE
        </div>

        <div style="font-size:14px; margin-bottom:14px;">
          Geef éénmalig ID:
        </div>

        <form method="POST" action="/pair" style="display:flex; flex-direction:column; align-items:center; gap:12px; width:100%;">
          <input type="hidden" name="tagId" value="${tag.tag_id}" />
          <input type="hidden" name="direction" value="${escapeHtml(direction)}" />

          <input
            class="demo-input"
            name="employeeCode"
            placeholder="bv. 981d14c0"
            required
            autofocus
            style="max-width:260px; text-align:center;"
          />

          <button class="demo-btn primary" type="submit" style="min-width:180px;">
            BEVESTIG
          </button>
        </form>
      </div>
    `
  );
}
