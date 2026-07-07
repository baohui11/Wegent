import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'

// Build pi argv identical to the validated harness (run_arm_c.py::pi_cmd).
function piCmd(piBin, promptFile, modelId, tools, bridgePath) {
  return [
    piBin, '-p', `@${promptFile}`,
    '--provider', 'anthropic', '--model', modelId,
    '--tools', tools.join(','),
    '-e', bridgePath,
    '--no-session', '--no-context-files', '--thinking', 'off', '--mode', 'json',
  ]
}

export async function draftSection(body, deps) {
  const { runPi, workspaceRoot, piBin, bridgePath } = deps
  const ws = resolve(body.workspace_path)
  if (workspaceRoot) {
    const root = resolve(workspaceRoot)
    if (ws !== root && !ws.startsWith(root + sep)) {
      throw new Error(`workspace_path escapes workspace root: ${ws}`)
    }
  }
  const promptFile = join(ws, `_pi_prompt_${body.section_id}.txt`)
  writeFileSync(promptFile, body.prompt, 'utf8')

  const m = body.model
  const env = {
    PI_BASE_URL: m.base_url, PI_API_KEY: m.api_key, PI_MODEL_ID: m.id,
    PI_HEADERS_JSON: JSON.stringify(m.headers || {}),
    PI_CONTEXT_WINDOW: String(m.context_window || 80000),
    PI_MAX_TOKENS: String(m.max_tokens || 8192),
  }
  const r = await runPi({
    piCmd: piCmd(piBin, promptFile, m.id, body.tools, bridgePath),
    cwd: ws, env, timeoutMs: (body.timeout_s || 420) * 1000, toolNames: body.tools,
  })
  // The drafting prompt writes to workspace/sections/<id>.md (matching the
  // validated bake-off layout + BidWorkspace), NOT <ws>/sections/.
  const secPath = join(ws, 'workspace', 'sections', `${body.section_id}.md`)
  const section_chars = existsSync(secPath) ? readFileSync(secPath, 'utf8').length : 0
  return { status: r.status, section_chars, tool_calls: r.toolCalls, log_ref: null }
}
