import { STYLES, COLOURS, WORKTOPS, PRIORITIES, MUST_HAVES } from './options.js';

// Sensible fallbacks when a step was skipped.
const DEFAULT_STYLE = 'a tasteful, current fitted kitchen';
const DEFAULT_COLOUR = 'a balanced, timeless colour palette';
const DEFAULT_WORKTOP = 'quartz worktops';

/**
 * Build the image prompt from validated answers.
 * hasPhoto = true  -> instructions for editing the customer's photo (keep the room, change the kitchen)
 * hasPhoto = false -> instructions for generating an example kitchen from scratch
 */
export function buildPrompt(a, hasPhoto) {
  const style = a.style ? STYLES[a.style].prompt : DEFAULT_STYLE;
  const colour = a.colour ? COLOURS[a.colour].prompt : DEFAULT_COLOUR;
  const worktop = a.worktop ? WORKTOPS[a.worktop].prompt : DEFAULT_WORKTOP;
  const priority = a.priority ? PRIORITIES[a.priority].prompt : '';
  const features = a.mustHaves.map((m) => MUST_HAVES[m].prompt);

  const size = a.width && a.depth
    ? `The room is about ${a.width}m wide by ${a.depth}m deep${a.ceiling ? ` with a ${a.ceiling}m ceiling` : ''}; keep proportions realistic for that size${a.width * a.depth < 10 ? ' and only include an island if it genuinely fits' : ''}.`
    : '';

  const design = [
    `Design: ${style}.`,
    `Colours: ${colour}.`,
    `Worktops: ${worktop}.`,
    features.length ? `Include: ${features.join(', ')}.` : '',
    priority ? `Priority: ${priority}.` : '',
    size,
  ].filter(Boolean).join(' ');

  const quality =
    'Photorealistic interior photograph, natural daylight, accurate materials and reflections, ' +
    'professional kitchen-showroom quality. No people, no text, no logos, no watermarks.';

  if (!hasPhoto) {
    return `A newly fitted UK home kitchen, shot from a standing eye-level wide angle. ${design} ${quality}`;
  }

  const task = a.roomType === 'empty'
    ? 'This photo shows an empty room. Install a complete new fitted kitchen into it.'
    : 'This photo shows an existing kitchen. Replace the cabinetry, worktops, splashback, appliances and lighting with a completely new kitchen.';

  return [
    task,
    'Keep the room itself exactly as photographed: the same camera position, angle and lens, the same walls, windows, doors, ceiling height, flooring layout and perspective. Do not move windows or doors.',
    design,
    quality,
  ].join(' ');
}
