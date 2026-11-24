#!/usr/bin/env node
/**
 * Drives the Even Hub simulator control plane (verified against the 0.9.5 README).
 *
 * Start the backend and Vite first, then either:
 *   evenhub-simulator "http://localhost:5173/?inject=I'll%20send%20the%20pricing%20by%20Friday" --automation-port 9898
 *   npm run demo:auto
 * or let this script launch the simulator and kill it when finished:
 *   npm run demo:auto -- --spawn
 *
 * DEMO_INJECT="I'll send the pricing by Friday" also POSTs /inject-text to the backend.
 * EXIT_CHECK=1 sends a root double-press after the click and logs the lit-pixel change.
 */

import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const { PNG } = require('pngjs')

const SIM = process.env.SIM_URL || 'http://127.0.0.1:9898'
const API = process.env.KEPT_API || 'http://127.0.0.1:8787'
const READY = '[kept] ready'
const MIN_WAIT_MS = 4000

async function main() {
  const spawnSim = process.argv.includes('--spawn')
  let child = null
  if (spawnSim) {
    const url = process.env.KEPT_APP_URL || 'http://localhost:5173/?inject=I%27ll%20send%20the%20pricing%20by%20Friday'
    child = spawn('evenhub-simulator', [url, '--automation-port', '9898'], { stdio: 'inherit' })
  }
  try {
    await ping()
    const started = Date.now()
    await waitReady()
    const remain = MIN_WAIT_MS - (Date.now() - started)
    if (remain > 0) await sleep(remain)

    const boot = await screenshot('boot')
    const bootLit = litCount(boot)
    console.log(`boot lit pixels: ${bootLit}`)
    if (bootLit <= 0) throw new Error('boot screenshot has no lit pixels (alpha > 0)')

    if (process.env.DEMO_INJECT) await injectBackend(process.env.DEMO_INJECT)

    await input('click')
    await sleep(1000)
    const after = await screenshot('after-click')
    const afterLit = litCount(after)
    console.log(`after click lit pixels: ${afterLit}`)
    if (afterLit <= 0) throw new Error('post-click screenshot has no lit pixels')
    if (same(boot, after)) console.log('framebuffer unchanged after one click (the screen may already have been on the target state)')
    else console.log('framebuffer changed after click')

    if (process.env.EXIT_CHECK === '1') {
      await input('double_click')
      await sleep(800)
      const exitShot = await screenshot('exit')
      const exitLit = litCount(exitShot)
      console.log(`double-click lit pixels: ${afterLit} -> ${exitLit}`)
    }
    console.log('demo automation finished')
  } finally {
    if (child && !child.killed) child.kill('SIGTERM')
  }
}

async function ping() {
  const response = await fetch(`${SIM}/api/ping`)
  const text = await response.text()
  if (!response.ok || !text.toLowerCase().includes('pong')) {
    throw new Error(`simulator ping failed: ${response.status} ${text.slice(0, 120)}`)
  }
}

async function waitReady() {
  const deadline = Date.now() + 30_000
  let since = 0
  while (Date.now() < deadline) {
    const entries = await consoleSince(since)
    for (const entry of entries) {
      if (typeof entry.id === 'number') since = Math.max(since, entry.id)
      if (String(entry.message ?? '').includes(READY)) return
    }
    await sleep(250)
  }
  throw new Error(`timed out waiting for ${READY}`)
}

async function consoleSince(since) {
  const response = await fetch(`${SIM}/api/console?since_id=${since}`)
  if (!response.ok) throw new Error(`console poll failed: ${response.status}`)
  const data = await response.json()
  return Array.isArray(data.entries) ? data.entries : []
}

async function input(action) {
  const response = await fetch(`${SIM}/api/input`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action }),
  })
  if (!response.ok) throw new Error(`input ${action} failed: ${response.status}`)
}

async function screenshot(name) {
  const response = await fetch(`${SIM}/api/screenshot/glasses`)
  if (!response.ok) throw new Error(`screenshot failed: ${response.status}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  const png = PNG.sync.read(bytes)
  if (png.width !== 576 || png.height !== 288) {
    throw new Error(`expected 576x288 RGBA, got ${png.width}x${png.height}`)
  }
  const dir = join(tmpdir(), 'kept-demo')
  await mkdir(dir, { recursive: true })
  const file = join(dir, `${name}.png`)
  await writeFile(file, bytes)
  console.log(`wrote ${file}`)
  return png
}

function litCount(png) {
  let count = 0
  for (let i = 3; i < png.data.length; i += 4) {
    if (png.data[i] > 0) count += 1
  }
  return count
}

function same(a, b) {
  return Buffer.compare(a.data, b.data) === 0
}

async function injectBackend(text) {
  const paired = await fetch(`${API}/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: 'dev' }),
  })
  if (!paired.ok) {
    console.log(`dev pair returned ${paired.status}; backend inject smoke check skipped`)
    return
  }
  const { sessionToken } = await paired.json()
  const extracted = await fetch(`${API}/inject-text`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${sessionToken}`,
    },
    body: JSON.stringify({ text }),
  })
  const body = await extracted.json()
  if (!extracted.ok) throw new Error(body.error || `inject-text failed (${extracted.status})`)
  console.log(`inject-text isCommitment=${body.isCommitment} dueISO=${body.dueISO ?? 'null'} title=${body.title}`)
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
