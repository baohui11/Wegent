// Build PI's anthropic-provider model descriptor from injected env — no
// hardcoded endpoint. All fields come from the caller's resolved model_config.
export function buildModelDescriptor(env) {
  const baseUrl = env.PI_BASE_URL
  const apiKey = env.PI_API_KEY
  if (!baseUrl) throw new Error('PI_BASE_URL required')
  if (!apiKey) throw new Error('PI_API_KEY required')
  const id = env.PI_MODEL_ID || 'model'
  return {
    baseUrl,
    apiKey,
    headers: env.PI_HEADERS_JSON ? JSON.parse(env.PI_HEADERS_JSON) : {},
    models: [
      {
        id,
        name: id,
        reasoning: true,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: Number(env.PI_CONTEXT_WINDOW || 80000),
        maxTokens: Number(env.PI_MAX_TOKENS || 8192),
      },
    ],
  }
}
