const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * Self-contained Design Pack HTML (image embedded as base64), matching the layout
 * of the existing pack: header, render, price range column, specification column.
 */
export function designPackHtml({ record, imageB64, beforeB64, brand, site }) {
  const date = new Date(record.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const note = record.fallback ? 'Example image — AI render was unavailable' : 'AI render of your space';
  const specs = record.spec.map(([k, v]) => `<div class="da-si"><b>${esc(k)}:</b> ${esc(v)}</div>`).join('');
  const before = beforeB64
    ? `<h3>Your room today</h3><img src="data:image/jpeg;base64,${beforeB64}" alt="Your kitchen before"/>`
    : '';

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Design Pack — ${esc(brand)}</title><style>
body{font-family:Georgia,serif;color:#141313;margin:0;background:#fff}
.hd{background:#231e20;color:#fff;padding:22px 30px;font-size:1.15rem}
.hd small{display:block;opacity:.8;font-family:Arial,sans-serif;font-size:.68rem;letter-spacing:.2em;text-transform:uppercase;margin-top:4px}
.wrap{max-width:860px;margin:0 auto;padding:26px 30px}h2{font-size:1.25rem;margin:0 0 4px}h3{font-size:1rem;margin:26px 0 10px}
.dt{font-family:Arial,sans-serif;font-size:.75rem;color:#777;margin-bottom:16px}
img{width:100%;border-radius:10px;border:1px solid #e6e6e6}
.cols{display:flex;gap:22px;margin-top:20px;flex-wrap:wrap;font-family:Arial,sans-serif;font-size:.85rem}
.col{flex:1;min-width:260px;border:1px solid #e9e4e5;border-radius:10px;padding:16px}
.col h4{margin:0 0 8px}.da-prange{font-size:1.3rem;font-weight:bold}
.da-pnote{font-size:.7rem;color:#888;margin-top:8px}.da-si{padding:3px 0}
.ft{font-family:Arial,sans-serif;font-size:.68rem;color:#999;text-align:center;padding:18px}
</style></head><body>
<div class="hd"><strong>${esc(brand)}</strong> — Design Pack<small>Prepared in the design studio for ${esc(record.contact.name)}</small></div>
<div class="wrap"><h2>Your kitchen concept</h2><div class="dt">Prepared ${esc(date)} · ${esc(note)}</div>
<img src="data:image/png;base64,${imageB64}" alt="Kitchen design"/>
${before}
<div class="cols">
<div class="col"><div class="da-prange">${esc(record.price.label)}</div>
<div style="font-size:.72rem;color:#777;margin-top:2px">Indicative range based on your budget</div>
<div class="da-pnote">Your detailed estimate will be confirmed with your quote.</div></div>
<div class="col"><h4>Specification</h4><div class="da-slist">${specs}</div></div>
</div></div>
<div class="ft">Preview by ${esc(brand)} · ${esc(site)} · AI renders are concepts, not a survey or final design.</div>
</body></html>`;
}
