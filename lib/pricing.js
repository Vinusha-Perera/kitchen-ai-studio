import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { STYLES, COLOURS, WORKTOPS, PRIORITIES, MUST_HAVES } from './options.js';

// ============================================================================
// Pricing in the same format as the existing PGK Design Pack:
//
//   £13,500 – £18,300                Supply estimate (ex. installation)
//   Cabinetry (contemporary)   £5,400
//   Worktop (Granite)          £2,626
//   Appliances (Bosch/Neff Mix)£2,800
//   Extras                     £2,450
//   VAT (on supply)            £2,655
//   Estimated supply total    £15,931
//   Installation estimate      £2,640   (separate, not in the range)
//
// Formula (gives exactly the numbers above for £15,000 budget, contemporary,
// granite, island + wine storage, 4.5m x 3.2m):
//   cabinetry    = budget x 36% x style factor            (rounded to £100)
//   worktop      = budget x 17% x worktop priceFactor     (whole pounds)
//   appliances   = tier from the budget (brand + price)
//   extras       = fixed price for each must-have
//   VAT          = 20% of the four lines above
//   supply total = lines + VAT
//   range        = supply total -15% / +15%                (rounded to £100)
//   installation = £1,200 + £100 per sqm of room           (12 sqm assumed if no size)
//
// Optional AI pricing (PRICING_AI=on): Claude estimates the four supply lines and the
// installation; each must stay within 0.5x-2x of the formula line or the formula is used.
// VAT, total and range are always calculated here, so the maths always adds up.
// ============================================================================

const VAT_RATE = 0.2;
const RANGE = 0.15;
const DEFAULT_AREA = 12;

const STYLE_FACTOR = { modern: 1.0, contemporary: 1.0, shaker: 0.95, traditional: 1.1 };
const STYLE_NAME = { modern: 'modern', contemporary: 'contemporary', shaker: 'shaker', traditional: 'traditional' };

const APPLIANCE_TIERS = [
  { upTo: 10000, brand: 'Beko/Hotpoint', price: 1600 },
  { upTo: 25000, brand: 'Bosch/Neff Mix', price: 2800 },
  { upTo: 40000, brand: 'Neff/Siemens', price: 4500 },
  { upTo: Infinity, brand: 'Miele/Gaggenau', price: 7500 },
];

// What each must-have adds (supply only).
const EXTRA_PRICE = {
  island: 1650,
  breakfastBar: 650,
  belfast: 450,
  integrated: 400,
  pantry: 900,
  lighting: 350,
  wine: 800,
  shelving: 250,
  boilingTap: 650,
};

const fmt = (n) => Math.round(n).toLocaleString('en-GB');
const money = (n) => `£${fmt(n)}`;
const round100 = (n) => Math.round(n / 100) * 100;
const round10 = (n) => Math.round(n / 10) * 10;

const areaOf = (a) => {
  const w = Number(a.width), d = Number(a.depth);
  return w > 0 && d > 0 ? Math.round(w * d * 10) / 10 : null;
};
const applianceTier = (budget) => APPLIANCE_TIERS.find((t) => budget < t.upTo);

/** The four supply lines + installation from the formula. */
function formulaLines(a) {
  const style = a.style || 'modern';
  const worktopKey = a.worktop || 'quartz';
  const area = areaOf(a) ?? DEFAULT_AREA;
  const tier = applianceTier(a.budget);
  return {
    cabinetry: round100(a.budget * 0.36 * (STYLE_FACTOR[style] ?? 1)),
    worktop: Math.floor(a.budget * 0.17 * (WORKTOPS[worktopKey]?.priceFactor ?? 1)),
    appliances: tier.price,
    extras: a.mustHaves.reduce((sum, m) => sum + (EXTRA_PRICE[m] || 0), 0),
    installation: round10(1200 + 100 * area),
    applianceBrand: tier.brand,
  };
}

/** Turn the lines into the full price object used by the results page and the Design Pack. */
function build(a, l, note, source) {
  const style = a.style || 'modern';
  const worktopKey = a.worktop || 'quartz';
  const subtotal = l.cabinetry + l.worktop + l.appliances + l.extras;
  const vat = Math.round(subtotal * VAT_RATE);
  const total = subtotal + vat;
  const low = round100(total * (1 - RANGE));
  const high = round100(total * (1 + RANGE));
  const area = areaOf(a);

  const lines = [
    { label: `Cabinetry (${STYLE_NAME[style]})`, value: money(l.cabinetry) },
    { label: `Worktop (${WORKTOPS[worktopKey]?.label || 'Quartz'})`, value: money(l.worktop) },
    { label: `Appliances (${l.applianceBrand})`, value: money(l.appliances) },
    { label: 'Extras', value: money(l.extras) },
    { label: 'VAT (on supply)', value: money(vat) },
  ];

  return {
    low,
    high,
    label: `${money(low)} – ${money(high)}`,
    sub: 'Supply estimate (ex. installation)',
    lines,
    total: { label: 'Estimated supply total', value: money(total) },
    installation: { label: 'Installation estimate', value: money(l.installation), note: 'Installation is finalised directly with the team.' },
    notes: [
      area ? `Guide pricing for a ${Math.round(area)} sqm kitchen. Final cost confirmed by our team.` : 'Guide pricing. Final cost confirmed by our team.',
      note || 'Estimate based on your original selections. Refinements may change the final cost.',
    ],
    breakdown: lines, // older pages read this
    note: note || 'Estimate based on your original selections. Refinements may change the final cost.',
    source, // 'ai' | 'formula'
  };
}

/** Formula pricing (always available, no AI). */
export function estimatePrice(a) {
  return build(a, formulaLines(a), null, 'formula');
}

// ---------------- AI pricing (Claude on Bedrock), optional ----------------

const PRICING_MODEL = () => process.env.PRICING_MODEL_ID || process.env.MODEL_ID || '';
let client;
const getClient = () =>
  (client ??= new BedrockRuntimeClient({ region: process.env.AWS_REGION || 'us-west-2' }));

function describe(a) {
  const lbl = (table, key) => (key ? table[key].label : 'not specified');
  const area = areaOf(a);
  const dims = area ? `${a.width}m x ${a.depth}m (${area} sqm)${a.ceiling ? `, ${a.ceiling}m ceiling` : ''}` : 'not specified';
  return [
    `Room: ${a.roomType === 'empty' ? 'empty room (new build)' : 'existing kitchen (replacement)'}`,
    `Size: ${dims}`,
    `Budget: £${fmt(a.budget)}`,
    `Style: ${lbl(STYLES, a.style)}`,
    `Colour: ${lbl(COLOURS, a.colour)}`,
    `Worktop: ${lbl(WORKTOPS, a.worktop)}`,
    `Priority: ${lbl(PRIORITIES, a.priority)}`,
    `Must-haves: ${a.mustHaves.length ? a.mustHaves.map((m) => MUST_HAVES[m].label).join(', ') : 'none'}`,
    `Appliance range: ${applianceTier(a.budget).brand}`,
  ].join(' | ');
}

// No example numbers: the model would copy them instead of estimating.
const PROMPT = (a) =>
  'You are a UK kitchen designer. Estimate realistic UK SUPPLY prices (ex. VAT, ex. installation) for this kitchen, ' +
  'plus a separate installation estimate. Extras = the must-haves (island, wine cooler, sink, etc).\n' +
  `${describe(a)}\n` +
  'Return ONLY valid JSON, no other text, whole pounds:\n' +
  '{"cabinetry":<number>,"worktop":<number>,"appliances":<number>,"extras":<number>,"installation":<number>,' +
  '"notes":"<one honest UK-market sentence about this kitchen>"}';

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(String(v).replace(/[£,\s]/g, '')));

/** Validate the AI's answer against the formula; anything unrealistic returns null. */
function parseAi(raw, a) {
  const json = raw?.match(/\{[\s\S]*\}/)?.[0];
  if (!json) return null;
  const d = JSON.parse(json);
  const f = formulaLines(a);
  const out = { applianceBrand: f.applianceBrand };
  for (const key of ['cabinetry', 'worktop', 'appliances', 'extras', 'installation']) {
    const v = num(d[key]);
    if (key === 'extras' && f.extras === 0) { out.extras = 0; continue; }
    if (!Number.isFinite(v) || v < f[key] * 0.5 || v > f[key] * 2) return null;
    out[key] = Math.round(v);
  }
  const note = typeof d.notes === 'string' && d.notes.trim() ? d.notes.trim().replace(/\s+/g, ' ').slice(0, 240) : null;
  return build(a, out, note, 'ai');
}

/**
 * Price for the results page and Design Pack.
 * Formula by default; Claude's estimate when PRICING_AI=on and a model is configured.
 */
export async function getPrice(a) {
  const modelId = PRICING_MODEL();
  if (!modelId || String(process.env.PRICING_AI).toLowerCase() !== 'on') return estimatePrice(a);
  try {
    const res = await getClient().send(
      new ConverseCommand({
        modelId,
        messages: [{ role: 'user', content: [{ text: PROMPT(a) }] }],
        inferenceConfig: { maxTokens: 300, temperature: 0.2 },
      }),
      { abortSignal: AbortSignal.timeout(20_000) }
    );
    const text = res.output?.message?.content?.find((c) => c.text)?.text;
    const price = parseAi(text, a);
    if (price) return price;
    console.error('[pricing] AI estimate was unusable, using formula');
  } catch (e) {
    console.error('[pricing] AI pricing failed, using formula:', e.message);
  }
  return estimatePrice(a);
}