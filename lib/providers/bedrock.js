import { BedrockRuntimeClient, InvokeModelCommand, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import sharp from 'sharp';
import { buildNovaPrompt } from '../prompt.js'; // template prompt + negative prompt

// Kitchen renders with Stability AI models on Amazon Bedrock (Amazon Nova Canvas reached end of life on 30 Sep 2026).
//
// With a photo (default "inpaint" mode):
//   1. A Claude model (MODEL_ID, e.g. Claude Haiku) looks at the photo and marks where the kitchen goes
//      (empty walls in an empty room, the old units in an existing kitchen) and writes the prompt.
//   2. Stable Image Inpaint redraws ONLY those areas. Everything else in the photo stays exactly as it was.
// Without a photo: Stable Image Core generates an example kitchen.
// All three are reachable from us-west-2 (the "us." profiles route across US regions).

const env = (k, d) => process.env[k] || d;
const INPAINT_MODEL = () => env('BEDROCK_INPAINT_MODEL_ID', 'us.stability.stable-image-inpaint-v1:0');
const STRUCTURE_MODEL = () => env('BEDROCK_MODEL_ID', 'us.stability.stable-image-control-structure-v1:0');
const TEXT_MODEL = () => env('BEDROCK_TEXT_MODEL_ID', 'stability.stable-image-core-v1:1');
const PLANNER_MODEL = () => process.env.BEDROCK_PROMPT_MODEL_ID || process.env.MODEL_ID || '';
const PHOTO_MODE = () => env('BEDROCK_PHOTO_MODE', 'inpaint'); // inpaint | structure

let client;
const getClient = () => {
  // Credentials come from the standard AWS chain: env vars, ~/.aws profile, or the server's IAM role.
  client ??= new BedrockRuntimeClient({
    region: env('AWS_REGION', 'us-west-2'),
    requestHandler: { requestTimeout: 300_000 },
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
  return sharp(cropped).resize(3000, 3000, { fit: 'inside', withoutEnlargement: true }).png().toBuffer();
}

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

// ---------- Planner: Claude looks at the photo, marks the kitchen areas, writes the prompt ----------

// Used when no planner model is set or it fails: the middle band of a typical eye-level room photo.
const DEFAULT_REGIONS = [{ x0: 0.04, y0: 0.22, x1: 0.96, y1: 0.84 }];

const PLANNER_SYSTEM =
  'You plan kitchen renovations for an image-inpainting model. You get a photo of a room and the customer\'s chosen design. ' +
  'The inpainting model will repaint ONLY the rectangles you return and keep everything else in the photo unchanged.\n' +
  'Return rectangles covering where the fitted kitchen should be:\n' +
  '- Existing kitchen: cover the current cabinets, worktops, splashback, hob/extractor and any island so they can all be replaced.\n' +
  '- Empty room: cover the wall surfaces where units would naturally go (usually the wall facing the camera and any long side wall), ' +
  'from just above the floor line up to the top of where wall cabinets would sit. Add a floor-area rectangle for an island only if one was requested and clearly fits.\n' +
  'Keep windows, doors and the ceiling outside the rectangles wherever possible. Use 1 to 3 rectangles. ' +
  'Coordinates are fractions of the image width/height: x0,y0 = top-left, x1,y1 = bottom-right, each 0 to 1.\n' +
  'Also write "prompt": what should appear inside the rectangles, as a photographic description of the new kitchen in this room ' +
  '(materials, colours, layout, lighting matching the photo). Include EVERY chosen option: cabinet style, colours, worktop, priority and each must-have item. ' +
  'Only leave out a must-have if it physically cannot fit in this room. Under 700 characters.\n' +
  'Reply with JSON only, no other text: {"regions":[{"x0":0,"y0":0,"x1":1,"y1":1}],"prompt":"..."}';

function parsePlan(raw) {
  const json = raw?.match(/\{[\s\S]*\}/)?.[0];
  if (!json) return null;
  const plan = JSON.parse(json);
  const clamp = (n) => Math.min(1, Math.max(0, Number(n)));
  const regions = (Array.isArray(plan.regions) ? plan.regions : [])
    .slice(0, 3)
    .map((r) => ({ x0: clamp(r.x0), y0: clamp(r.y0), x1: clamp(r.x1), y1: clamp(r.y1) }))
    .filter((r) => [r.x0, r.y0, r.x1, r.y1].every(Number.isFinite) && r.x1 - r.x0 > 0.05 && r.y1 - r.y0 > 0.05);
  const area = regions.reduce((s, r) => s + (r.x1 - r.x0) * (r.y1 - r.y0), 0);
  const prompt = typeof plan.prompt === 'string' ? plan.prompt.trim().slice(0, 1500) : '';
  if (!regions.length || area < 0.08 || !prompt) return null; // too small or empty -> not trustworthy
  return { regions, prompt };
}

const roomSize = (a) =>
  a.width && a.depth
    ? `Room size: about ${a.width}m wide x ${a.depth}m deep${a.ceiling ? `, ${a.ceiling}m ceiling` : ''}.\n`
    : '';

async function planKitchen(photoPng, designPrompt, answers) {
  const fallback = { regions: DEFAULT_REGIONS, prompt: designPrompt, planned: false };
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
            { text: `The photo shows: ${answers.roomType === 'empty' ? 'an empty room' : 'an existing kitchen'}.\n${roomSize(answers)}Chosen design: ${designPrompt}` },
          ],
        }],
        inferenceConfig: { maxTokens: 700, temperature: 0.3 },
      })
    );
    const text = res.output?.message?.content?.find((c) => c.text)?.text;
    const plan = parsePlan(text);
    if (!plan) {
      console.error(`[planner] ${modelId} gave an unusable plan, using defaults`);
      return fallback;
    }
    return { ...plan, planned: true };
  } catch (e) {
    console.error(`[planner] ${modelId} failed, using defaults:`, e.message);
    return fallback;
  }
}

/** White rectangles (area to repaint) on black, same size as the image. */
async function buildMask(width, height, regions) {
  const rects = regions
    .map((r) => {
      const x = Math.round(r.x0 * width), y = Math.round(r.y0 * height);
      return `<rect x="${x}" y="${y}" width="${Math.round(r.x1 * width) - x}" height="${Math.round(r.y1 * height) - y}" fill="#fff"/>`;
    })
    .join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#000"/>${rects}</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

// ---------- Render ----------

/** Render a kitchen and return a PNG Buffer. */
export async function renderKitchen({ photo, answers }) {
  const { text, negativeText } = buildNovaPrompt(answers, Boolean(photo));

  if (!photo) {
    return invoke(TEXT_MODEL(), { prompt: text, negative_prompt: negativeText, aspect_ratio: '3:2', output_format: 'png' });
  }

  const input = await prepareInput(photo);
  const plan = await planKitchen(input, text, answers);

  if (PHOTO_MODE() === 'structure') {
    return invoke(STRUCTURE_MODEL(), {
      prompt: plan.prompt,
      negative_prompt: negativeText,
      image: input.toString('base64'),
      control_strength: Number(process.env.BEDROCK_CONTROL_STRENGTH) || 0.7,
      style_preset: 'photographic',
      output_format: 'png',
    });
  }

  const { width, height } = await sharp(input).metadata();
  const mask = await buildMask(width, height, plan.regions);
  console.log(`[render] inpaint ${plan.planned ? 'planned' : 'default'} regions:`, JSON.stringify(plan.regions));

  return invoke(INPAINT_MODEL(), {
    // The customer's choices are always appended, so none can be lost in the planner's rewrite.
    prompt: plan.planned
      ? `${plan.prompt} ${text} (fitted kitchen cabinets:1.3)`
      : `${text} (fitted kitchen cabinets:1.3)`,
    negative_prompt: `${negativeText}, empty room, bare walls, unfinished`,
    image: input.toString('base64'),
    mask: mask.toString('base64'),
    grow_mask: Number(process.env.BEDROCK_GROW_MASK) || 12, // softens the seam between new and original
    style_preset: 'photographic',
    output_format: 'png',
  });
}