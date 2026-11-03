import * as openai from './openai.js';
import * as mock from './mock.js';

const providers = { openai, mock };

/** Pick the provider from IMAGE_PROVIDER. Add Replicate, Stability etc. here with the same renderKitchen() signature. */
export function getProvider() {
  const name = (process.env.IMAGE_PROVIDER || 'openai').toLowerCase();
  const p = providers[name];
  if (!p) throw new Error(`Unknown IMAGE_PROVIDER "${name}". Use one of: ${Object.keys(providers).join(', ')}`);
  return { name, ...p };
}
