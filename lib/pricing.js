import { WORKTOPS, MUST_HAVES } from './options.js';

const round100 = (n) => Math.round(n / 100) * 100;

/**
 * Indicative price range shown to the customer.
 * Base band is 82%–112% of their budget (a £15,000 budget with quartz and no extras
 * gives £12,300–£16,800, matching the existing Design Pack). Worktop choice and
 * must-haves nudge the band. Tune these numbers to your real pricing.
 */
export function estimatePrice(a) {
  let factor = a.worktop ? WORKTOPS[a.worktop].priceFactor : 1;
  factor *= 1 + a.mustHaves.reduce((sum, m) => sum + MUST_HAVES[m].price, 0);

  const low = round100(a.budget * 0.82 * factor);
  const high = round100(a.budget * 1.12 * factor);
  const fmt = (n) => `£${n.toLocaleString('en-GB')}`;
  return { low, high, label: `${fmt(low)} – ${fmt(high)}` };
}
