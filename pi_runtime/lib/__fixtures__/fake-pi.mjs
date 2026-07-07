const mode = process.argv[2]
if (mode === 'emit') {
  process.stdout.write(
    '{"type":"tool_execution_start","toolName":"read"}\n' +
    '{"type":"tool_execution_start","toolName":"write"}\n',
  )
  process.exit(0)
} else if (mode === 'hang') {
  setTimeout(() => process.exit(0), 60000) // longer than the test timeout
}
