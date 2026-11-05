const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * Self-contained Design Pack HTML (image embedded as base64), matching the layout
 * of the existing pack: header, render, price range column, specification column.
 */
export function designPackHtml({ record, imageB64, beforeB64, brand, site }) {
  const date = new Date(record.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const note = record.fallback ? 'Example image — AI render was unavailable' : 'AI render of your space';
  const p = record.price;
  const row = (l, cls = '') => `<div class="da-pl ${cls}"><span>${esc(l.label)}</span><span>${esc(l.value)}</span></div>`;
  const lines = p.lines || p.breakdown || [];
  const notes = p.notes || [p.note || 'Estimate based on your style and budget. Actual costs vary.'];
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
.da-badge{display:inline-block;font-size:.62rem;letter-spacing:.08em;text-transform:uppercase;background:#f3eee7;color:#7a6650;padding:3px 8px;border-radius:3px;margin-top:6px}
.da-psub{font-size:.72rem;color:#777;margin-top:2px}
.da-plines{margin-top:12px}.da-pl{display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px dashed #eee}
.da-pl.tot{font-weight:bold;border-bottom:0}.da-inst{margin-top:12px;padding-top:12px;border-top:1px dashed #e9e4e5}.da-inst .da-pl{border-bottom:0}
.da-inote{font-size:.72rem;color:#777;margin-top:4px}
.ft{font-family:Arial,sans-serif;font-size:.68rem;color:#999;text-align:center;padding:18px}
</style></head><body>
<div class="hd"><strong>${esc(brand)}</strong> — Design Pack<small>Prepared in the design studio for ${esc(record.contact.name)}</small></div>
<div class="wrap"><h2>Your kitchen concept</h2><div class="dt">Prepared ${esc(date)} · ${esc(note)}</div>
<img src="data:image/png;base64,${imageB64}" alt="Kitchen design"/>
${before}
<div class="cols">
<div class="col"><div class="da-prange">${esc(p.label)}</div>
<div class="da-psub">${esc(p.sub || 'Indicative estimate')}</div>
${lines.length ? `<div class="da-plines">${lines.map((l) => row(l)).join('')}${p.total ? row(p.total, 'tot') : ''}</div>` : ''}
${p.installation ? `<div class="da-inst">${row(p.installation)}<div class="da-inote">${esc(p.installation.note)}</div></div>` : ''}
${notes.map((n) => `<div class="da-pnote">${esc(n)}</div>`).join('')}</div>
<div class="col"><h4>Specification</h4><div class="da-slist">${specs}</div></div>
</div></div>
<div class="ft">Preview by ${esc(brand)}${site ? ` · ${esc(site)}` : ''} · AI renders are concepts, not a survey or final design.</div>
</body></html>`;
}