import assert from 'node:assert/strict'
import test from 'node:test'
import { CONFIRM_TTL_MS, ConfirmStore } from './confirm.js'

const record = {
  title: 'send pricing',
  dueISO: '2026-11-27',
  transcript: 'by Friday',
  isCommitment: true,
  person: null,
  direction: null,
}

test('a confirm token lasts 10 minutes and a mismatch does not consume it', () => {
  const store = new ConfirmStore()
  const start = 1_000_000
  const token = store.issue(record, start)
  assert.equal(CONFIRM_TTL_MS, 10 * 60 * 1000)
  const mismatch = store.consume(token, 'other', record.dueISO, start + 1000)
  assert.equal(mismatch.ok, false)
  if (!mismatch.ok) assert.equal(mismatch.reason, 'mismatch')
  const ok = store.consume(token, record.title, record.dueISO, start + CONFIRM_TTL_MS - 1)
  assert.equal(ok.ok, true)
})

test('an expired token is distinct from one that already saved', () => {
  const store = new ConfirmStore()
  const start = 1_000_000
  const expired = store.issue(record, start)
  const dead = store.consume(expired, record.title, record.dueISO, start + CONFIRM_TTL_MS)
  assert.equal(dead.ok, false)
  if (!dead.ok) assert.equal(dead.reason, 'expired')

  const used = store.issue(record, start)
  const saved = store.consume(used, record.title, record.dueISO, start + 10)
  assert.equal(saved.ok, true)
  store.remember(used, start + 10)
  const again = store.consume(used, record.title, record.dueISO, start + 20)
  assert.equal(again.ok, false)
  if (!again.ok) assert.equal(again.reason, 'consumed')
})
