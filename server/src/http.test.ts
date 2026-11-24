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

  async queryOpen(): Promise<Task[]> {
    return this.tasks.filter((task) => !task.done)
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

  async markDone(id: string) {
    const task = this.tasks.find((item) => item.id === id)
    if (!task) throw new Error('Notion page was not found')
    task.done = true
  }
}

function llm(handler: (user: string) => string | Promise<string>): LlmClient {
  return { complete: (_system, user) => Promise.resolve(handler(user)) }
}

const TUESDAY = new Date('2026-11-24T03:00:00.000Z')

function build(options: { llm?: LlmClient; notion?: MemoryNotion; remote?: string; failStt?: boolean } = {}) {
  const notion = options.notion ?? new MemoryNotion()
  const app = createApp({
    env: env(),
    llm: options.llm ?? llm(() => JSON.stringify({ isCommitment: true, title: 'send pricing', dueISO: null, confidence: 0.9 })),
    transcribe: async (body) => {
      if (options.failStt) throw new Error('Transcription failed')
      assert.equal(body.subarray(0, 4).toString('ascii'), 'RIFF')
      return "I'll send the pricing by Friday"
    },
    notion,
    remoteAddress: () => options.remote ?? '127.0.0.1',
    now: () => TUESDAY,
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
  assert.equal(health.headers.get('access-control-allow-origin'), '*')

  const preflight = await app.request('http://localhost/extract', { method: 'OPTIONS' })
  assert.equal(preflight.status, 204)
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
  assert.equal(extracted.dueLabel, 'Fri 27 Nov')

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
