import * as bedrock from './bedrock.js';
import * as openai from './openai.js';
import * as mock from './mock.js';

const providers = { bedrock, openai, mock };

/**
 * Pick the provider from IMAGE_PROVIDER (default: bedrock).
 * Every provider exports renderKitchen({ prompt, photo, answers }) and returns a PNG Buffer.
 */
export function getProvider() {
  const name = (process.env.IMAGE_PROVIDER || 'bedrock').toLowerCase();
  const p = providers[name];
  if (!p) throw new Error(`Unknown IMAGE_PROVIDER "${name}". Use one of: ${Object.keys(providers).join(', ')}`);
  return { name, ...p };
}