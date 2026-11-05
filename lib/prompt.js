import { STYLES, COLOURS, WORKTOPS, PRIORITIES, MUST_HAVES } from './options.js';

// ============================================================================
// Kitchen prompt builder for the image model (Bedrock / Stability).
// Walks through every wizard step and turns each answer into concrete,
// visual instructions. The most important parts (layout + must-haves) come
// first, because image models pay most attention to the start of a prompt.
// ============================================================================

// ---- Step 2: style -> what the cabinets actually look like ----
const STYLE_DETAIL = {
  modern: 'modern kitchen: (smooth flat slab cabinet doors:1.4), recessed J-pull grooves and push-to-open, seamless tall units, clean straight lines, integrated appliances, minimal detailing',
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
  wine: 'a built-in glass-door wine cooler with lit wooden bottle racks, set into the end of the island (or a tall glass-door wine cabinet in the units if there is no island)',
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
    negativeText: [
      'half-finished kitchen, partial kitchen, empty room, bare walls, missing cabinets, floating cabinets, ' +
      'distorted cabinets, warped perspective, duplicated appliances, people, text, logos, watermark, clutter, ' +
      'blurry, low quality, cartoon, illustration, 3d render',
      STYLE_SPEC[a.style]?.neg, COLOUR_SPEC[a.colour]?.neg, WORKTOP_SPEC[a.worktop]?.neg,
    ].filter(Boolean).join(', '),
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

// ============================================================================
// Prompts for editing the customer's PHOTO (two inpainting passes + one finishing pass).
//
// EVERY wizard selection becomes two things:
//   pos -> what to draw (put first, weighted with (text:1.3) so the model doesn't drop it)
//   neg -> what NOT to draw, in the negative prompt.
// The negative part matters: image models don't understand "no" or "-less" in the prompt.
// "handleless doors" still contains the word "handle", so the model draws handles.
// The only reliable way to stop that is putting "handles, knobs" in the NEGATIVE prompt.
//
//   units  -> wall cabinets, worktops, appliances (pass 1)
//   centre -> island / peninsula breakfast bar (pass 2)
//   full   -> everything, for the finishing pass that redraws the whole picture
// `room` is the planner's description of the walls, ceiling and floor to keep matching.
// ============================================================================

// Step 2: style -> doors and hardware
const STYLE_SPEC = {
  modern: {
    doors: '(smooth flat slab cabinet doors:1.4), (recessed J-pull grooves, push-to-open:1.3), seamless flush fronts',
    walls: 'integrated appliances',
    neg: 'door handles, bar handles, knobs, pulls, cabinet hardware, raised panel doors, shaker doors, cornice, ornate',
  },
  traditional: {
    doors: '(traditional raised-panel cabinet doors:1.3), (brass cup handles and knobs:1.2)',
    walls: 'decorative cornice on the wall cabinets, mantel-style range hood',
    neg: 'flat slab doors, handleless, high gloss, minimalist',
  },
  contemporary: {
    doors: '(matte flat slab cabinet doors:1.3), (slim brushed brass bar handles:1.2)',
    walls: 'statement veined stone splashback',
    neg: 'shaker doors, raised panel doors, ornate, cup handles, knobs',
  },
  shaker: {
    doors: '(shaker cabinet doors with a recessed centre panel:1.3), (simple knobs and cup handles:1.2)',
    walls: 'framed range hood',
    neg: 'flat slab doors, handleless, high gloss, minimalist',
  },
};
const DEFAULT_STYLE = { doors: 'shaker cabinet doors with simple handles', walls: '', neg: '' };

// Step 3: colour -> cabinet colour
const COLOUR_SPEC = {
  light: { cab: '(soft white cabinets:1.3)', island: '(soft white island cabinets:1.3)', neg: 'dark cabinets, black cabinets, grey cabinets, wooden cabinets' },
  neutral: { cab: '(warm sand and taupe cabinets:1.3) with natural oak accents', island: '(warm taupe island cabinets:1.3)', neg: 'white cabinets, black cabinets, blue cabinets' },
  dark: { cab: '(deep charcoal near-black cabinets:1.3)', island: '(deep charcoal island cabinets:1.3)', neg: 'white cabinets, light cabinets, cream cabinets, wooden cabinets' },
  twotone: { cab: '(two-tone: soft white wall cabinets and dark navy base cabinets:1.3)', island: '(dark navy island cabinets:1.3)', neg: 'all white cabinets, single colour cabinets' },
};
const DEFAULT_COLOUR = { cab: 'painted cabinets', island: 'painted island cabinets', neg: '' };

// Step 4: worktop
const WORKTOP_SPEC = {
  quartz: { top: '(white quartz worktop with subtle grey veining:1.3)', neg: 'wooden worktop, butcher block, granite, black worktop' },
  granite: { top: '(polished speckled granite worktop:1.3)', neg: 'wooden worktop, butcher block, plain white worktop' },
  laminate: { top: '(stone-effect laminate worktop with a square edge:1.3)', neg: 'wooden worktop, butcher block' },
  wood: { top: '(solid oak butcher-block worktop:1.3)', neg: 'stone worktop, marble, quartz, granite, white worktop' },
};
const DEFAULT_WORKTOP = { top: 'white quartz worktop', neg: '' };

// Step 5: priority -> visible features (wall units) and seating (centre)
const PRIORITY_SPEC = {
  storage: { units: '(tall floor-to-ceiling larder units:1.2), wall cabinets up to the ceiling, deep pan drawers', centre: '', neg: 'open shelves' },
  entertaining: { units: 'under-cabinet LED lighting', centre: '(four bar stools at the worktop overhang:1.3)', neg: '' },
  cooking: { units: '(range cooker with a large extractor hood:1.3), long clear prep worktop', centre: '', neg: '' },
  aesthetics: { units: '(glass-fronted display cabinets with interior lighting:1.2), symmetrical layout, under-cabinet LED lighting', centre: '', neg: '' },
};

// Step 6: must-haves on the walls (island, breakfast bar, lighting and wine go in the centre pass when there is one)
const WALL_SPEC = {
  belfast: { pos: '(white ceramic Belfast sink with an apron front:1.3)', neg: 'stainless steel sink' },
  integrated: { pos: '(fully integrated appliances hidden behind matching cabinet doors:1.3)', neg: 'freestanding fridge, american fridge freezer' },
  pantry: { pos: '(tall larder pantry cupboard:1.2)', neg: '' },
  shelving: { pos: '(open floating oak shelves with a few plates:1.2)', neg: '' },
  boilingTap: { pos: '(modern boiling water tap at the sink:1.2)', neg: '' },
};

// Step 1: budget -> finish
const FINISH = (budget) =>
  budget < 10000 ? 'simple good-value finish' : budget < 25000 ? 'quality mid-range finish' : budget < 40000 ? 'high-end finish' : 'luxury bespoke finish';

const KEEP_ROOM = (room) => `Same ${room || 'walls, ceiling and floor as the photo'}.`;
const PHOTO_END = 'Tidy worktops with very few accessories. Photorealistic interior photo, natural light, sharp focus.';
const BASE_NEG = 'old furniture, people, text, watermark, distorted, warped perspective, blurry, cartoon, 3d render, ' +
  'objects in the foreground, giant tap, floating objects, cut-off furniture, clutter, curtains under the sink, fabric, new flooring';

export function buildPhotoPrompts(a, room) {
  const layout = chooseLayout(a);
  const style = STYLE_SPEC[a.style] || DEFAULT_STYLE;
  const colour = COLOUR_SPEC[a.colour] || DEFAULT_COLOUR;
  const worktop = WORKTOP_SPEC[a.worktop] || DEFAULT_WORKTOP;
  const priority = PRIORITY_SPEC[a.priority] || { units: '', centre: '', neg: '' };
  const has = (m) => a.mustHaves.includes(m);
  const hasCentre = layout.island || layout.seating;
  const wantsWine = has('wine');

  // ---- Pass 1: wall units ----
  const wallItems = [
    priority.units,
    ...a.mustHaves.map((m) => WALL_SPEC[m]?.pos).filter(Boolean),
    wantsWine && !hasCentre ? '(one tall glass-door wine cabinet with lit wooden racks:1.2) built into the units' : '',
    has('lighting') && !hasCentre ? '(statement pendant lights:1.2) above the worktop' : '',
  ].filter(Boolean);

  const units = [
    `Fitted kitchen, ${colour.cab}, ${style.doors}, ${worktop.top}${style.walls ? `, ${style.walls}` : ''}.`,
    '(Base cabinets with a continuous worktop at waist height along the walls:1.2), splashback, wall cabinets above.',
    wallItems.length ? `${wallItems.join(', ')}.` : '',
    `${FINISH(a.budget)}.`,
    KEEP_ROOM(room),
    PHOTO_END,
  ].filter(Boolean).join(' ');

  // ---- Pass 2: island / peninsula (same doors, colour and worktop as the units) ----
  let centre = null;
  let items = '';
  if (hasCentre) {
    // The must-haves go FIRST and weighted: the model pays most attention to the start of the prompt,
    // and items left at the end (wine, stools) were being dropped.
    const what = layout.island
      ? '(freestanding kitchen island standing in the middle of the floor, with open floor all around it:1.4)'
      : '(peninsula breakfast bar with a worktop overhang:1.4)';
    items = [
      what,
      priority.centre || '(three bar stools at the worktop overhang:1.3)',
      wantsWine ? '(built-in glass-door wine cooler with lit wooden racks in the end of the island:1.3)' : '',
      has('lighting') ? '(statement pendant lights hanging above it:1.2)' : '',
    ].filter(Boolean).join(', ');
    centre = `${items}. ${colour.island}, ${style.doors}, ${worktop.top}, soft shadow on the floor. ${KEEP_ROOM(room)} ${PHOTO_END}`;
  }

  // ---- Negative prompt: everything that contradicts the selections ----
  const negative = [
    BASE_NEG,
    style.neg,
    colour.neg,
    worktop.neg,
    priority.neg,
    ...a.mustHaves.map((m) => WALL_SPEC[m]?.neg),
    hasCentre ? 'island touching the back wall, island joined to the wall units' : 'kitchen island, bar stools',
    has('lighting') ? '' : 'pendant lights',
    wantsWine ? 'row of wine fridges, loose wine bottles on the worktop, wine bottles on shelves' : 'wine fridge, wine cooler, wine rack',
  ].filter(Boolean).join(', ');

  // ---- Final "finishing" pass over the whole picture (see harmonise() in providers/bedrock.js) ----
  // One prompt with everything, so the AI redraws the full image as one consistent photo:
  // real floor reflections and shadows, matching light, sharp detail everywhere.
  const full = [
    items ? `${items}.` : '',
    `Complete fitted kitchen, ${colour.cab}, ${style.doors}, ${worktop.top}${style.walls ? `, ${style.walls}` : ''}.`,
    '(Base cabinets with a continuous worktop along the walls:1.2), splashback, wall cabinets above.',
    wallItems.length ? `${wallItems.join(', ')}.` : '',
    `${FINISH(a.budget)}.`,
    KEEP_ROOM(room),
    '(Realistic floor with soft reflections and contact shadows under the cabinets and island:1.2), warm under-cabinet lighting, even daylight.',
    'Tidy worktops. Professional interior photography, photorealistic, high detail, sharp focus.',
  ].filter(Boolean).join(' ');

  return {
    units,
    full,
    centre, // null when no island / peninsula
    clear: `Empty open floor. ${KEEP_ROOM(room)} ${PHOTO_END}`, // where old furniture stood, when no island
    negative,
    layout,
  };
}