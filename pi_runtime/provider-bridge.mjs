// Loaded by PI via `-e`. Registers the built-in "anthropic" provider pointed
// at the caller-supplied endpoint. Config comes from env (set per spawn).
import { buildModelDescriptor } from './lib/bridge-config.mjs'

export default function (pi) {
  const d = buildModelDescriptor(process.env)
  pi.registerProvider('anthropic', {
    baseUrl: d.baseUrl,
    apiKey: d.apiKey,
    headers: d.headers,
    api: 'anthropic-messages',
    models: d.models,
  })
}
