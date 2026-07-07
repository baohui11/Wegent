// Count REAL tool executions via `tool_execution_start` events (1 per call).
// A raw-byte regex over `"name":"..."` double-counts every streaming
// `message_update` re-emit (~14x inflation); parse per line instead.
export function countToolCalls(logText, toolNames) {
  const counts = Object.fromEntries(toolNames.map((n) => [n, 0]))
  const re = new RegExp(
    `"type"\\s*:\\s*"tool_execution_start"[^\\n]*?"toolName"\\s*:\\s*"(${toolNames.join('|')})"`,
  )
  for (const line of logText.split('\n')) {
    const m = line.match(re)
    if (m) counts[m[1]] += 1
  }
  counts.total = toolNames.reduce((s, n) => s + counts[n], 0)
  return counts
}
