import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { draftSection } from './handler.mjs'

test('returns section_chars from the written section file + passes model env to pi', async () => {
  const ws = mkdtempSync(join(tmpdir(), 'ws-'))
  mkdirSync(join(ws, 'workspace', 'sections'), { recursive: true })
  let capturedEnv
  const fakeRunPi = async ({ env }) => {
    capturedEnv = env
    writeFileSync(join(ws, 'workspace', 'sections', 's1.md'), '正文内容三十字'.repeat(3))
    return { status: 'agent', logText: '', toolCalls: { read: 2, total: 2 } }
  }
  const res = await draftSection(
    {
      workspace_path: ws, section_id: 's1', prompt: 'PROMPT',
      tools: ['read', 'write'],
      model: { id: 'm', base_url: 'u', api_key: 'k', headers: { user: 'admin' } },
      timeout_s: 5, max_iters: 10,
    },
    { runPi: fakeRunPi, piBin: '/bin/pi', bridgePath: '/bridge.mjs' },
  )
  assert.equal(res.status, 'agent')
  assert.ok(res.section_chars > 0)
  assert.equal(res.tool_calls.read, 2)
  assert.equal(capturedEnv.PI_BASE_URL, 'u')
  assert.equal(capturedEnv.PI_API_KEY, 'k')
  assert.equal(capturedEnv.PI_HEADERS_JSON, '{"user":"admin"}')
  rmSync(ws, { recursive: true, force: true })
})

test('rejects a workspace_path escaping the workspace root', async () => {
  await assert.rejects(
    () => draftSection(
      { workspace_path: '/etc', section_id: 's', prompt: 'p', tools: [], model: { id: 'm', base_url: 'u', api_key: 'k' } },
      { runPi: async () => ({}), workspaceRoot: '/data/bid', piBin: '/bin/pi', bridgePath: '/b.mjs' },
    ),
    /workspace_path/,
  )
})
