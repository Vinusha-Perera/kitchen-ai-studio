import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import sharp from 'sharp';
import { buildNovaPrompt } from '../prompt.js';

let client;
const getClient = () => {
  // Credentials come from the standard AWS chain: env vars, ~/.aws profile, or the
  // IAM role of the server (EC2, ECS, Lambda, App Runner). Nothing is hard-coded here.
  client ??= new BedrockRuntimeClient({
    region: process.env.AWS_REGION || 'us-east-1',
    requestHandler: { requestTimeout: 300_000 }, // AWS recommends >= 300s for image generation
  });
  return client;
};

const LONG_SIDE = Number(process.env.BEDROCK_IMAGE_LONG_SIDE) || 1280;
const snap = (n) => Math.max(320, Math.round(n / 64) * 64); // valid Nova sizes: multiples of 16, min 320

/** Output size matching the photo's aspect ratio (AWS advises matching the condition image). */
async function dimensionsFor(photo) {
  if (!photo) return { width: 1280, height: 768 };
  const { width, height } = await sharp(photo).metadata();
  const scale = LONG_SIDE / Math.max(width, height);
  return { width: snap(width * scale), height: snap(height * scale) };
}

/**
 * Render a kitchen with Amazon Nova Canvas.
 * With a photo -> TEXT_IMAGE + conditionImage (SEGMENTATION keeps the room layout, restyles the kitchen).
 * Without     -> plain TEXT_IMAGE example kitchen in the chosen style.
 * Returns a PNG Buffer.
 */
export async function renderKitchen({ photo, answers }) {
  const { text, negativeText } = buildNovaPrompt(answers, Boolean(photo));
  const { width, height } = await dimensionsFor(photo);

  const textToImageParams = { text, negativeText };
  if (photo) {
    const condition = await sharp(photo).resize(width, height, { fit: 'cover' }).png().toBuffer();
    textToImageParams.conditionImage = condition.toString('base64');
    textToImageParams.controlMode = process.env.BEDROCK_CONTROL_MODE || 'SEGMENTATION'; // or CANNY_EDGE
    textToImageParams.controlStrength = Number(process.env.BEDROCK_CONTROL_STRENGTH) || 0.7;
  }

  const body = {
    taskType: 'TEXT_IMAGE',
    textToImageParams,
    imageGenerationConfig: {
      numberOfImages: 1,
      width,
      height,
      quality: process.env.BEDROCK_QUALITY || 'standard', // standard | premium
      cfgScale: 7.0,
      seed: Math.floor(Math.random() * 2_147_483_646),
    },
  };

  const res = await getClient().send(
    new InvokeModelCommand({
      modelId: process.env.BEDROCK_MODEL_ID || 'amazon.nova-canvas-v1:0',
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify(body),
    })
  );

  const out = JSON.parse(new TextDecoder().decode(res.body));
  const b64 = out.images?.[0];
  // Nova removes images that fail its content moderation and explains why in `error`.
  if (!b64) throw new Error(out.error || 'Bedrock returned no image');
  return sharp(Buffer.from(b64, 'base64')).png().toBuffer();
}