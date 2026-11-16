import { spawn } from 'node:child_process'

const node = process.execPath
const api = spawn(node, ['server/index.mjs'], { stdio: 'inherit' })
let web
let stopping = false

async function waitForApi() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (api.exitCode !== null) throw new Error('Monitor API exited before startup')
    try {
      const response = await fetch('http://127.0.0.1:4174/api/health', { signal: AbortSignal.timeout(500) })
      if (response.ok) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('Monitor API did not become ready')
}

function stop() {
  if (stopping) return
  stopping = true
  api.kill()
  web?.kill()
}

process.on('SIGINT', stop)
process.on('SIGTERM', stop)

try {
  await waitForApi()
  web = spawn(node, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1'], { stdio: 'inherit' })
  web.on('exit', (code) => {
    stop()
    process.exitCode = code || 0
  })
  api.on('exit', (code) => {
    if (!stopping) {
      console.error(`Monitor API exited with code ${code}`)
      stop()
      process.exitCode = code || 1
    }
  })
} catch (error) {
  console.error(error.message)
  stop()
  process.exitCode = 1
}
