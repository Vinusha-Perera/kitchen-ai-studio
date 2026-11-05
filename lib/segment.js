import sharp from 'sharp';
import { pipeline, RawImage, env as hf } from '@huggingface/transformers';

// ============================================================================
// Pixel-precise segmentation of the customer's photo (the "segmentation" step of
// a controlled image edit). Uses SegFormer trained on ADE20K, which labels every pixel
// as one of 150 indoor/outdoor classes: wall, floor, ceiling, windowpane, door, cabinet,
// countertop, table, chair, shelf, stove, sink, refrigerator, ...
// Runs locally inside Node (no API, no cost). The model (~15 MB for b0) is downloaded
// from Hugging Face on first use and cached.
// ============================================================================

const MODEL = () => process.env.SEG_MODEL || 'Xenova/segformer-b0-finetuned-ade-512-512';
if (process.env.SEG_CACHE_DIR) hf.cacheDir = process.env.SEG_CACHE_DIR;

let segmenter; // loaded once, reused for every request
const getSegmenter = () => (segmenter ??= pipeline('image-segmentation', MODEL()));

/**
 * Segment a photo. Returns { width, height, labels, names } where labels[i] is an index into
 * names for pixel i (or -1 if unlabelled), or null if segmentation is unavailable.
 */
export async function segmentPhoto(png) {
  try {
    const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const image = new RawImage(new Uint8ClampedArray(data), info.width, info.height, 3);
    const results = await (await getSegmenter())(image);

    const size = info.width * info.height;
    const labels = new Int16Array(size).fill(-1);
    const names = [];
    for (const r of results) {
      const mask = r.mask; // single channel, same size as the photo
      if (!mask || mask.width !== info.width || mask.height !== info.height) continue;
      const idx = names.push(String(r.label || '').trim()) - 1; // some ADE20K labels have trailing spaces
      const m = mask.data;
      for (let i = 0; i < size; i++) if (m[i] > 127) labels[i] = idx;
    }
    if (!names.length) return null;
    return { width: info.width, height: info.height, labels, names };
  } catch (e) {
    console.error(`[segment] unavailable (${e.message}); falling back to rectangles`);
    return null;
  }
}

/** Share of the photo covered by each label, e.g. { wall: 0.41, floor: 0.22, ... } — for logging. */
export function labelShares(seg) {
  const counts = new Array(seg.names.length).fill(0);
  for (const l of seg.labels) if (l >= 0) counts[l]++;
  return Object.fromEntries(
    seg.names.map((n, i) => [n, Math.round((counts[i] / seg.labels.length) * 100) / 100]).filter(([, v]) => v >= 0.01)
  );
}

// Swappable for tests.
export const segmenterApi = { segmentPhoto };