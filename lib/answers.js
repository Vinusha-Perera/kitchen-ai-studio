import { STYLES, COLOURS, WORKTOPS, PRIORITIES, MUST_HAVES, BUDGET } from './options.js';
import { chooseLayout } from './prompt.js';

const pick = (val, table) => (typeof val === 'string' && table[val] ? val : null);
const num = (v, min, max) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? Math.round(n * 100) / 100 : null;
};
const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/**
 * Validate and normalise the wizard answers. Unknown keys are dropped,
 * skipped steps become null, so nothing from the browser reaches the prompt unchecked.
 */
export function normaliseAnswers(raw) {
  let a = raw;
  if (typeof raw === 'string') {
    try { a = JSON.parse(raw); } catch { throw new Error('Answers must be valid JSON'); }
  }
  if (!a || typeof a !== 'object') throw new Error('Missing answers');

  const budget = Number(a.budget);
  const answers = {
    roomType: a.roomType === 'empty' ? 'empty' : 'existing',
    width: num(a.width, 1, 30),
    depth: num(a.depth, 1, 30),
    ceiling: num(a.ceiling, 1.8, 6),
    budget: Number.isFinite(budget) ? Math.min(BUDGET.max, Math.max(BUDGET.min, Math.round(budget))) : BUDGET.default,
    style: pick(a.style, STYLES),
    colour: pick(a.colour, COLOURS),
    worktop: pick(a.worktop, WORKTOPS),
    priority: pick(a.priority, PRIORITIES),
    mustHaves: Array.isArray(a.mustHaves) ? [...new Set(a.mustHaves.filter((m) => MUST_HAVES[m]))] : [],
    contact: {
      name: text(a.contact?.name, 80),
      email: text(a.contact?.email, 120),
      phone: text(a.contact?.phone, 30),
      postcode: text(a.contact?.postcode, 12).toUpperCase(),
      consent: a.contact?.consent === true,
    },
  };

  const { email } = answers.contact;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('A valid email is required');
  if (!answers.contact.name) throw new Error('Name is required');
  if (!answers.contact.consent) throw new Error('Consent is required');
  return answers;
}

/** Layout shown to the customer, including why an island was swapped if the room is too small. */
function layoutLabel(a) {
  const { layout, note } = chooseLayout(a);
  const nice = layout.charAt(0).toUpperCase() + layout.slice(1);
  return note ? `${nice}. ${note}` : nice;
}

/** Human-readable spec lines, used on the results page and in the Design Pack. */
export function specLines(a) {
  const lbl = (table, key) => (key ? table[key].label : 'N/A');
  const dims = [a.width && `${a.width}m wide`, a.depth && `${a.depth}m deep`, a.ceiling && `${a.ceiling}m ceiling`]
    .filter(Boolean)
    .join(' · ');
  return [
    ['Room', a.roomType === 'empty' ? 'Empty room' : 'Existing kitchen'],
    ['Size', dims || 'N/A'],
    ['Layout', layoutLabel(a)],
    ['Style', lbl(STYLES, a.style)],
    ['Colour', lbl(COLOURS, a.colour)],
    ['Worktop', lbl(WORKTOPS, a.worktop)],
    ['Priority', lbl(PRIORITIES, a.priority)],
    ['Must-haves', a.mustHaves.length ? a.mustHaves.map((m) => MUST_HAVES[m].label).join(', ') : 'None'],
    ['Budget', `£${a.budget.toLocaleString('en-GB')}`],
  ];
}