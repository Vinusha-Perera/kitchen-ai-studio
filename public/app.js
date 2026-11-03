// AI Design Studio — 7-step wizard. Plain JS, no build step.

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const gbp = (n) => '£' + Number(n).toLocaleString('en-GB');
const TOTAL = 7;

const els = {
  body: $('#body'), progress: $('#progress'), count: $('#stepCount'),
  foot: $('#foot'), back: $('#backBtn'), skip: $('#skipBtn'), next: $('#nextBtn'),
};

let opts;
const state = {
  step: 0,
  photo: null,       // File
  photoUrl: null,    // object URL for preview
  roomType: 'existing',
  width: '', depth: '', ceiling: '',
  budget: 15000,
  style: null, colour: null, worktop: null, priority: null,
  mustHaves: [],
  contact: { name: '', email: '', phone: '', postcode: '', consent: false },
};

// ---------- Step renderers ----------

const steps = [
  {
    title: 'Your kitchen',
    lede: 'Upload a photo, add measurements, and set your budget.',
    skippable: false,
    render() {
      const photoBlock = state.photoUrl
        ? `<div class="preview"><img src="${state.photoUrl}" alt="Your kitchen photo"/><button type="button" id="removePhoto">Change photo</button></div>`
        : `<div class="drop" id="drop" tabindex="0" role="button" aria-label="Upload a photo of your kitchen">
            <div class="drop-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 16V4m0 0-4 4m4-4 4 4M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg></div>
            <strong>Upload one clear photo of your kitchen</strong> — click or drag and drop
            <p class="hint"><b>Your photo is the whole point</b> — one well-lit shot, standing back so the whole kitchen is in frame, becomes your AI design. Just the one photo needed — extra angles only help our design team. JPG, PNG or iPhone photos · Max 10MB</p>
          </div>`;
      return `
        ${photoBlock}
        <input type="file" id="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" hidden />
        <div class="label">What does your photo show?</div>
        <div class="toggle" id="roomType">
          <button type="button" data-v="existing" class="${state.roomType === 'existing' ? 'on' : ''}">Existing kitchen</button>
          <button type="button" data-v="empty" class="${state.roomType === 'empty' ? 'on' : ''}">Empty room</button>
        </div>
        ${state.photo ? '' : `<div class="note"><b>No photo?</b>You'll still get style examples and a price estimate — but seeing <b>your own kitchen</b> transformed is the whole point, and it takes just one photo.</div>`}
        <div class="dims">
          ${dimField('width', 'Width (m)', 'e.g. 4.5')}
          ${dimField('depth', 'Depth (m)', 'e.g. 3.2')}
          ${dimField('ceiling', 'Ceiling (m)', 'e.g. 2.4')}
        </div>
        <div style="margin-top:22px">
          <span class="label-caps">Your budget</span>
          <div class="budget">
            <input type="range" id="budget" min="${opts.budget.min}" max="${opts.budget.max}" step="${opts.budget.step}" value="${state.budget}" aria-label="Budget"/>
            <output id="budgetOut">${gbp(state.budget)}</output>
          </div>
        </div>
        <div class="error" id="err"></div>`;
    },
    bind() {
      const file = $('#file');
      const drop = $('#drop');
      if (drop) {
        drop.addEventListener('click', () => file.click());
        drop.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && file.click());
        ['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('drag'); }));
        ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('drag'); }));
        drop.addEventListener('drop', (e) => setPhoto(e.dataTransfer.files[0]));
      }
      file.addEventListener('change', () => setPhoto(file.files[0]));
      $('#removePhoto')?.addEventListener('click', () => file.click());

      $('#roomType').addEventListener('click', (e) => {
        const b = e.target.closest('button'); if (!b) return;
        state.roomType = b.dataset.v; render();
      });
      ['width', 'depth', 'ceiling'].forEach((k) => $('#' + k).addEventListener('input', (e) => (state[k] = e.target.value)));
      $('#budget').addEventListener('input', (e) => {
        state.budget = Number(e.target.value);
        $('#budgetOut').textContent = gbp(state.budget);
      });
    },
  },
  pictureStep('style', 'What feeling are you after?', 'Pick the image that best matches the vibe you want.', () => opts.styles,
    (k, o) => ({ bg: `url('/img/style-${k}.jpg') center/cover, linear-gradient(135deg,#e9e3db,#cfc5b8)`, title: o.label, sub: o.sub })),
  pictureStep('colour', 'Colour direction', 'Which palette speaks to you?', () => opts.colours,
    (k, o) => ({ bg: o.swatch, title: o.label })),
  pictureStep('worktop', 'Worktop material', 'Big impact on look and cost.', () => opts.worktops,
    (k, o) => ({ bg: o.swatch, title: o.label, sub: o.sub, tag: o.tag })),
  pictureStep('priority', 'What matters most?', 'Helps tailor the design to your lifestyle.', () => opts.priorities,
    (k, o) => ({ icon: o.icon, title: o.label })),
  {
    title: 'Any must-haves?',
    lede: 'Select as many as you like.',
    skippable: true,
    render() {
      return `<div class="chips" id="chips">${Object.entries(opts.mustHaves).map(([k, o]) =>
        `<button type="button" class="chip ${state.mustHaves.includes(k) ? 'on' : ''}" data-k="${k}" aria-pressed="${state.mustHaves.includes(k)}"><span>${o.icon}</span>${esc(o.label)}</button>`).join('')}</div>`;
    },
    bind() {
      $('#chips').addEventListener('click', (e) => {
        const b = e.target.closest('.chip'); if (!b) return;
        const k = b.dataset.k;
        state.mustHaves = state.mustHaves.includes(k) ? state.mustHaves.filter((m) => m !== k) : [...state.mustHaves, k];
        b.classList.toggle('on'); b.setAttribute('aria-pressed', state.mustHaves.includes(k));
      });
    },
    onSkip() { state.mustHaves = []; },
  },
  {
    title: 'Where should we send your design?',
    lede: "We'll show your design here and send your Design Pack. A designer may follow up with a free quote.",
    skippable: false,
    nextLabel: 'Create my design →',
    render() {
      const c = state.contact;
      return `
        <div class="form-grid">
          <label><span class="label-caps">Full name *</span><input type="text" id="name" autocomplete="name" value="${esc(c.name)}"/></label>
          <label><span class="label-caps">Email *</span><input type="email" id="email" autocomplete="email" value="${esc(c.email)}"/></label>
          <label><span class="label-caps">Phone</span><input type="tel" id="phone" autocomplete="tel" value="${esc(c.phone)}"/></label>
          <label><span class="label-caps">Postcode</span><input type="text" id="postcode" autocomplete="postal-code" value="${esc(c.postcode)}"/></label>
        </div>
        <label class="consent"><input type="checkbox" id="consent" ${c.consent ? 'checked' : ''}/>
          <span>I agree to my photo and details being used to create my design and to be contacted about a quote. AI renders are concepts, not a survey or final design.</span></label>
        <div class="error" id="err"></div>`;
    },
    bind() {
      ['name', 'email', 'phone', 'postcode'].forEach((k) => $('#' + k).addEventListener('input', (e) => (state.contact[k] = e.target.value)));
      $('#consent').addEventListener('change', (e) => (state.contact.consent = e.target.checked));
    },
    validate() {
      const c = state.contact;
      if (!c.name.trim()) return 'Please enter your name.';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email.trim())) return 'Please enter a valid email address.';
      if (!c.consent) return 'Please tick the box so we can create your design.';
      return null;
    },
  },
];

function dimField(k, label, ph) {
  return `<label><span class="label-caps">${label}</span><input type="number" id="${k}" min="1" max="30" step="0.1" inputmode="decimal" placeholder="${ph}" value="${esc(state[k])}"/></label>`;
}

/** Shared builder for the four 2x2 picture-card steps. */
function pictureStep(key, title, lede, getOptions, view) {
  return {
    title, lede, skippable: true,
    render() {
      return `<div class="cards" id="cards" role="radiogroup">${Object.entries(getOptions()).map(([k, o]) => {
        const v = view(k, o);
        const pic = v.icon
          ? `<div class="pic tile">${v.icon}</div>`
          : `<div class="pic" style="background:${v.bg}"></div>`;
        return `<button type="button" role="radio" aria-checked="${state[key] === k}" class="card ${state[key] === k ? 'on' : ''}" data-k="${k}">
          ${pic}<div class="cap"><strong>${esc(v.title)}</strong>${v.sub ? `<span>${esc(v.sub)}${v.tag ? `<em>${esc(v.tag)}</em>` : ''}</span>` : ''}</div></button>`;
      }).join('')}</div>`;
    },
    bind() {
      $('#cards').addEventListener('click', (e) => {
        const b = e.target.closest('.card'); if (!b) return;
        state[key] = b.dataset.k;
        document.querySelectorAll('#cards .card').forEach((c) => {
          const on = c === b; c.classList.toggle('on', on); c.setAttribute('aria-checked', on);
        });
      });
    },
    onSkip() { state[key] = null; },
  };
}

function setPhoto(file) {
  if (!file) return;
  const okType = /^image\/(jpeg|png|webp|heic|heif)$/.test(file.type) || /\.(jpe?g|png|webp|hei[cf])$/i.test(file.name);
  if (!okType) return showErr('Please choose a JPG, PNG or iPhone photo.');
  if (file.size > 10 * 1024 * 1024) return showErr('That photo is over 10MB. Please use a smaller one.');
  if (state.photoUrl) URL.revokeObjectURL(state.photoUrl);
  state.photo = file;
  // Browsers other than Safari can't preview HEIC; show a neutral placeholder instead.
  state.photoUrl = /hei[cf]/i.test(file.type + file.name)
    ? 'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="300"><rect width="100%" height="100%" fill="#f2ecea"/><text x="50%" y="50%" text-anchor="middle" font-family="Arial" font-size="22" fill="#6f6866">${esc(file.name)} ready ✓</text></svg>`)
    : URL.createObjectURL(file);
  render();
}

function showErr(msg) { const e = $('#err'); if (e) e.textContent = msg || ''; }

// ---------- Navigation ----------

function render() {
  const s = steps[state.step];
  els.count.textContent = `Step ${state.step + 1} of ${TOTAL}`;
  els.progress.innerHTML = Array.from({ length: TOTAL }, (_, i) =>
    `<span class="${i < state.step ? 'done' : i === state.step ? 'current' : ''}"></span>`).join('');
  els.body.innerHTML = `<div class="eyebrow">Step ${state.step + 1}</div><h2>${esc(s.title)}</h2><p class="lede">${esc(s.lede)}</p>${s.render()}`;
  s.bind?.();
  els.foot.classList.remove('gone');
  els.back.classList.toggle('hidden', state.step === 0);
  els.skip.classList.toggle('hidden', !s.skippable);
  els.next.textContent = s.nextLabel || 'Continue →';
  els.next.disabled = false;
}

function go(delta) {
  state.step = Math.max(0, Math.min(TOTAL - 1, state.step + delta));
  render();
  $('#studio').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

els.back.addEventListener('click', () => go(-1));
els.skip.addEventListener('click', () => { steps[state.step].onSkip?.(); go(1); });
els.next.addEventListener('click', () => {
  const s = steps[state.step];
  const err = s.validate?.();
  if (err) return showErr(err);
  if (state.step === TOTAL - 1) return generate();
  go(1);
});

// ---------- Generate + results ----------

const LOADING_LINES = [
  'Studying your room…', 'Fitting new cabinetry…', 'Laying the worktops…',
  'Adjusting the lighting…', 'Adding the finishing touches…',
];

async function generate() {
  els.foot.classList.add('gone');
  els.count.textContent = 'Creating your design';
  let i = 0;
  els.body.innerHTML = `<div class="loading"><div class="spinner"></div><h2>Designing your kitchen</h2><p id="loadLine">${LOADING_LINES[0]}</p><p class="small">This usually takes 20–60 seconds.</p></div>`;
  const ticker = setInterval(() => { const l = $('#loadLine'); if (l) l.textContent = LOADING_LINES[++i % LOADING_LINES.length]; }, 4000);

  const fd = new FormData();
  if (state.photo) fd.append('photo', state.photo);
  const { photo, photoUrl, step, ...answers } = state;
  fd.append('answers', JSON.stringify(answers));

  try {
    const res = await fetch('/api/generate', { method: 'POST', body: fd });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
    showResult(data);
  } catch (e) {
    els.body.innerHTML = `<div class="loading"><h2>We couldn't create your design</h2><p>${esc(e.message)}</p><div class="actions" style="justify-content:center"><button class="btn-primary" id="retry">Try again</button></div></div>`;
    $('#retry').addEventListener('click', () => { state.step = TOTAL - 1; render(); });
  } finally {
    clearInterval(ticker);
  }
}

function showResult(d) {
  els.count.textContent = 'Your design';
  els.progress.innerHTML = Array.from({ length: TOTAL }, () => '<span class="done"></span>').join('');

  const visual = d.beforeUrl && !d.fallback
    ? `<div class="compare" id="compare">
        <img src="${d.imageUrl}" alt="Your new kitchen design"/>
        <img class="before" src="${d.beforeUrl}" alt="Your kitchen today"/>
        <div class="handle"></div><span class="tag l">Before</span><span class="tag r">After</span>
      </div><p class="small">Drag across the image to compare before and after.</p>`
    : `<div class="single"><img src="${d.imageUrl}" alt="Kitchen design"/></div>`;

  const flag = d.fallback
    ? `<div class="flag">Example image — our AI render was unavailable just now. Your designer will prepare one for you.</div>`
    : !d.beforeUrl ? `<div class="flag">This is an example in your chosen style. Upload a photo to see <b>your own kitchen</b> transformed.</div>` : '';

  els.body.innerHTML = `
    <div class="eyebrow">Your design</div><h2>Your kitchen concept</h2>
    <p class="lede">Here's your space reimagined with the choices you made.</p>
    ${flag}${visual}
    <div class="result-cols">
      <div class="panel"><div class="price">${esc(d.price.label)}</div>
        <div class="small">Indicative range based on your budget</div>
        <div class="small">Your detailed estimate will be confirmed with your quote.</div></div>
      <div class="panel"><h4>Specification</h4><div class="spec">${d.spec.map(([k, v]) => `<div><span>${esc(k)}</span><span>${esc(v)}</span></div>`).join('')}</div></div>
    </div>
    <div class="actions">
      <a class="btn-primary" href="${d.designPackUrl}">Download Design Pack</a>
      <a class="btn-ghost" href="${d.imageUrl}" download>Save image</a>
      <button class="btn-ghost" id="again" type="button">Try another style</button>
    </div>`;

  const cmp = $('#compare');
  if (cmp) {
    const before = $('.before', cmp), handle = $('.handle', cmp);
    const move = (x) => {
      const r = cmp.getBoundingClientRect();
      const p = Math.max(0, Math.min(100, ((x - r.left) / r.width) * 100));
      before.style.clipPath = `inset(0 ${100 - p}% 0 0)`; handle.style.left = p + '%';
    };
    cmp.addEventListener('pointerdown', (e) => { cmp.setPointerCapture(e.pointerId); move(e.clientX); });
    cmp.addEventListener('pointermove', (e) => e.buttons && move(e.clientX));
  }
  // Keep photo, measurements and contact details; go back to the style step.
  $('#again').addEventListener('click', () => { state.step = 1; render(); });
}

// ---------- Boot ----------

(async function init() {
  try {
    opts = await (await fetch('/api/options')).json();
    state.budget = opts.budget.default;
    if (opts.brand) $('#brandName').textContent = opts.brand;
    render();
  } catch {
    els.body.innerHTML = '<p>Could not load the design studio. Please refresh.</p>';
  }
})();
