import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import sharp from 'sharp';
import heicConvert from 'heic-convert';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { publicOptions } from './lib/options.js';
import { normaliseAnswers, specLines } from './lib/answers.js';
import { buildPrompt, buildNovaPrompt } from './lib/prompt.js';
import { estimatePrice } from './lib/pricing.js';
import { getProvider } from './lib/providers/index.js';
import { designPackHtml } from './lib/designPack.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, 'data');
const GEN = path.join(__dirname, 'generated');
await fs.mkdir(DATA, { recursive: true });
await fs.mkdir(GEN, { recursive: true });

const PORT = Number(process.env.PORT) || 3000;
const BRAND = process.env.BRAND_NAME || 'AI Design Studio';
const SITE = process.env.BRAND_SITE || '';
const RATE = Number(process.env.RATE_LIMIT_PER_HOUR) || 10;

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Images are named by random id, so URLs aren't guessable.
app.use('/generated', express.static(GEN, { maxAge: '7d' }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    // Some browsers send iPhone photos without an image MIME type, so also accept by extension.
    const ok = /^image\/(jpeg|png|webp|heic|heif)$/.test(file.mimetype) || /\.(jpe?g|png|webp|hei[cf])$/i.test(file.originalname);
    cb(ok ? null : new Error('Please upload a JPG, PNG, WEBP or iPhone (HEIC) photo'), ok);
  },
});

// --- Simple in-memory rate limit per IP (use Redis or your proxy for multi-instance deploys) ---
const hits = new Map();
function rateLimit(req, res, next) {
  const now = Date.now();
  const list = (hits.get(req.ip) || []).filter((t) => now - t < 3600_000);
  if (list.length >= RATE) return res.status(429).json({ error: 'Too many designs in the last hour. Please try again later.' });
  list.push(now);
  hits.set(req.ip, list);
  next();
}

const isId = (id) => /^[a-f0-9]{24}$/.test(id);
const readRecord = async (id) => JSON.parse(await fs.readFile(path.join(DATA, `${id}.json`), 'utf8'));

app.get('/api/options', (_req, res) => res.json({ ...publicOptions(), brand: BRAND }));

app.post('/api/generate', rateLimit, upload.single('photo'), async (req, res) => {
  let answers;
  try {
    answers = normaliseAnswers(req.body.answers);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  const id = crypto.randomBytes(12).toString('hex');
  let photoPng = null;

  if (req.file) {
    try {
      // Normalise: fix iPhone rotation, cap size, strip metadata (incl. GPS), convert to PNG.
      let input = req.file.buffer;
      if (/heic|heif/i.test(req.file.mimetype) || /\.hei[cf]$/i.test(req.file.originalname)) {
        input = Buffer.from(await heicConvert({ buffer: input, format: 'JPEG', quality: 0.92 }));
      }
      const img = sharp(input).rotate().resize(1536, 1536, { fit: 'inside', withoutEnlargement: true });
      photoPng = await img.clone().png().toBuffer();
      await img.clone().jpeg({ quality: 85 }).toFile(path.join(GEN, `${id}-before.jpg`));
    } catch {
      return res.status(400).json({ error: 'We could not read that photo. Please try a JPG or PNG.' });
    }
  }

  const provider = getProvider();
  // Bedrock (Nova Canvas) uses its own compact prompt; others use the full prompt.
  const prompt = provider.name === 'bedrock'
    ? buildNovaPrompt(answers, Boolean(photoPng)).text
    : buildPrompt(answers, Boolean(photoPng));
  const price = estimatePrice(answers);

  let fallback = false;
  let errorNote = null;
  try {
    const png = await provider.renderKitchen({ prompt, photo: photoPng, answers });
    await fs.writeFile(path.join(GEN, `${id}.png`), png);
  } catch (e) {
    // Never leave the customer with nothing: fall back to a style example (like the existing pack does).
    console.error(`[render ${id}] ${provider.name} failed:`, e.message);
    fallback = true;
    errorNote = 'AI render was unavailable';
    const example = path.join(__dirname, 'public', 'img', `style-${answers.style || 'modern'}.jpg`);
    try {
      await sharp(example).png().toFile(path.join(GEN, `${id}.png`));
    } catch {
      await sharp({ create: { width: 1536, height: 1024, channels: 3, background: '#e7e0d6' } }).png().toFile(path.join(GEN, `${id}.png`));
    }
  }

  const record = {
    id,
    createdAt: new Date().toISOString(),
    provider: provider.name,
    fallback,
    hasPhoto: Boolean(photoPng),
    prompt,
    answers,
    contact: answers.contact,
    spec: specLines(answers),
    price,
  };
  await fs.writeFile(path.join(DATA, `${id}.json`), JSON.stringify(record, null, 2));
  // Lead log for your CRM import. Swap for a webhook/email to your sales team.
  await fs.appendFile(path.join(DATA, 'leads.jsonl'), JSON.stringify({ id, at: record.createdAt, ...answers.contact, budget: answers.budget, price: price.label }) + '\n');

  res.json({
    id,
    imageUrl: `/generated/${id}.png`,
    beforeUrl: photoPng ? `/generated/${id}-before.jpg` : null,
    fallback,
    note: errorNote,
    price,
    spec: record.spec,
    designPackUrl: `/api/design-pack/${id}`,
  });
});

app.get('/api/design-pack/:id', async (req, res) => {
  const { id } = req.params;
  if (!isId(id)) return res.status(404).send('Not found');
  try {
    const record = await readRecord(id);
    const imageB64 = (await fs.readFile(path.join(GEN, `${id}.png`))).toString('base64');
    const beforeB64 = record.hasPhoto ? (await fs.readFile(path.join(GEN, `${id}-before.jpg`))).toString('base64') : null;
    res.setHeader('Content-Disposition', `attachment; filename="Design-Pack-${id.slice(0, 6)}.html"`);
    res.type('html').send(designPackHtml({ record, imageB64, beforeB64, brand: BRAND, site: SITE }));
  } catch {
    res.status(404).send('Design not found');
  }
});

// Upload errors (size/type) -> friendly JSON
app.use((err, _req, res, _next) => {
  const msg = err.code === 'LIMIT_FILE_SIZE' ? 'That photo is over 10MB. Please use a smaller one.' : err.message || 'Something went wrong';
  res.status(400).json({ error: msg });
});

app.listen(PORT, () => console.log(`${BRAND} running on http://localhost:${PORT} (provider: ${getProvider().name})`));