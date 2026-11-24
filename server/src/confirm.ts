import { randomBytes } from 'node:crypto'
import type { Direction } from './types.js'

export type ConfirmRecord = {
  title: string
  dueISO: string | null
  transcript: string
  isCommitment: boolean
  person: string | null
  direction: Direction | null
  exp: number
}

/** Long enough to read SAVE THIS? out loud and decide. A dead token is not retried. */
export const CONFIRM_TTL_MS = 10 * 60 * 1000
const CONSUMED_MS = CONFIRM_TTL_MS

export type ConsumeResult =
  | { ok: true; record: ConfirmRecord }
  | { ok: false; reason: 'missing' | 'expired' | 'mismatch' | 'consumed' }

export class ConfirmStore {
  private records = new Map<string, ConfirmRecord>()
  private consumed = new Map<string, number>()
  private expired = new Map<string, number>()

  issue(record: Omit<ConfirmRecord, 'exp'>, now = Date.now()): string {
    this.prune(now)
    const token = randomBytes(18).toString('base64url')
    this.records.set(token, { ...record, exp: now + CONFIRM_TTL_MS })
    return token
  }

  /**
   * Single use. A mismatch does not consume the token, so a bad client retry
   * within the window can still succeed with the bound title and date.
   * A token that already saved a row stays "consumed" so a double press can
   * show SAVED instead of failing.
   */
  consume(token: string, title: string, dueISO: string | null, now = Date.now()): ConsumeResult {
    this.prune(now)
    const spentUntil = this.consumed.get(token)
    if (spentUntil !== undefined && spentUntil >= now) return { ok: false, reason: 'consumed' }
    if (this.expired.has(token)) return { ok: false, reason: 'expired' }
    const record = this.records.get(token)
    if (!record) return { ok: false, reason: 'missing' }
    if (record.exp <= now) {
      this.records.delete(token)
      return { ok: false, reason: 'expired' }
    }
    const sameTitle = record.title === title
    const sameDue = (record.dueISO ?? null) === (dueISO ?? null)
    if (!sameTitle || !sameDue || !record.isCommitment) return { ok: false, reason: 'mismatch' }
    this.records.delete(token)
    return { ok: true, record }
  }

  /** Call after Notion accepts the page, so a retry of this token counts as already saved. */
  remember(token: string, now = Date.now()) {
    this.consumed.set(token, now + CONSUMED_MS)
  }

  /** Put a token back when Notion rejected the create, so the glasses can retry. */
  restore(token: string, record: ConfirmRecord, now = Date.now()) {
    if (this.consumed.has(token)) return
    if (record.exp <= now) return
    this.records.set(token, record)
  }

  private prune(now: number) {
    for (const [token, record] of this.records) {
      if (record.exp <= now) {
        this.records.delete(token)
        this.expired.set(token, record.exp)
      }
    }
    for (const [token, exp] of this.expired) {
      if (now - exp > 24 * 60 * 60 * 1000) this.expired.delete(token)
    }
    for (const [token, exp] of this.consumed) {
      if (exp <= now) this.consumed.delete(token)
    }
  }
}
