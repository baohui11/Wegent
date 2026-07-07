import { spawn } from 'node:child_process'
import { countToolCalls } from './tool-counts.mjs'

// Spawn pi (cwd = workspace), enforce a hard wall-clock timeout, collect
// stdout, count real tool executions. piCmd is [bin, ...args] (injectable).
export function runPi({ piCmd, cwd, env, timeoutMs, toolNames }) {
  return new Promise((resolve) => {
    const [bin, ...args] = piCmd
    // stdin MUST be closed ('ignore'), not the spawn default 'pipe': pi blocks
    // on an open stdin and never starts the agent loop, so an open pipe hangs
    // it until the timeout kills it (0 tool calls). Verified in the Phase-1 spike.
    const proc = spawn(bin, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    let timedOut = false
    proc.stdout.on('data', (d) => (out += d.toString()))
    proc.stderr.on('data', (d) => (out += d.toString()))
    const timer = setTimeout(() => {
      timedOut = true
      proc.kill('SIGKILL')
    }, timeoutMs)
    proc.on('error', (e) => {
      clearTimeout(timer)
      resolve({ status: 'error', logText: String(e), toolCalls: countToolCalls('', toolNames) })
    })
    proc.on('close', () => {
      clearTimeout(timer)
      resolve({
        status: timedOut ? 'timeout' : 'agent',
        logText: out,
        toolCalls: countToolCalls(out, toolNames),
      })
    })
  })
}
