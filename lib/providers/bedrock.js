import { BedrockRuntimeClient, InvokeModelCommand, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import sharp from 'sharp';
import fs from 'node:fs/promises';
import { buildKitchenPrompt, buildPhotoPrompts } from '../prompt.js';
import { segmenterApi, labelShares } from '../segment.js';
import { buildRegions, maskPng, compositeOriginal, debugOverlay, islandFromFloor } from '../regions.js';

// Kitchen renders with Stability AI models on Amazon Bedrock.
//
// With a photo (default "inpaint" mode) — a controlled image edit:
//   1. UNDERSTAND — Claude (MODEL_ID, e.g. Claude Haiku) describes the room and marks the island spot.
//   2. SEGMENT    — SegFormer (ADE20K, runs locally) labels every pixel: wall, floor, ceiling, door, window,
//                   cabinet, table, chair... (lib/segment.js)
//   3. REGIONS    — editable = every old-furniture pixel + a wall band (floor line up to wall-cabinet height,
//                   following the wall's perspective) + the island spot. Protected = the room shell. (lib/regions.js)
//   4. INPAINT    — Stable Image Inpaint paints the new units, then the island, into the editable pixels.
//   5. COMPOSITE  — the original photo's pixels are put back everywhere outside the editable area.
//   6. FINISH     — the whole picture is redrawn once, following the outlines of step 5, so the floor gets
//                   real shadows/reflections and the light and sharpness match everywhere (HARMONISE).
//   If segmentation can't run, Claude's rectangles are used instead (older method).
// Without a photo: Stable Image Core generates an example kitchen.

const env = (k, d) => process.env[k] || d;
const INPAINT_MODEL = () => env('BEDROCK_INPAINT_MODEL_ID', 'us.stability.stable-image-inpaint-v1:0');
const STRUCTURE_MODEL = () => env('BEDROCK_MODEL_ID', 'us.stability.stable-image-control-structure-v1:0');
const TEXT_MODEL = () => env('BEDROCK_TEXT_MODEL_ID', 'stability.stable-image-core-v1:1');
const PLANNER_MODEL = () => process.env.BEDROCK_PROMPT_MODEL_ID || process.env.MODEL_ID || '';
const PHOTO_MODE = () => env('BEDROCK_PHOTO_MODE', 'inpaint'); // inpaint | structure
const IMG2IMG_MODEL = () => env('BEDROCK_IMG2IMG_MODEL_ID', 'stability.sd3-5-large-v1:0');
const HARMONISE = () => env('HARMONISE', 'structure').toLowerCase(); // structure | img2img | off

let client;
const getClient = () => {
  // Credentials come from the standard AWS chain: env vars, ~/.aws profile, or the server's IAM role.
  client ??= new BedrockRuntimeClient({
    region: env('AWS_REGION', 'us-west-2'),
    requestHandler: { requestTimeout: 300_000 },
    // "Bedrock is unable to process your request" (ServiceUnavailable) and throttling are temporary
    // capacity errors on AWS's side: retry them with growing waits instead of failing straight away.
    maxAttempts: Number(process.env.BEDROCK_MAX_ATTEMPTS) || 6,
    retryMode: 'adaptive',
  });
  return client;
};

/** Stability input rules: sides >= 64px, <= 9,437,184 pixels, aspect ratio 1:2.5 to 2.5:1. Returns a PNG buffer. */
async function prepareInput(photo) {
  const { width, height } = await sharp(photo).metadata();
  let w = width, h = height;
  if (width / height > 2.5) w = Math.floor(height * 2.5);
  else if (height / width > 2.5) h = Math.floor(width * 2.5);
  const cropped = await sharp(photo)
    .extract({ left: Math.floor((width - w) / 2), top: Math.floor((height - h) / 2), width: w, height: h })
    .png()
    .toBuffer();
  // Small photos (e.g. 640px wide) give soft, blurry renders: the AI paints at the photo's own size.
  // So enlarge them to at least MIN_SIDE on the long side first; big photos are capped at 3000px.
  const long = Math.max(w, h);
  const target = long < MIN_SIDE ? MIN_SIDE : Math.min(long, 3000);
  return sharp(cropped)
    .resize(target, target, { fit: 'inside', kernel: 'lanczos3' })
    .png()
    .toBuffer();
}
const MIN_SIDE = Number(process.env.MIN_RENDER_SIDE) || 1536;

async function invoke(modelId, body) {
  const res = await getClient().send(
    new InvokeModelCommand({ modelId, contentType: 'application/json', accept: 'application/json', body: JSON.stringify(body) })
  );
  const out = JSON.parse(new TextDecoder().decode(res.body));
  const reason = out.finish_reasons?.[0]; // null = success, otherwise e.g. "Filter reason: output image"
  if (reason) throw new Error(`Bedrock: ${reason}`);
  const b64 = out.images?.[0];
  if (!b64) throw new Error('Bedrock returned no image');
  return sharp(Buffer.from(b64, 'base64')).png().toBuffer();
}

// ---------- Planner ----------

// Used when the planner is not set or fails (typical eye-level room photo).
const DEFAULT_UNITS = [{ x0: 0.03, y0: 0.2, x1: 0.97, y1: 0.72 }];
const DEFAULT_ISLAND = { x0: 0.3, y0: 0.62, x1: 0.7, y1: 0.95 };

const PLANNER_SYSTEM =
  'You plan a kitchen renovation for an image-inpainting model that repaints ONLY the rectangles you mark. ' +
  'The room itself must stay exactly as photographed: walls, ceiling/roof, beams, floor, doors and windows.\n' +
  'Return JSON with:\n' +
  '"units": 1-4 rectangles on the walls where the new fitted cabinets go, following the planned layout, from just above the floor line ' +
  'up to the top of the wall cabinets. In an existing kitchen, ALSO cover every old cabinet, dresser, cupboard, shelf, worktop and appliance ' +
  'standing against the walls (including their tops and anything on them) so nothing old is left. ' +
  'Each rectangle must hug the cabinets against its wall: do NOT include the open floor in front of them or the floor in the foreground of the photo.\n' +
  '"island": one rectangle on the floor where the island or peninsula stands (only the island and its stools, not the whole floor), or null if the layout has none.\n' +
  '"clear": 0-2 rectangles around old furniture in the middle of the room (tables, chairs) that must be removed, or [].\n' +
  '"keep": tight rectangles around every door, doorway and window (glass and frame), which must never be painted. Check their position carefully.\n' +
  '"room": under 120 characters describing the existing walls, ceiling and floor materials and colours, e.g. "whitewashed walls, exposed timber beams, wide oak floorboards".\n' +
  'Coordinates are fractions of image width/height (0 to 1): x0,y0 top-left, x1,y1 bottom-right.\n' +
  'Reply with JSON only: {"units":[{"x0":0,"y0":0,"x1":0,"y1":0}],"island":null,"clear":[],"keep":[],"room":""}';

const clamp = (n) => Math.min(1, Math.max(0, Number(n)));
const box = (r) => {
  if (!r || typeof r !== 'object') return null;
  const b = { x0: clamp(r.x0), y0: clamp(r.y0), x1: clamp(r.x1), y1: clamp(r.y1) };
  return [b.x0, b.y0, b.x1, b.y1].every(Number.isFinite) && b.x1 - b.x0 > 0.03 && b.y1 - b.y0 > 0.03 ? b : null;
};
const boxes = (list, max) => (Array.isArray(list) ? list : []).map(box).filter(Boolean).slice(0, max);
const area = (list) => list.reduce((s, r) => s + (r.x1 - r.x0) * (r.y1 - r.y0), 0);

function parsePlan(raw) {
  const json = raw?.match(/\{[\s\S]*\}/)?.[0];
  if (!json) return null;
  const p = JSON.parse(json);
  const units = boxes(p.units, 4);
  if (!units.length) return null;
  return {
    units,
    island: box(p.island),
    clear: boxes(p.clear, 2),
    keep: boxes(p.keep, 6),
    room: typeof p.room === 'string' ? p.room.trim().replace(/[.\s]+$/, '').slice(0, 160) : '',
  };
}

/** Hard rules on top of the planner's answer. */
function guarantee(plan, layout) {
  const out = { ...plan };
  if (area(out.units) < 0.2) out.units = [...out.units, ...DEFAULT_UNITS]; // too little for a full kitchen
  if ((layout.island || layout.seating) && !out.island) out.island = DEFAULT_ISLAND;
  if (!(layout.island || layout.seating)) out.island = null;
  return out;
}

const roomSize = (a) =>
  a.width && a.depth ? `Room size: about ${a.width}m wide x ${a.depth}m deep${a.ceiling ? `, ${a.ceiling}m ceiling` : ''}.\n` : '';

async function planKitchen(photoPng, answers, layout) {
  const fallback = guarantee({ units: [], island: null, clear: [], keep: [], room: '', planned: false }, layout);
  const modelId = PLANNER_MODEL();
  if (!modelId) return fallback;
  try {
    const jpeg = await sharp(photoPng).resize(1024, 1024, { fit: 'inside' }).jpeg({ quality: 85 }).toBuffer();
    const res = await getClient().send(
      new ConverseCommand({
        modelId,
        system: [{ text: PLANNER_SYSTEM }],
        messages: [{
          role: 'user',
          content: [
            { image: { format: 'jpeg', source: { bytes: jpeg } } },
            { text: `The photo shows: ${answers.roomType === 'empty' ? 'an empty room' : 'an existing kitchen'}.\n${roomSize(answers)}Planned layout: ${layout.layout}.` },
          ],
        }],
        inferenceConfig: { maxTokens: 600, temperature: 0.2 },
      })
    );
    const plan = parsePlan(res.output?.message?.content?.find((c) => c.text)?.text);
    if (!plan) {
      console.error(`[planner] ${modelId} gave an unusable plan, using defaults`);
      return fallback;
    }
    return { ...guarantee(plan, layout), planned: true };
  } catch (e) {
    console.error(`[planner] ${modelId} failed, using defaults:`, e.message);
    return fallback;
  }
}

/** White = repaint, black = keep. "keep" boxes (doors, windows) are drawn black on top, so they are never painted. */
async function buildMask(width, height, paint, keep) {
  const rect = (r, fill) => {
    const x = Math.round(r.x0 * width), y = Math.round(r.y0 * height);
    return `<rect x="${x}" y="${y}" width="${Math.round(r.x1 * width) - x}" height="${Math.round(r.y1 * height) - y}" fill="${fill}"/>`;
  };
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#000"/>` +
    paint.map((r) => rect(r, '#fff')).join('') + keep.map((r) => rect(r, '#000')).join('') + '</svg>';
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function inpaint(image, paint, keep, prompt, negative, grow) {
  // `keep` = areas that must not be painted in this pass (doors/windows, and for pass 1 also the island area).
  const { width, height } = await sharp(image).metadata();
  return inpaintWithMask(image, await buildMask(width, height, paint, keep), prompt, negative, grow);
}

async function inpaintWithMask(image, mask, prompt, negative, grow) {
  return invoke(INPAINT_MODEL(), {
    prompt,
    negative_prompt: negative,
    image: (await sharp(image).jpeg({ quality: 92 }).toBuffer()).toString('base64'), // smaller request than PNG
    mask: mask.toString('base64'),
    grow_mask: grow,
    style_preset: 'photographic',
    output_format: 'png',
  });
}

// ---------- Finishing pass ----------

/**
 * Why our renders looked flat and blurry next to the PGK ones:
 * inpainting only paints inside the masks and the original photo is pasted back everywhere else,
 * so the floor never gets the new kitchen's shadows/reflections, the light doesn't match between
 * patches, and the kept parts stay as soft as the (often small) original photo.
 * PGK-style renders are drawn as ONE picture.
 *
 * So after the masks have put everything in the right place, this pass redraws the WHOLE image once,
 * using our result as the guide:
 *   structure (default) — Stable Image Control Structure follows the outlines of our result (walls, window,
 *                         units, island, stools stay where they are) and draws everything fresh and sharp.
 *                         HARMONISE_STRENGTH = how strictly it follows the outlines (0-1, default 0.85).
 *   img2img             — SD3.5 Large redraws lightly on top of our result (keeps colours closer).
 *                         HARMONISE_STRENGTH = how much it changes (0-1, default 0.35).
 *   off                 — return the inpainted result as before.
 * If this pass fails, the inpainted result is returned, so the customer still gets a design.
 */
async function harmonise(image, p) {
  const mode = HARMONISE();
  if (mode === 'off') return image;
  const strength = Number(process.env.HARMONISE_STRENGTH);
  const jpeg = (await sharp(image).jpeg({ quality: 92 }).toBuffer()).toString('base64');
  try {
    const out = mode === 'img2img'
      ? await invoke(IMG2IMG_MODEL(), {
          prompt: p.full,
          negative_prompt: p.negative,
          mode: 'image-to-image',
          image: jpeg,
          strength: strength || 0.35,
          output_format: 'png',
        })
      : await invoke(STRUCTURE_MODEL(), {
          prompt: p.full,
          negative_prompt: p.negative,
          image: jpeg,
          control_strength: strength || 0.85,
          style_preset: 'photographic',
          output_format: 'png',
        });
    console.log(`[render] finishing pass (${mode}) done`);
    return out;
  } catch (e) {
    console.error(`[render] finishing pass (${mode}) failed, returning the inpainted result: ${e.name}: ${e.message}`);
    return image;
  }
}

// ---------- Render ----------

/** Render a kitchen and return a PNG Buffer. */
export async function renderKitchen(args) {
  const ctx = {}; // placeKitchen fills in ctx.prompts (with the planner's room description)
  const result = await placeKitchen(args, ctx);
  if (!args.photo || PHOTO_MODE() === 'structure' || !ctx.prompts) return result; // already drawn as one picture
  return harmonise(result, ctx.prompts);
}

/** Puts every selected item in the right place (masks + inpainting). */
async function placeKitchen({ photo, answers }, ctx) {
  if (!photo) {
    const { text, negativeText } = buildKitchenPrompt(answers, false);
    return invoke(TEXT_MODEL(), { prompt: text, negative_prompt: negativeText, aspect_ratio: '3:2', output_format: 'png' });
  }

  const input = await prepareInput(photo);
  const { layout } = buildPhotoPrompts(answers, '');
  const plan = await planKitchen(input, answers, layout);
  const p = buildPhotoPrompts(answers, plan.room);
  ctx.prompts = p;

  if (PHOTO_MODE() === 'structure') {
    return invoke(STRUCTURE_MODEL(), {
      prompt: [p.units, p.centre].filter(Boolean).join(' '),
      negative_prompt: p.negative,
      image: input.toString('base64'),
      control_strength: Number(process.env.BEDROCK_CONTROL_STRENGTH) || 0.7,
      style_preset: 'photographic',
      output_format: 'png',
    });
  }

  const grow = Number(process.env.BEDROCK_GROW_MASK) || 12;

  // ---- Segmentation path (pixel-precise masks + original pixels composited back) ----
  const seg = String(process.env.SEGMENTATION || 'on').toLowerCase() === 'off' ? null : await segmenterApi.segmentPhoto(input);
  if (seg) {
    const { width: W, height: H } = seg;
    // Segmentation masks are already precise, so Stability only needs a small soft edge (a big one blurs edges).
    const segGrow = Number(process.env.SEG_GROW_MASK) || 3;
    // Island position from the real floor: in front of the back wall with a walkway, not touching it.
    // (Claude's box was sometimes too close to the back wall, so the island merged into the back units.)
    if (plan.island) plan.island = islandFromFloor(seg) || plan.island;
    const regions = await buildRegions(seg, plan.island);
    console.log('[segment] labels:', JSON.stringify(labelShares(seg)));
    console.log(`[render] room: ${plan.room || '(not described)'} | island: ${plan.island ? 'yes' : 'no'}`);
    if (String(process.env.DEBUG_MASKS).toLowerCase() === 'on') {
      await fs.writeFile('generated/debug-mask-latest.png', await debugOverlay(input, regions, W, H));
      console.log('[segment] mask preview saved to generated/debug-mask-latest.png');
    }

    // Pass 1: the new units into the units area (island spot and openings excluded).
    let image = await inpaintWithMask(input, await maskPng(regions.units, W, H), p.units, p.negative, segGrow);
    image = await sharp(image).resize(W, H, { fit: 'fill' }).png().toBuffer();

    // Pass 2: the island.
    if (plan.island && p.centre) {
      try {
        image = await inpaintWithMask(image, await maskPng(regions.island, W, H), p.centre, p.negative, segGrow);
        image = await sharp(image).resize(W, H, { fit: 'fill' }).png().toBuffer();
      } catch (e) {
        console.error(`[render] island pass failed, keeping the units: ${e.name}: ${e.message}`);
      }
    }

    // Put the room shell back exactly as photographed (the finishing pass then blends it all together).
    return compositeOriginal(input, image, regions.editable, W, H);
  }

  // ---- Fallback: Claude's rectangles (used only if segmentation is unavailable) ----
  console.log(`[render] ${plan.planned ? 'planned' : 'default'} plan:`, JSON.stringify({ units: plan.units, island: plan.island, clear: plan.clear, keep: plan.keep, room: plan.room }));

  const centreAreas = plan.island ? [plan.island, ...plan.clear] : plan.clear;

  // Pass 1: wall cabinets (and old wall furniture). Doors, windows AND the island/centre area are protected,
  // so no wall cabinets get painted where the island will stand.
  let image;
  try {
    image = await inpaint(input, plan.units, [...plan.keep, ...centreAreas], p.units, p.negative, grow);
  } catch (e) {
    console.error(`[render] pass 1 (wall units) failed: ${e.name}: ${e.message}`);
    throw e;
  }
  // Keep the same size as the customer's photo for pass 2 and the before/after view.
  const { width, height } = await sharp(input).metadata();
  image = await sharp(image).resize(width, height, { fit: 'fill' }).png().toBuffer();

  // Pass 2: the island (over the old centre furniture), or empty floor where old furniture stood.
  if (!centreAreas.length) return image;
  try {
    const prompt = plan.island && p.centre ? p.centre : p.clear;
    return await inpaint(image, centreAreas, plan.keep, prompt, p.negative, Math.min(grow, 8));
  } catch (e) {
    // Don't lose the new wall units if only the island pass fails.
    console.error(`[render] pass 2 (island/centre) failed, returning pass 1 result: ${e.name}: ${e.message}`);
    return image;
  }
}