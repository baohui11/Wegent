import { test } from 'node:test'
import assert from 'node:assert/strict'
import { countToolCalls } from './tool-counts.mjs'

const TOOLS = ['read', 'grep', 'find', 'ls', 'write', 'edit']

test('counts tool_execution_start only, ignores streaming message_update re-emits', () => {
  const log = [
    '{"type":"message_update","toolName":"read"}',
    '{"type":"message_update","toolName":"read"}',
    '{"type":"tool_execution_start","toolCallId":"a","toolName":"read"}',
    '{"type":"message_update","toolName":"write"}',
    '{"type":"tool_execution_start","toolCallId":"b","toolName":"write"}',
    '{"type":"tool_execution_start","toolCallId":"c","toolName":"edit"}',
  ].join('\n')
  const c = countToolCalls(log, TOOLS)
  assert.equal(c.read, 1)   // not 3
  assert.equal(c.write, 1)
  assert.equal(c.edit, 1)
  assert.equal(c.total, 3)
})

test('empty log -> all zero', () => {
  const c = countToolCalls('', TOOLS)
  assert.equal(c.total, 0)
  assert.equal(c.read, 0)
})
