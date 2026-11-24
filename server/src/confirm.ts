import { randomBytes } from 'node:crypto'

export type ConfirmRecord = {
  title: string
  dueISO: string | null
  transcript: string
  isCommitment: boolean
  exp: number
}

const TTL_MS = 60_000

export class ConfirmStore {
  private records = new Map<string, ConfirmRecord>()

  issue(record: Omit<ConfirmRecord, 'exp'>, now = Date.now()): string {
    this.prune(now)
    const token = randomBytes(18).toString('base64url')
    this.records.set(token, { ...record, exp: now + TTL_MS })
    return token
  }

  /**
   * Single use. A mismatch does not consume the token, so a bad client retry
   * within the minute can still succeed with the bound title and date.
   * Returns the bound transcript on success.
   */
  consume(token: string, title: string, dueISO: string | null, now = Date.now()): ConfirmRecord | null {
    this.prune(now)
    const record = this.records.get(token)
    if (!record) return null
    if (record.exp < now) {
      this.records.delete(token)
      return null
    }
    const sameTitle = record.title === title
    const sameDue = (record.dueISO ?? null) === (dueISO ?? null)
    if (!sameTitle || !sameDue || !record.isCommitment) return null
    this.records.delete(token)
    return record
  }

  private prune(now: number) {
    for (const [token, record] of this.records) {
      if (record.exp < now) this.records.delete(token)
    }
  }
}
