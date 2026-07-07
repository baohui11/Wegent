import Fastify from 'fastify'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { runPi } from './lib/run-pi.mjs'
import { draftSection } from './lib/handler.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PI_RUNTIME_PORT || 8300)
const WORKSPACE_ROOT = process.env.BID_WORKSPACE_ROOT || null
const PI_BIN = process.env.PI_BIN || join(HERE, 'node_modules', '.bin', 'pi')
const BRIDGE = join(HERE, 'provider-bridge.mjs')

const app = Fastify({ logger: true })
app.get('/health', async () => ({ status: 'healthy' }))
app.post('/internal/pi/draft-section', async (req, reply) => {
  try {
    return await draftSection(req.body, {
      runPi, workspaceRoot: WORKSPACE_ROOT, piBin: PI_BIN, bridgePath: BRIDGE,
    })
  } catch (e) {
    reply.code(400)
    return { status: 'error', error: String(e) }
  }
})
app.listen({ port: PORT, host: '0.0.0.0' })
