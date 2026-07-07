import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildModelDescriptor } from './bridge-config.mjs'

test('builds anthropic provider descriptor from env, no mimo hardcoding', () => {
  const d = buildModelDescriptor({
    PI_BASE_URL: 'https://gw.example.com/anthropic',
    PI_API_KEY: 'sk-test',
    PI_MODEL_ID: 'mimo-v2.5',
    PI_HEADERS_JSON: '{"user":"admin"}',
    PI_CONTEXT_WINDOW: '80000',
    PI_MAX_TOKENS: '8192',
  })
  assert.equal(d.baseUrl, 'https://gw.example.com/anthropic')
  assert.equal(d.apiKey, 'sk-test')
  assert.deepEqual(d.headers, { user: 'admin' })
  assert.equal(d.models[0].id, 'mimo-v2.5')
  assert.equal(d.models[0].contextWindow, 80000)
  assert.equal(d.models[0].maxTokens, 8192)
})

test('missing base_url or key throws (fail fast, no silent default)', () => {
  assert.throws(() => buildModelDescriptor({ PI_MODEL_ID: 'x' }), /PI_BASE_URL|PI_API_KEY/)
})

test('absent headers -> empty object', () => {
  const d = buildModelDescriptor({
    PI_BASE_URL: 'u', PI_API_KEY: 'k', PI_MODEL_ID: 'm',
  })
  assert.deepEqual(d.headers, {})
})
