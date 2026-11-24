import assert from 'node:assert/strict'
import test from 'node:test'
import { issueSession } from './auth.js'
import { createApp, type NotionOps } from './app.js'
import type { Env } from './env.js'
import type { LlmClient } from './extract.js'
import type { Task } from './types.js'
import { pcmToWav } from './wav.js'

const SECRET = 'test-session-secret'

function env(overrides: Partial<Env> = {}): Env {
  return {
    allowDevPair: true,
    pairingTtlSeconds: 300,
    sessionSecret: SECRET,
    ephemeralSecret: false,
    notionToken: '',
    notionDatabaseId: '',
    notionDataSourceId: '',
    llmBaseUrl: 'https://example.test/v1',
    llmApiKey: '',
    llmModel: 'test',
    sttBaseUrl: 'https://example.test/v1',
    sttApiKey: '',
    sttModel: 'test',
    port: 8787,
    host: '127.0.0.1',
    tz: 'Asia/Jakarta',
    ...overrides,
  }
}

class MemoryNotion implements NotionOps {
  tasks: Task[] = [
    { id: 'page-1', title: 'seeded row', due: '2026-11-24', dueLabel: 'TODAY', done: false },
  ]
  lastTranscript = ''
  trashed = new Set<string>()

  async queryOpen(): Promise<Task[]> {
    return this.tasks.filter((task) => !task.done && !this.trashed.has(task.id))
  }

  async queryWeek(start: string, end: string): Promise<Task[]> {
    return this.tasks.filter((task) => task.due && task.due >= start && task.due <= end && !this.trashed.has(task.id))
  }

  async create(input: { title: string; dueISO: string | null; transcript: string }) {
    this.lastTranscript = input.transcript
    const task: Task = {
      id: `page-${this.tasks.length + 1}`,
      title: input.title,
      due: input.dueISO,
      dueLabel: input.dueISO ? 'DUE' : '----',
      done: false,
    }
    this.tasks.push(task)
    return { notionPageId: task.id, url: 'https://www.notion.so/kept-example' }
  }

  async setDone(id: string, done: boolean) {
    const task = this.tasks.find((item) => item.id === id)
    if (!task) throw new Error('Notion page was not found')
    task.done = done
  }

  async trash(id: string) {
    const task = this.tasks.find((item) => item.id === id)
    if (!task) throw new Error('Notion page was not found')
    this.trashed.add(id)
  }
}

function llm(handler: (user: string) => string | Promise<string>): LlmClient {
  return { complete: (_system, user) => Promise.resolve(handler(user)) }
}

const TUESDAY = new Date('2026-11-24T03:00:00.000Z')

function build(options: { llm?: LlmClient; notion?: MemoryNotion; remote?: string; failStt?: boolean; heard?: string; clock?: Date } = {}) {
  const notion = options.notion ?? new MemoryNotion()
  const app = createApp({
    env: env(),
    llm: options.llm ?? llm(() => JSON.stringify({ isCommitment: true, title: 'send pricing', dueISO: null, confidence: 0.9 })),
    transcribe: async (body) => {
      if (options.failStt) throw new Error('Transcription failed')
      assert.equal(body.subarray(0, 4).toString('ascii'), 'RIFF')
      return options.heard ?? "I'll send the pricing by Friday"
    },
    notion,
    remoteAddress: () => options.remote ?? '127.0.0.1',
    now: () => options.clock ?? TUESDAY,
  })
  return { app, notion }
}

async function json(response: Response) {
  return response.json() as Promise<Record<string, unknown>>
}

test('health, CORS, and dev pairing', async () => {
  const { app } = build()
  const health = await app.request('http://localhost/health')
  assert.equal(health.status, 200)
  assert.deepEqual(await health.json(), { ok: true })
  assert.equal(health.headers.get('access-control-allow-origin'), null)

  const allowed = await app.request('http://localhost/health', { headers: { origin: 'http://localhost:5173' } })
  assert.equal(allowed.headers.get('access-control-allow-origin'), 'http://localhost:5173')
  const hub = await app.request('http://localhost/health', { headers: { origin: 'evenhub://app' } })
  assert.equal(hub.headers.get('access-control-allow-origin'), 'evenhub://app')
  const blockedOrigin = await app.request('http://localhost/health', { headers: { origin: 'https://evil.example' } })
  assert.equal(blockedOrigin.headers.get('access-control-allow-origin'), null)

  const preflight = await app.request('http://localhost/extract', {
    method: 'OPTIONS',
    headers: { origin: 'http://127.0.0.1:5173' },
  })
  assert.equal(preflight.status, 204)
  assert.equal(preflight.headers.get('access-control-allow-origin'), 'http://127.0.0.1:5173')
  assert.match(preflight.headers.get('access-control-allow-methods') ?? '', /DELETE/)
  assert.match(preflight.headers.get('access-control-allow-methods') ?? '', /PATCH/)
  assert.match(preflight.headers.get('access-control-allow-headers') ?? '', /Authorization/)

  const denied = await app.request('http://localhost/tasks')
  assert.equal(denied.status, 401)

  const remote = build({ remote: '10.1.1.1' })
  const blocked = await remote.app.request('http://localhost/pair', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: 'dev' }),
  })
  assert.equal(blocked.status, 403)

  const paired = await app.request('http://localhost/pair', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: 'dev' }),
  })
  assert.equal(paired.status, 200)
  const token = (await json(paired)).sessionToken
  assert.equal(typeof token, 'string')
})

test('challenge pairing reaches a session token', async () => {
  const { app } = build()
  const challenge = await json(await app.request('http://localhost/pair/challenge'))
  const code = challenge.code as string
  assert.match(code, /^\d{6}$/)
  const pending = await json(await app.request(`http://localhost/pair/status?code=${code}`))
  assert.equal(pending.status, 'pending')
  const posted = await app.request('http://localhost/pair', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code }),
  })
  assert.equal(posted.status, 200)
  const status = await json(await app.request(`http://localhost/pair/status?code=${code}`))
  assert.equal(status.status, 'paired')
  assert.equal(typeof status.sessionToken, 'string')
})

test('empty extract is 400 and a dateless promise can be saved once', async () => {
  const { app, notion } = build()
  const token = issueSession(SECRET, TUESDAY.getTime())
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' }

  const empty = await app.request('http://localhost/extract', {
    method: 'POST',
    headers,
    body: JSON.stringify({ text: '   ' }),
  })
  assert.equal(empty.status, 400)

  const extracted = await json(
    await app.request('http://localhost/inject-text', {
      method: 'POST',
      headers,
      body: JSON.stringify({ text: 'remind me to review the deck' }),
    }),
  )
  assert.equal(extracted.isCommitment, true)
  assert.equal(extracted.dueISO, null)
  assert.equal(typeof extracted.confirmToken, 'string')

  const mismatch = await app.request('http://localhost/tasks', {
    method: 'POST',
    headers,
    body: JSON.stringify({ title: 'other', dueISO: null, confirmToken: extracted.confirmToken }),
  })
  assert.equal(mismatch.status, 409)

  const saved = await json(
    await app.request('http://localhost/tasks', {
      method: 'POST',
      headers,
      body: JSON.stringify({ title: extracted.title, dueISO: null, confirmToken: extracted.confirmToken }),
    }),
  )
  assert.equal(typeof saved.notionPageId, 'string')
  assert.match(notion.lastTranscript, /^remind me to review the deck$/)

  const again = await app.request('http://localhost/tasks', {
    method: 'POST',
    headers,
    body: JSON.stringify({ title: extracted.title, dueISO: null, confirmToken: extracted.confirmToken }),
  })
  assert.equal(again.status, 409)
})

test('Friday extract, list, and mark done', async () => {
  const { app, notion } = build({
    llm: llm(() => JSON.stringify({ isCommitment: true, title: 'send pricing', dueISO: null, confidence: 0.91 })),
  })
  const token = issueSession(SECRET, TUESDAY.getTime())
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
  const open = (await app.request('http://localhost/tasks?scope=open', { headers })).json() as Promise<Task[]>
  assert.equal((await open).length, 1)

  const extracted = await json(
    await app.request('http://localhost/extract', {
      method: 'POST',
      headers,
      body: JSON.stringify({ text: "I'll send the pricing by Friday" }),
    }),
  )
  assert.equal(extracted.dueISO, '2026-11-27')
  assert.equal(extracted.dueLabel, 'FRI 27 NOV')

  const saved = await json(
    await app.request('http://localhost/tasks', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        title: extracted.title,
        dueISO: extracted.dueISO,
        confirmToken: extracted.confirmToken,
      }),
    }),
  )
  assert.match(notion.lastTranscript, /pricing by Friday/)

  const patched = await app.request(`http://localhost/tasks/${saved.notionPageId}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ done: true }),
  })
  assert.equal(patched.status, 200)
  const left = (await (await app.request('http://localhost/tasks?scope=open', { headers })).json()) as Task[]
  assert.equal(left.length, 1)
})

test('a failed model falls back to the last good extract for the same text', async () => {
  let fail = false
  const { app } = build({
    llm: llm(() => {
      if (fail) throw new Error('model down')
      return JSON.stringify({ isCommitment: true, title: 'send pricing', dueISO: null, confidence: 0.9 })
    }),
  })
  const token = issueSession(SECRET, TUESDAY.getTime())
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
  const body = JSON.stringify({ text: "I'll send the pricing by Friday" })
  const first = await json(await app.request('http://localhost/extract', { method: 'POST', headers, body }))
  assert.equal(first.dueISO, '2026-11-27')
  fail = true
  const second = await json(await app.request('http://localhost/extract', { method: 'POST', headers, body }))
  assert.equal(second.dueISO, '2026-11-27')
  assert.equal(second.title, first.title)
  assert.notEqual(second.confirmToken, first.confirmToken)

  const other = await app.request('http://localhost/extract', {
    method: 'POST',
    headers,
    body: JSON.stringify({ text: 'I will mail the contract by Monday' }),
  })
  assert.equal(other.status, 502)
})

test('listen wraps raw PCM and reports a provider failure', async () => {
  const ok = build()
  const token = issueSession(SECRET, TUESDAY.getTime())
  const pcm = Buffer.alloc(3200, 0)
  const heard = await ok.app.request('http://localhost/listen', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream' },
    body: pcm,
  })
  assert.equal(heard.status, 200)
  assert.match(((await json(heard)).text as string) ?? '', /Friday/)

  const bad = build({ failStt: true })
  const failed = await bad.app.request('http://localhost/listen', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'audio/wav' },
    body: pcmToWav(pcm),
  })
  assert.equal(failed.status, 502)
})

test('pair status rate-limits the session token and reports expiry', async () => {
  const clock = new Date(TUESDAY.getTime())
  const { app } = build({ clock })
  const challenge = await json(await app.request('http://localhost/pair/challenge'))
  const code = challenge.code as string
  await app.request('http://localhost/pair', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code }),
  })
  const first = await json(await app.request(`http://localhost/pair/status?code=${code}`))
  const second = await json(await app.request(`http://localhost/pair/status?code=${code}`))
  assert.equal(typeof first.sessionToken, 'string')
  assert.equal(second.status, 'paired')
  assert.equal(second.sessionToken, undefined)
  clock.setTime(clock.getTime() + 300_000)
  const expired = await json(await app.request(`http://localhost/pair/status?code=${code}`))
  assert.equal(expired.status, 'expired')
  assert.equal(expired.sessionToken, undefined)
})

test('a confirm token lasts 10 minutes, then says to speak again', async () => {
  const clock = new Date(TUESDAY.getTime())
  const { app } = build({ clock })
  const token = issueSession(SECRET, TUESDAY.getTime())
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
  const extracted = await json(
    await app.request('http://localhost/extract', {
      method: 'POST',
      headers,
      body: JSON.stringify({ text: 'remind me to review the deck' }),
    }),
  )
  clock.setTime(clock.getTime() + 10 * 60 * 1000)
  const expired = await json(
    await app.request('http://localhost/tasks', {
      method: 'POST',
      headers,
      body: JSON.stringify({ title: extracted.title, dueISO: null, confirmToken: extracted.confirmToken }),
    }),
  )
  assert.equal(expired.code, 'expired')
  assert.equal(expired.error, 'Expired. Speak again.')
})

test('saving the same confirm token twice reports consumed', async () => {
  const { app } = build()
  const token = issueSession(SECRET, TUESDAY.getTime())
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
  const extracted = await json(
    await app.request('http://localhost/extract', {
      method: 'POST',
      headers,
      body: JSON.stringify({ text: 'remind me to review the deck' }),
    }),
  )
  const body = JSON.stringify({ title: extracted.title, dueISO: null, confirmToken: extracted.confirmToken })
  const saved = await app.request('http://localhost/tasks', { method: 'POST', headers, body })
  assert.equal(saved.status, 200)
  const again = await json(await app.request('http://localhost/tasks', { method: 'POST', headers, body }))
  assert.equal(again.code, 'consumed')
})

test('done can be cleared, undo trashes a fresh page, and the week score counts both', async () => {
  const clock = new Date(TUESDAY.getTime())
  const { app, notion } = build({ clock })
  const token = issueSession(SECRET, TUESDAY.getTime())
  const other = issueSession(SECRET, TUESDAY.getTime() + 1)
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
  const before = await json(await app.request('http://localhost/stats/week', { headers }))
  assert.equal(before.kept, 0)
  assert.equal(before.total, 1)

  const extracted = await json(
    await app.request('http://localhost/extract', {
      method: 'POST',
      headers,
      body: JSON.stringify({ text: "I'll send the pricing by Friday" }),
    }),
  )
  const saved = await json(
    await app.request('http://localhost/tasks', {
      method: 'POST',
      headers,
      body: JSON.stringify({ title: extracted.title, dueISO: extracted.dueISO, confirmToken: extracted.confirmToken }),
    }),
  )
  const id = saved.notionPageId as string
  const marked = await app.request(`http://localhost/tasks/${id}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ done: true }),
  })
  assert.equal(marked.status, 200)
  const cleared = await app.request(`http://localhost/tasks/${id}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ done: false }),
  })
  assert.equal(cleared.status, 200)
  const open = (await (await app.request('http://localhost/tasks?scope=open', { headers })).json()) as Task[]
  assert.equal(open.some((task) => task.id === id), true)

  const stranger = await app.request(`http://localhost/tasks/${id}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${other}` },
  })
  assert.equal(stranger.status, 404)
  const undone = await app.request(`http://localhost/tasks/${id}`, { method: 'DELETE', headers })
  assert.equal(undone.status, 200)
  assert.equal(notion.trashed.has(id), true)
  clock.setTime(clock.getTime() + 60_000)
  const late = await app.request(`http://localhost/tasks/page-1`, { method: 'DELETE', headers })
  assert.equal(late.status, 404)

  const score = await json(await app.request('http://localhost/stats/week', { headers }))
  assert.equal(score.total, 1)
  assert.equal(score.kept, 0)
})

test('listen corrects info C to invoice before the glasses extract it', async () => {
  const { app } = build({ heard: 'Bayar info C besok' })
  const token = issueSession(SECRET, TUESDAY.getTime())
  const heard = await json(
    await app.request('http://localhost/listen', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream' },
      body: Buffer.alloc(3200, 0),
    }),
  )
  assert.equal(heard.text, 'Bayar invoice besok')
})

test('a non-commitment has a null title and zero confidence', async () => {
  const { app } = build()
  const token = issueSession(SECRET, TUESDAY.getTime())
  const result = await json(
    await app.request('http://localhost/extract', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'ok sip' }),
    }),
  )
  assert.equal(result.isCommitment, false)
  assert.equal(result.title, null)
  assert.equal(result.confidence, 0)
  assert.equal(result.dueISO, null)
})
