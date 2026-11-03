// Single source of truth for every choice in the wizard.
// The frontend fetches this from /api/options, and the prompt builder and pricing use it too,
// so adding a style or must-have here updates the whole app.

export const STYLES = {
  modern: {
    label: 'Modern & Handleless',
    sub: 'Sleek lines, no handles, flat surfaces',
    prompt: 'modern handleless kitchen with flat slab cabinet doors, integrated J-pull or push-to-open, no visible handles, minimal clean lines, integrated lighting',
  },
  traditional: {
    label: 'Warm & Traditional',
    sub: 'Cornicing, warm wood, ornate hardware',
    prompt: 'warm traditional kitchen with raised-panel wood cabinetry, cornicing, a decorative range hood, ornate cup handles and knobs',
  },
  contemporary: {
    label: 'Bold & Contemporary',
    sub: 'Dark finishes, statement stone, brass accents',
    prompt: 'bold contemporary kitchen with dark matte cabinetry, a dramatic veined stone feature, brushed brass accents and pendant lighting',
  },
  shaker: {
    label: 'Timeless Shaker',
    sub: 'Shaker doors, natural palette, enduring style',
    prompt: 'timeless shaker kitchen with in-frame shaker doors, simple knob and cup handles, a natural relaxed palette',
  },
};

export const COLOURS = {
  light: {
    label: 'Light & Bright',
    swatch: 'linear-gradient(135deg,#f4f1ec 0%,#ffffff 45%,#e8e1d6 100%)',
    prompt: 'light and bright palette of soft whites and pale stone, airy and reflective',
  },
  neutral: {
    label: 'Neutral & Warm',
    swatch: 'linear-gradient(135deg,#d8c7a6 0%,#c9b48f 50%,#b9a47c 100%)',
    prompt: 'neutral warm palette of sand, oatmeal, taupe and natural oak tones',
  },
  dark: {
    label: 'Dark & Dramatic',
    swatch: 'linear-gradient(135deg,#2a2522 0%,#3d3632 50%,#1f1b18 100%)',
    prompt: 'dark dramatic palette of charcoal, near-black and deep espresso with moody contrast',
  },
  twotone: {
    label: 'Two-Tone',
    swatch: 'linear-gradient(180deg,#f2ede5 0%,#f2ede5 50%,#3a3531 50%,#3a3531 100%)',
    prompt: 'two-tone scheme with light upper wall units and dark base units or a dark contrasting island',
  },
};

export const WORKTOPS = {
  quartz: {
    label: 'Quartz',
    sub: 'Durable, low maintenance',
    tag: 'Premium',
    swatch: 'linear-gradient(135deg,#e6e2dc 0%,#d7d2cb 50%,#efebe5 100%)',
    prompt: 'polished quartz worktops with subtle veining',
    priceFactor: 1.0,
  },
  granite: {
    label: 'Granite',
    sub: 'Natural stone, heat resistant',
    tag: 'Premium',
    swatch: 'linear-gradient(135deg,#4a4642 0%,#605b56 50%,#3b3733 100%)',
    prompt: 'natural granite worktops with speckled mineral texture',
    priceFactor: 1.03,
  },
  laminate: {
    label: 'Laminate',
    sub: 'Huge range of finishes',
    tag: 'Most affordable',
    swatch: 'linear-gradient(135deg,#d0c8bd 0%,#c2b9ad 50%,#b5ab9f 100%)',
    prompt: 'high-quality laminate worktops in a stone-effect finish',
    priceFactor: 0.9,
  },
  wood: {
    label: 'Solid Wood',
    sub: 'Oak or walnut',
    tag: 'Mid-range',
    swatch: 'linear-gradient(135deg,#a77b57 0%,#b8896a 50%,#9a7050 100%)',
    prompt: 'solid oak butcher-block worktops with a warm oiled finish',
    priceFactor: 0.95,
  },
};

export const PRIORITIES = {
  storage: { label: 'Storage & Organisation', icon: '🗄️', prompt: 'emphasise generous tall storage, deep pan drawers and organised cabinetry' },
  entertaining: { label: 'Entertaining & Socialising', icon: '🥂', prompt: 'emphasise a sociable layout with seating and open circulation space' },
  cooking: { label: 'Cooking & Functionality', icon: '🍳', prompt: 'emphasise a practical cooking zone with a quality hob, extractor and ample prep space' },
  aesthetics: { label: 'Aesthetics & Design', icon: '✨', prompt: 'emphasise striking visual design, symmetry and premium finishes' },
};

export const MUST_HAVES = {
  island: { label: 'Island', icon: '🏝️', prompt: 'a kitchen island', price: 0.06 },
  breakfastBar: { label: 'Breakfast Bar', icon: '🪑', prompt: 'a breakfast bar with stools', price: 0.03 },
  belfast: { label: 'Belfast Sink', icon: '🚰', prompt: 'a white ceramic Belfast sink', price: 0.02 },
  integrated: { label: 'Integrated Appliances', icon: '🔌', prompt: 'fully integrated appliances hidden behind cabinet doors', price: 0.05 },
  pantry: { label: 'Pantry / Larder', icon: '🥫', prompt: 'a tall larder or pantry cupboard', price: 0.03 },
  lighting: { label: 'Statement Lighting', icon: '💡', prompt: 'statement pendant lighting', price: 0.02 },
  wine: { label: 'Wine Storage', icon: '🍷', prompt: 'built-in wine storage or a wine cooler', price: 0.02 },
  shelving: { label: 'Open Shelving', icon: '📚', prompt: 'open floating shelves', price: 0.01 },
  boilingTap: { label: 'Boiling Water Tap', icon: '♨️', prompt: 'a boiling water tap', price: 0.01 },
};

export const BUDGET = { min: 5000, max: 60000, step: 500, default: 15000 };

export function publicOptions() {
  const strip = (obj) =>
    Object.fromEntries(
      Object.entries(obj).map(([k, v]) => {
        const { prompt, priceFactor, price, ...rest } = v;
        return [k, rest];
      })
    );
  return {
    styles: strip(STYLES),
    colours: strip(COLOURS),
    worktops: strip(WORKTOPS),
    priorities: strip(PRIORITIES),
    mustHaves: strip(MUST_HAVES),
    budget: BUDGET,
  };
}
