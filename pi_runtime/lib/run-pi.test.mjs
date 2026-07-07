import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runPi } from './run-pi.mjs'
import { fileURLToPath } from 'node:url'

const FAKE = fileURLToPath(new URL('./__fixtures__/fake-pi.mjs', import.meta.url))
const TOOLS = ['read', 'write']

test('collects stdout + counts tool_execution_start on normal exit', async () => {
  const r = await runPi({
    piCmd: ['node', FAKE, 'emit'], cwd: process.cwd(), promptFile: '/dev/null',
    env: {}, timeoutMs: 5000, toolNames: TOOLS,
  })
  assert.equal(r.status, 'agent')
  assert.equal(r.toolCalls.read, 1)
  assert.equal(r.toolCalls.write, 1)
})

test('kills the process and returns timeout when it overruns', async () => {
  const r = await runPi({
    piCmd: ['node', FAKE, 'hang'], cwd: process.cwd(), promptFile: '/dev/null',
    env: {}, timeoutMs: 300, toolNames: TOOLS,
  })
  assert.equal(r.status, 'timeout')
})

test('closes stdin so a stdin-blocking child (like pi) finishes instead of hanging', async () => {
  // fake-pi 'waitstdin' only exits on stdin EOF. If spawn left stdin as an open
  // pipe it would hang and this test would time out; with stdin 'ignore' it EOFs
  // immediately, emits a tool call, and exits agent. Locks the Phase-1 spike fix.
  const r = await runPi({
    piCmd: ['node', FAKE, 'waitstdin'], cwd: process.cwd(), promptFile: '/dev/null',
    env: {}, timeoutMs: 3000, toolNames: TOOLS,
  })
  assert.equal(r.status, 'agent')
  assert.equal(r.toolCalls.read, 1)
})
