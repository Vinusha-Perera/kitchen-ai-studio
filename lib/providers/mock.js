import sharp from 'sharp';

/**
 * Offline provider for development and demos without an API key.
 * Returns the uploaded photo with a warm tint and a "MOCK RENDER" label,
 * or a plain placeholder when there is no photo.
 */
export async function renderKitchen({ prompt, photo }) {
  await new Promise((r) => setTimeout(r, 800)); // feel like a real call

  const W = 1536, H = 1024;
  const label = Buffer.from(
    `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
      <rect x="40" y="${H - 120}" width="460" height="80" rx="12" fill="rgba(20,19,19,.75)"/>
      <text x="70" y="${H - 66}" font-family="Arial" font-size="36" fill="#fff">MOCK RENDER</text>
    </svg>`
  );

  const base = photo
    ? sharp(photo).resize(W, H, { fit: 'cover' }).modulate({ saturation: 0.6, brightness: 1.05 }).tint({ r: 214, g: 196, b: 170 })
    : sharp({ create: { width: W, height: H, channels: 3, background: { r: 231, g: 224, b: 214 } } });

  return base.composite([{ input: label }]).png().toBuffer();
}
