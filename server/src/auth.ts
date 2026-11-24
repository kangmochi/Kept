import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

export type SessionPayload = { v: 1; exp: number }

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000

function sign(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('base64url')
}

export function issueSession(secret: string, now = Date.now()): string {
  const payload: SessionPayload = { v: 1, exp: now + SESSION_TTL_MS }
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${body}.${sign(body, secret)}`
}

export function readSession(token: string, secret: string, now = Date.now()): SessionPayload | null {
  const parts = token.split('.')
  if (parts.length !== 2) return null
  const [body, sig] = parts
  const expected = sign(body, secret)
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionPayload
    if (payload.v !== 1 || typeof payload.exp !== 'number' || payload.exp < now) return null
    return payload
  } catch {
    return null
  }
}

export function bearerToken(header: string | undefined): string | null {
  if (!header) return null
  const match = header.match(/^Bearer\s+(\S+)$/i)
  return match ? match[1] : null
}

export function isLoopback(address: string | undefined): boolean {
  if (!address) return false
  const host = address.toLowerCase().replace(/^\[|\]$/g, '')
  return host === '127.0.0.1' || host === '::1' || host === '::ffff:127.0.0.1' || host === 'localhost'
}

export function newPairCode(): string {
  const n = Number.parseInt(randomBytes(3).toString('hex'), 16) % 1_000_000
  return n.toString().padStart(6, '0')
}
