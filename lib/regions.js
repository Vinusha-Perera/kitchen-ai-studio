import sharp from 'sharp';

// ============================================================================
// Turn a segmentation (every pixel labelled) into the edit masks:
//   PROTECTED — the room shell: walls (except where new units go), floor, ceiling, beams,
//               doors, windows, light fittings. Original pixels are composited back at the end,
//               so these stay pixel-identical to the customer's photo.
//   UNITS     — every old furniture/kitchen pixel (anything that is not room structure), plus a
//               band of wall from the floor line up to where wall cabinets end. The band follows
//               the real wall/floor boundary column by column, so it follows the wall's perspective.
//   ISLAND    — the island spot on the floor (worked out from the floor, see islandFromFloor).
// ============================================================================

// ADE20K labels that belong to the building itself (never treated as old furniture).
const STRUCTURE = new Set([
  'wall', 'floor', 'ceiling', 'windowpane', 'door', 'screen door', 'column', 'stairs', 'stairway', 'step',
  'light', 'chandelier', 'sconce', 'sky', 'tree', 'building', 'curtain', 'blind', 'railing', 'bannister',
  'fireplace', 'radiator', 'house', 'grass', 'skyscraper', 'awning',
  // Kept as they are: repainting them changed the ceiling colour and turned tiled floors into wood.
  'lamp', 'rug',
]);
// Never painted, in any pass.
const OPENINGS = new Set(['windowpane', 'door', 'screen door', 'curtain', 'blind']);
// Curtains/blinds only count as a window covering in the top part of the photo. Lower down they are
// fabric skirts under the old worktop (old kitchen stuff), so they get replaced.
const COVERINGS = new Set(['curtain', 'blind']);
const COVERING_LINE = 0.55;

// Wall band: from the floor line up to 80% of the wall height. A band all the way to the ceiling made the
// model fill every wall with floor-to-ceiling tall units (no worktop run). 80% leaves a strip of the real
// wall above the wall cabinets, like a real kitchen. The seam is sharp because the mask edge is tiny (SEG_GROW_MASK).
const UNIT_HEIGHT = Math.min(1, Math.max(0.5, Number(process.env.WALL_BAND) || 0.8));
// Columns where the wall reaches the bottom of the photo are wall running towards the camera.
// Painting units there gives giant close-up objects in the foreground (e.g. a huge tap), so skip them.
const FOREGROUND_LINE = 0.93;
// Small margin around the island spot: enough to hold its worktop and feet, small enough that the island
// pass doesn't repaint the back wall behind it (that made the island look pasted on).
const ISLAND_MARGIN_X = 0.03;
const ISLAND_MARGIN_TOP = 0.04;
const ISLAND_MARGIN_BOTTOM = 0.04;

/** Grow a 0/255 mask by roughly `px` pixels (blur + threshold). */
async function dilate(mask, width, height, px) {
  if (px < 1) return mask;
  const out = await sharp(Buffer.from(mask), { raw: { width, height, channels: 1 } })
    .blur(Math.max(0.3, px / 2))
    .threshold(8)
    .extractChannel(0) // sharp outputs 3 channels after blur; keep one so the mask lines up with the photo
    .raw()
    .toBuffer();
  return new Uint8Array(out);
}

/**
 * @param seg     { width, height, labels, names } from segmentPhoto
 * @param island  { x0, y0, x1, y1 } in 0..1, or null
 * @returns { units, island, editable, openings } — Uint8Array masks (0 / 255) at the photo's size
 */
export async function buildRegions(seg, island) {
  const { width: W, height: H, labels, names } = seg;
  const size = W * H;
  const isWall = names.map((n) => n === 'wall');
  const isStructure = names.map((n) => STRUCTURE.has(n));
  const isOpening = names.map((n) => OPENINGS.has(n));
  const isCovering = names.map((n) => COVERINGS.has(n));

  const units = new Uint8Array(size);
  let openings = new Uint8Array(size);

  // 1. Old furniture: everything that isn't part of the building.
  for (let i = 0; i < size; i++) {
    const l = labels[i];
    if (l < 0) continue;
    if (isCovering[l] && i >= W * Math.round(H * COVERING_LINE)) { units[i] = 255; continue; } // skirt under a worktop
    if (isOpening[l]) openings[i] = 255;
    else if (!isStructure[l]) units[i] = 255;
  }

  // 2. Wall band for the new fitted units, following the real wall/floor line in each column.
  for (let x = 0; x < W; x++) {
    let top = -1, bottom = -1;
    for (let y = 0; y < H; y++) {
      const l = labels[y * W + x];
      if (l >= 0 && isWall[l]) { if (top < 0) top = y; bottom = y; }
    }
    if (top < 0 || bottom - top < H * 0.05) continue;
    if (bottom >= H * FOREGROUND_LINE) continue; // wall coming towards the camera: leave it as it is
    const from = Math.round(bottom - (bottom - top) * UNIT_HEIGHT);
    const to = Math.min(H - 1, bottom + Math.round(H * 0.01)); // a little into the floor for the plinth
    for (let y = from; y <= to; y++) units[y * W + x] = 255;
  }

  // 3. Island spot.
  const islandMask = new Uint8Array(size);
  if (island) {
    const x0 = Math.max(0, Math.round((island.x0 - ISLAND_MARGIN_X) * W)), x1 = Math.min(W, Math.round((island.x1 + ISLAND_MARGIN_X) * W));
    const y0 = Math.max(0, Math.round((island.y0 - ISLAND_MARGIN_TOP) * H)), y1 = Math.min(H, Math.round((island.y1 + ISLAND_MARGIN_BOTTOM) * H));
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) islandMask[y * W + x] = 255;
  }

  // Grow the furniture/units area a little to catch edges and shadows; openings stay protected.
  const grown = await dilate(units, W, H, Math.round(W * 0.012));
  openings = await dilate(openings, W, H, Math.round(W * 0.004));
  const unitsFinal = new Uint8Array(size);
  const islandFinal = new Uint8Array(size);
  const editable = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    if (openings[i]) continue;
    if (islandMask[i]) islandFinal[i] = 255;
    else if (grown[i]) unitsFinal[i] = 255;
    if (islandFinal[i] || unitsFinal[i]) editable[i] = 255;
  }
  return { units: unitsFinal, island: islandFinal, editable, openings };
}

/**
 * Where the island goes, worked out from the photo itself: find where the back wall meets the floor
 * in the middle of the photo, then place the island in the open floor IN FRONT of that line, leaving
 * a walkway. Its top extends a little above the line because the island stands ~0.9m tall.
 * Returns { x0, y0, x1, y1 } in 0..1, or null if there isn't enough floor in view.
 */
export function islandFromFloor(seg) {
  const { width: W, height: H, labels, names } = seg;
  const isWall = names.map((n) => n === 'wall');
  const isFloor = names.map((n) => n === 'floor' || n === 'rug');
  const lines = [];
  for (let x = Math.round(W * 0.4); x <= Math.round(W * 0.6); x += Math.max(1, Math.round(W / 100))) {
    let wallBottom = -1, floorPx = 0;
    for (let y = 0; y < H; y++) {
      const l = labels[y * W + x];
      if (l < 0) continue;
      if (isWall[l]) wallBottom = y;
      if (isFloor[l]) floorPx++;
    }
    if (wallBottom > 0 && floorPx > H * 0.08) lines.push(wallBottom / H);
  }
  if (lines.length < 3) return null;
  lines.sort((a, b) => a - b);
  const back = lines[Math.floor(lines.length / 2)]; // back wall / floor line (median)
  const floorDepth = 1 - back; // how much floor is visible below that line
  if (floorDepth < 0.15) return null;
  return {
    x0: 0.28,
    x1: 0.72,
    y0: Math.max(0.3, back - floorDepth * 0.35), // worktop and the top of the stools, standing out from the back wall
    y1: Math.min(0.97, back + floorDepth * 0.85), // feet on the floor, well in front of the back wall
  };
}

/** 0/255 Uint8Array -> PNG mask (white = repaint). */
export const maskPng = (mask, width, height) =>
  sharp(Buffer.from(mask), { raw: { width, height, channels: 1 } }).png().toBuffer();

/**
 * Put the original photo's pixels back everywhere outside the editable area (soft edge),
 * so the room shell is pixel-identical to the customer's photo.
 */
export async function compositeOriginal(original, generated, editable, width, height) {
  const feather = new Uint8Array(
    // Very light feather (the masks are already pixel-precise): just enough to hide the seam, not to blur edges.
    await sharp(Buffer.from(editable), { raw: { width, height, channels: 1 } }).blur(1).extractChannel(0).raw().toBuffer()
  );
  const o = await sharp(original).resize(width, height, { fit: 'fill' }).removeAlpha().raw().toBuffer();
  const g = await sharp(generated).resize(width, height, { fit: 'fill' }).removeAlpha().raw().toBuffer();
  const out = Buffer.alloc(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    const a = feather[i] / 255;
    for (let c = 0; c < 3; c++) out[i * 3 + c] = Math.round(g[i * 3 + c] * a + o[i * 3 + c] * (1 - a));
  }
  return sharp(out, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

/** Debug image: photo with units (red), island (blue) and protected openings (green). */
export async function debugOverlay(photo, regions, width, height) {
  const base = await sharp(photo).resize(width, height, { fit: 'fill' }).removeAlpha().raw().toBuffer();
  const out = Buffer.from(base);
  for (let i = 0; i < width * height; i++) {
    const tint = regions.island[i] ? [47, 111, 224] : regions.units[i] ? [224, 48, 58] : regions.openings[i] ? [40, 170, 90] : null;
    if (tint) for (let c = 0; c < 3; c++) out[i * 3 + c] = Math.round(base[i * 3 + c] * 0.45 + tint[c] * 0.55);
  }
  return sharp(out, { raw: { width, height, channels: 3 } }).png().toBuffer();
}