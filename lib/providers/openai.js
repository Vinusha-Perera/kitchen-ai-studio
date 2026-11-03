import OpenAI, { toFile } from 'openai';

let client;
const getClient = () => {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not set');
  client ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 180_000, maxRetries: 1 });
  return client;
};

/**
 * Render a kitchen with OpenAI's Images API.
 * With a photo -> images.edit (redesigns the customer's own room).
 * Without     -> images.generate (an example kitchen in their chosen style).
 * Returns a PNG Buffer.
 */
export async function renderKitchen({ prompt, photo }) {
  const openai = getClient();
  const common = {
    model: process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1',
    prompt,
    size: process.env.OPENAI_IMAGE_SIZE || '1536x1024',
    quality: process.env.OPENAI_IMAGE_QUALITY || 'medium',
    n: 1,
  };

  let res;
  if (photo) {
    const image = await toFile(photo, 'kitchen.png', { type: 'image/png' });
    const extra = process.env.OPENAI_INPUT_FIDELITY ? { input_fidelity: process.env.OPENAI_INPUT_FIDELITY } : {};
    res = await openai.images.edit({ ...common, ...extra, image });
  } else {
    res = await openai.images.generate(common);
  }

  const b64 = res?.data?.[0]?.b64_json;
  if (!b64) throw new Error('Image provider returned no image');
  return Buffer.from(b64, 'base64');
}
