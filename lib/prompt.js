import { STYLES, COLOURS, WORKTOPS, PRIORITIES, MUST_HAVES } from './options.js';

// ============================================================================
// Kitchen prompt builder for the image model (Bedrock / Stability).
// Walks through every wizard step and turns each answer into concrete,
// visual instructions. The most important parts (layout + must-haves) come
// first, because image models pay most attention to the start of a prompt.
// ============================================================================

// ---- Step 2: style -> what the cabinets actually look like ----
const STYLE_DETAIL = {
  modern: 'modern handleless kitchen: flat slab cabinet doors with no visible handles (integrated finger pulls), seamless tall units, clean straight lines, integrated appliances, minimal detailing',
  traditional: 'warm traditional kitchen: raised-panel cabinet doors, decorative cornice along the top of the wall units, a mantel-style range hood over the cooker, ornate brass cup handles and knobs',
  contemporary: 'bold contemporary kitchen: matte slab cabinet doors, a statement veined stone splashback, slim brushed brass handles and accents, tall units with integrated ovens',
  shaker: 'timeless shaker kitchen: five-piece shaker doors with a recessed centre panel, simple knobs and cup handles, a framed range hood, classic proportions',
};

// ---- Step 3: colour -> cabinet, wall and accent colours ----
const COLOUR_DETAIL = {
  light: 'soft white and pale stone painted cabinets, light walls, bright and airy',
  neutral: 'warm neutral cabinets in sand, oatmeal and soft taupe, with natural oak accents',
  dark: 'deep charcoal and near-black cabinets, moody and dramatic, warm accent lighting',
  twotone: 'two-tone cabinets: light upper wall units with dark base units, or a dark contrasting island',
};

// ---- Step 4: worktop -> material, edge and matching splashback ----
const WORKTOP_DETAIL = {
  quartz: 'polished white quartz worktops with subtle grey veining and a matching quartz upstand',
  granite: 'polished natural granite worktops with speckled mineral texture',
  laminate: 'stone-effect laminate worktops with a square edge',
  wood: 'solid oak butcher-block worktops with a warm oiled finish',
};

// ---- Step 5: priority -> visible features that express it ----
const PRIORITY_DETAIL = {
  storage: 'plenty of storage: floor-to-ceiling tall larder units, deep pan drawers and wall cabinets up to the ceiling',
  entertaining: 'sociable layout: seating with bar stools, open space to move around, a generous worktop for serving',
  cooking: 'serious cooking zone: a range cooker with a large extractor hood, long uninterrupted prep worktop, utensil rail',
  aesthetics: 'showpiece design: symmetrical layout, feature lighting, premium finishes and styled open display',
};

// ---- Step 6: must-haves -> each item with WHERE it goes ----
const MUST_HAVE_DETAIL = {
  island: 'a freestanding kitchen island in the middle of the floor with worktop and bar stools',
  breakfastBar: 'a breakfast bar with an overhanging worktop and two or three bar stools',
  belfast: 'a white ceramic Belfast farmhouse sink, under the window if there is one',
  integrated: 'fully integrated appliances hidden behind matching cabinet doors',
  pantry: 'a tall larder pantry cupboard',
  lighting: 'statement pendant lights hanging above the island or worktop',
  wine: 'a built-in wine rack or glass-fronted wine cooler',
  shelving: 'open floating wooden shelves with styled crockery',
  boilingTap: 'a modern boiling water tap at the sink',
};

// ---- Step 1: budget -> finish quality ----
function finishLevel(budget) {
  if (budget < 10000) return 'simple, good-value finishes';
  if (budget < 25000) return 'quality mid-range finishes';
  if (budget < 40000) return 'high-end finishes with crafted details';
  return 'luxury bespoke finishes, handmade cabinetry and premium appliances';
}

/**
 * Step 1: measurements -> realistic layout.
 * Rules of thumb: an island needs roughly 1m clearance around it, so it needs the
 * room's shorter side to be about 3m+. Narrow rooms become galleys.
 */
export function chooseLayout(a) {
  const wantsIsland = a.mustHaves.includes('island');
  const wantsBar = a.mustHaves.includes('breakfastBar');
  const w = Number(a.width) || null;
  const d = Number(a.depth) || null;
  let layout, island = wantsIsland, note = '';

  if (w && d) {
    const short = Math.min(w, d);
    const long = Math.max(w, d);
    if (short < 2.5) {
      layout = 'galley kitchen with units running along the two long walls';
      if (wantsIsland) { island = false; note = 'Room is too narrow for an island, so a breakfast bar is used instead.'; }
    } else if (short < 3.0 && wantsIsland) {
      layout = 'L-shaped kitchen along the back wall and one side wall';
      island = false;
      note = 'Room is a little tight for a freestanding island, so a peninsula with seating is used instead.';
    } else if (long >= 5 && short >= 3.5) {
      layout = 'U-shaped kitchen around the walls';
    } else {
      layout = 'L-shaped kitchen along the back wall and one side wall';
    }
  } else {
    layout = 'L-shaped kitchen along the back wall and one side wall';
  }

  if (island) layout += ', plus a freestanding island in the centre of the floor';
  else if (wantsIsland || wantsBar) layout += ', with a peninsula breakfast bar and stools';

  return { layout, island, seating: island || wantsIsland || wantsBar, note };
}

/**
 * The main prompt for the image model, built step by step from the customer's answers.
 * Returns { text, negativeText, layout } — layout is reused by the photo planner.
 */
export function buildKitchenPrompt(a, hasPhoto) {
  const layout = chooseLayout(a);
  const mustHaves = a.mustHaves
    .filter((m) => !(m === 'island' && !layout.island)) // swapped for a peninsula above
    .map((m) => MUST_HAVE_DETAIL[m] || MUST_HAVES[m]?.prompt)
    .filter(Boolean);

  const parts = [
    // What it is
    hasPhoto
      ? (a.roomType === 'empty'
          ? 'A complete newly fitted kitchen installed in this empty room.'
          : 'This kitchen fully renovated with a complete new fitted kitchen.')
      : 'A complete newly fitted UK home kitchen, wide-angle photo from the doorway.',
    // Step 1: layout from measurements (most important for "full kitchen")
    `Layout: ${layout.layout}, with base units and wall units running the full length of the walls.`,
    // Step 6: must-haves, weighted so they are not dropped
    mustHaves.length ? `Must include: ${mustHaves.map((m) => `(${m}:1.2)`).join(', ')}.` : '',
    // Step 2: style
    `Style: ${a.style ? STYLE_DETAIL[a.style] || STYLES[a.style].prompt : 'a tasteful, current fitted kitchen'}.`,
    // Step 3: colour
    `Colours: ${a.colour ? COLOUR_DETAIL[a.colour] || COLOURS[a.colour].prompt : 'a balanced, timeless palette'}.`,
    // Step 4: worktop
    `Worktops: ${a.worktop ? WORKTOP_DETAIL[a.worktop] || WORKTOPS[a.worktop].prompt : 'quartz worktops'}.`,
    // Step 5: priority
    a.priority ? `Focus: ${PRIORITY_DETAIL[a.priority] || PRIORITIES[a.priority].prompt}.` : '',
    // Step 1: budget
    `Quality: ${finishLevel(a.budget)}.`,
    // Photo quality
    'Professional interior photograph, natural daylight, realistic materials and shadows, sharp focus, magazine quality.',
  ].filter(Boolean);

  return {
    text: parts.join(' '),
    negativeText:
      'half-finished kitchen, partial kitchen, empty room, bare walls, missing cabinets, floating cabinets, ' +
      'distorted cabinets, warped perspective, duplicated appliances, people, text, logos, watermark, clutter, ' +
      'blurry, low quality, cartoon, illustration, 3d render',
    layout,
  };
}

// Old name kept so existing imports keep working.
export const buildNovaPrompt = buildKitchenPrompt;

/**
 * Prompt for the OpenAI provider (instruction-style editing model).
 * hasPhoto = true  -> instructions for editing the customer's photo (keep the room, change the kitchen)
 * hasPhoto = false -> instructions for generating an example kitchen from scratch
 */
export function buildPrompt(a, hasPhoto) {
  const { text } = buildKitchenPrompt(a, hasPhoto);
  if (!hasPhoto) return `${text} No people, no text, no logos, no watermarks.`;
  return [
    a.roomType === 'empty'
      ? 'This photo shows an empty room. Install a complete new fitted kitchen into it.'
      : 'This photo shows an existing kitchen. Replace the cabinetry, worktops, splashback, appliances and lighting with a completely new kitchen.',
    'Keep the room itself exactly as photographed: the same camera position, angle and lens, the same walls, windows, doors, ceiling height, flooring and perspective.',
    text,
    'No people, no text, no logos, no watermarks.',
  ].join(' ');
}