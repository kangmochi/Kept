import { Hono } from 'hono'
import type { Context } from 'hono'
import { bearerToken, isLoopback, issueSession, newPairCode, readSession } from './auth.js'
import { LastGoodCache } from './cache.js'
import { ConfirmStore } from './confirm.js'
import { ExtractError, extractCommitment, normalizeUtterance, type LlmClient } from './extract.js'
import type { Env } from './env.js'
import { ensureWav, MAX_PCM_BYTES } from './wav.js'
import type { Extraction, Task } from './types.js'

export interface NotionOps {
  queryOpen(): Promise<Task[]>
  create(input: { title: string; dueISO: string | null; transcript: string }): Promise<{ notionPageId: string; url: string }>
  markDone(id: string): Promise<void>
}

export type AppDeps = {
  env: Env
  llm: LlmClient
  transcribe: (body: Buffer) => Promise<string>
  notion: NotionOps
  remoteAddress?: (c: Context) => string | undefined
  now?: () => Date
}

type Challenge = { expiresAt: number; sessionToken?: string }

const OPEN = new Set(['/health', '/pair', '/pair/challenge', '/pair/status', '/link'])

const cors: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case '&':
        return '&amp;'
      case '<':
        return '&lt;'
      case '>':
        return '&gt;'
      case '"':
        return '&quot;'
      default:
        return '&#39;'
    }
  })
}

function linkPage(message = ''): string {
  const note = message ? `<p class="note">${escapeHtml(message)}</p>` : ''
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Kept — pair</title>
  <style>
    :root { color-scheme: dark; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #232323; color: #e5e5e5;
      font: 16px/1.4 -apple-system, BlinkMacSystemFont, system-ui, sans-serif; }
    main { width: min(420px, calc(100% - 32px)); }
    h1 { font-size: 20px; letter-spacing: 0.08em; margin: 0 0 8px; }
    p { color: #a7a7a7; margin: 0 0 16px; }
    form { display: flex; gap: 8px; }
    input { flex: 1; font: inherit; padding: 12px; border-radius: 10px; border: 1px solid #3e3e3e; background: #2e2e2e; color: inherit; }
    button { font: inherit; padding: 12px 16px; border-radius: 10px; border: 0; background: #3cfa44; color: #111; font-weight: 600; }
    .note { color: #e5e5e5; }
  </style>
</head>
<body>
  <main>
    <h1>KEPT</h1>
    <p>Type the code shown on the glasses.</p>
    ${note}
    <form method="post" action="/pair">
      <input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="12" required />
      <button type="submit">Pair</button>
    </form>
  </main>
</body>
</html>`
}

export function createApp(deps: AppDeps) {
  const app = new Hono()
  const challenges = new Map<string, Challenge>()
  const confirms = new ConfirmStore()
  const cache = new LastGoodCache<Extraction>()
  const now = () => deps.now?.() ?? new Date()

  app.use('*', async (c, next) => {
    if (c.req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
    await next()
    for (const [key, value] of Object.entries(cors)) c.res.headers.set(key, value)
  })

  app.use('*', async (c, next) => {
    const path = c.req.path
    if (OPEN.has(path)) return next()
    const token = bearerToken(c.req.header('authorization'))
    if (!token || !readSession(token, deps.env.sessionSecret, now().getTime())) {
      return c.json({ error: 'Sign in with a pairing code first' }, 401)
    }
    await next()
  })

  app.get('/health', (c) => c.json({ ok: true }))

  app.get('/link', (c) => c.html(linkPage()))

  app.get('/pair/challenge', (c) => {
    const code = newPairCode()
    const expiresAt = now().getTime() + deps.env.pairingTtlSeconds * 1000
    challenges.set(code, { expiresAt })
    return c.json({ code, expiresAt })
  })

  app.get('/pair/status', (c) => {
    const code = c.req.query('code')?.trim() ?? ''
    const challenge = challenges.get(code)
    if (!challenge) return c.json({ status: 'unknown' })
    if (challenge.expiresAt < now().getTime()) return c.json({ status: 'expired' })
    if (!challenge.sessionToken) return c.json({ status: 'pending' })
    return c.json({ status: 'paired', sessionToken: challenge.sessionToken })
  })

  app.post('/pair', async (c) => {
    const { code, html } = await readCode(c)
    const remote = deps.remoteAddress?.(c)
    if (code === 'dev') {
      if (!deps.env.allowDevPair || !isLoopback(remote)) {
        const error = 'Dev pairing is only available from loopback when ALLOW_DEV_PAIR=1'
        return html ? c.html(linkPage(error), 403) : c.json({ error }, 403)
      }
      return c.json({ sessionToken: issueSession(deps.env.sessionSecret, now().getTime()) })
    }
    const challenge = challenges.get(code)
    if (!challenge || challenge.expiresAt < now().getTime()) {
      const error = 'That code is unknown or expired'
      return html ? c.html(linkPage(error), 400) : c.json({ error }, 400)
    }
    challenge.sessionToken ??= issueSession(deps.env.sessionSecret, now().getTime())
    if (html) return c.html(linkPage('Paired. Look back at the glasses.'))
    return c.json({ sessionToken: challenge.sessionToken })
  })

  app.get('/tasks', async (c) => {
    const scope = c.req.query('scope') ?? 'open'
    if (scope !== 'open') return c.json({ error: 'scope must be open' }, 400)
    try {
      const tasks = await deps.notion.queryOpen()
      return c.json(tasks)
    } catch (err) {
      return c.json({ error: publicError(err, 'Could not read Notion') }, 503)
    }
  })

  app.post('/listen', async (c) => {
    const length = Number(c.req.header('content-length') ?? 0)
    if (length > MAX_PCM_BYTES + 128) return c.json({ error: 'Audio is longer than 20 seconds' }, 413)
    const body = Buffer.from(await c.req.arrayBuffer())
    if (body.length === 0) return c.json({ error: 'Audio body is empty' }, 400)
    if (body.length > MAX_PCM_BYTES + 128) return c.json({ error: 'Audio is longer than 20 seconds' }, 413)
    try {
      const text = await deps.transcribe(ensureWav(body))
      return c.json({ text: text.slice(0, 2000) })
    } catch (err) {
      return c.json({ error: publicError(err, 'Transcription failed') }, 502)
    }
  })

  app.post('/extract', async (c) => {
    const body = await readJson(c)
    const text = typeof body.text === 'string' ? body.text : ''
    try {
      const extraction = await runExtract(text)
      return c.json(seal(extraction, normalizeUtterance(text)))
    } catch (err) {
      return extractionError(c, err)
    }
  })

  app.post('/inject-text', async (c) => {
    const body = await readJson(c)
    const text = typeof body.text === 'string' ? body.text : ''
    try {
      const extraction = await runExtract(text)
      return c.json({ text: normalizeUtterance(text), ...seal(extraction, normalizeUtterance(text)) })
    } catch (err) {
      return extractionError(c, err)
    }
  })

  app.post('/tasks', async (c) => {
    const body = await readJson(c)
    const title = typeof body.title === 'string' ? body.title : ''
    const dueISO = typeof body.dueISO === 'string' && body.dueISO ? body.dueISO : null
    const confirmToken = typeof body.confirmToken === 'string' ? body.confirmToken : ''
    const record = confirms.consume(confirmToken, title, dueISO, now().getTime())
    if (!record) return c.json({ error: 'Confirm token is missing, expired, or does not match this promise' }, 409)
    try {
      const created = await deps.notion.create({ title, dueISO, transcript: record.transcript })
      return c.json(created)
    } catch (err) {
      return c.json({ error: publicError(err, 'Could not save to Notion') }, 502)
    }
  })

  app.patch('/tasks/:id', async (c) => {
    const body = await readJson(c)
    if (body.done !== true) return c.json({ error: 'Send done: true' }, 400)
    try {
      await deps.notion.markDone(c.req.param('id'))
      return c.json({ ok: true })
    } catch (err) {
      return c.json({ error: publicError(err, 'Could not update Notion') }, 502)
    }
  })

  async function runExtract(text: string): Promise<Extraction> {
    const utterance = normalizeUtterance(text)
    const key = utterance.toLowerCase()
    const attempt = () => extractCommitment(utterance, deps.llm, now(), deps.env.tz)
    try {
      const result = await attempt()
      cache.set(key, result)
      return result
    } catch (err) {
      if (err instanceof ExtractError && err.status < 500) throw err
      try {
        const result = await attempt()
        cache.set(key, result)
        return result
      } catch (retryErr) {
        const cached = cache.get(key)
        if (cached) return cached
        throw retryErr
      }
    }
  }

  function seal(extraction: Extraction, transcript: string) {
    const confirmToken = confirms.issue(
      {
        title: extraction.title,
        dueISO: extraction.dueISO,
        transcript,
        isCommitment: extraction.isCommitment,
      },
      now().getTime(),
    )
    return { ...extraction, confirmToken }
  }

  return app
}

async function readCode(c: Context): Promise<{ code: string; html: boolean }> {
  const type = c.req.header('content-type') ?? ''
  if (type.includes('application/json')) {
    const body = await readJson(c)
    return { code: typeof body.code === 'string' ? body.code.trim() : '', html: false }
  }
  const form = await c.req.parseBody()
  const value = form.code
  return { code: typeof value === 'string' ? value.trim() : '', html: true }
}

async function readJson(c: Context): Promise<Record<string, unknown>> {
  try {
    const body = await c.req.json()
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function extractionError(c: Context, err: unknown) {
  if (err instanceof ExtractError) return c.json({ error: err.message }, err.status as 400)
  return c.json({ error: 'Could not extract a commitment' }, 502)
}

function publicError(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message && !looksLikeSecret(err.message)) return err.message
  return fallback
}

function looksLikeSecret(message: string): boolean {
  return /secret_[A-Za-z0-9]|ntn_[A-Za-z0-9]|sk-[A-Za-z0-9]|Bearer\s+\S+/i.test(message)
}
