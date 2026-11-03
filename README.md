# AI Kitchen Design Studio

A 7-step web wizard: the customer uploads a photo of their kitchen, picks a style, colours, worktop, priority and must-haves, leaves their details, and gets:

- an **AI render of their own kitchen** redesigned in their choices (before/after slider),
- an **indicative price range**,
- a downloadable **Design Pack** (self-contained HTML, same layout as your existing pack),
- a **lead** saved for your sales team.

If the AI call fails, the customer still gets a style example, the price and the pack (marked "AI render was unavailable"), so nobody leaves empty-handed.

## Quick start

```bash
npm install
cp .env.example .env        # add your OPENAI_API_KEY
npm start                   # http://localhost:3000
```

No key yet? Set `IMAGE_PROVIDER=mock` in `.env` to run the full flow offline with a placeholder render.

## How the AI image is made

1. The photo is normalised on the server (`sharp`): iPhone rotation fixed, HEIC converted, resized to max 1536px, metadata (including GPS) stripped.
2. `lib/prompt.js` turns the answers into a prompt. With a photo it tells the model to **keep the room exactly** (camera angle, walls, windows, doors, ceiling) and replace only the kitchen. Without a photo it generates an example kitchen in the chosen style.
3. `lib/providers/openai.js` calls the OpenAI Images API: `images.edit` with the photo, or `images.generate` without one. The model, size and quality come from `.env`.

Each render costs roughly a few US cents at `medium` quality; `high` looks better but costs more and is slower. Check OpenAI's current pricing.

Tips for better results:
- Set `OPENAI_INPUT_FIDELITY=high` in `.env` (if your model supports it) to keep more of the original room.
- Tune the wording per option in `lib/options.js` — every style, colour, worktop, priority and must-have has its own `prompt` text.

### Using a different AI provider

Add a file in `lib/providers/` that exports `renderKitchen({ prompt, photo })` and returns a PNG `Buffer`, register it in `lib/providers/index.js`, and set `IMAGE_PROVIDER`. Replicate (e.g. a ControlNet/interior model), Stability or Google's image models all fit this shape.

## Things to add before going live

| What | Where |
|---|---|
| **Your 4 style photos** for step 2 (shown as beige placeholders until added). Also used as the fallback image. | `public/img/style-modern.jpg`, `style-traditional.jpg`, `style-contemporary.jpg`, `style-shaker.jpg` (landscape, ~1200×750) |
| Brand name and website | `BRAND_NAME`, `BRAND_SITE` in `.env` |
| Real pricing rules | `lib/pricing.js` (band is 82–112% of budget, adjusted by worktop and must-haves) |
| Send leads to your CRM/email | `server.js`, after `leads.jsonl` is written |
| Privacy policy link in the consent text | step 7 in `public/app.js` |

## Project layout

```
server.js                 Express app: /api/options, /api/generate, /api/design-pack/:id
lib/options.js            All wizard choices + their prompt text and price factors
lib/answers.js            Validates answers from the browser; spec lines
lib/prompt.js             Builds the AI prompt
lib/pricing.js            Indicative price range
lib/designPack.js         Design Pack HTML
lib/providers/            openai.js (real), mock.js (offline), index.js (picker)
public/                   index.html, styles.css, app.js (no build step)
data/                     <id>.json per design + leads.jsonl
generated/                renders and "before" photos
```

## Deployment notes

- Needs Node 18+. Works on any host that runs Node (Render, Railway, Fly.io, a VPS). Renders take 20–60s, so set your proxy/request timeout to at least 120s.
- `data/` and `generated/` are local disk. On hosts with ephemeral disks, move them to S3/R2 and a database.
- The per-IP rate limit (`RATE_LIMIT_PER_HOUR`) is in-memory; use Redis or your CDN's rate limiting if you run more than one instance.
- Customer photos are personal data under UK GDPR: keep the consent tick box, link your privacy policy, and set a retention period for `generated/` and `data/`.
