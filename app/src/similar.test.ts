import assert from 'node:assert/strict'
import test from 'node:test'
import { findDuplicate, tokenOverlap } from './similar.ts'
import type { Extraction, Task } from './api.ts'

const open: Task[] = [
  { id: 'page-1', title: 'send pricing', due: '2026-11-27', dueLabel: 'FRI 27 NOV', done: false },
  { id: 'page-2', title: 'call the bank', due: null, dueLabel: '----', done: false },
]

function extraction(title: string, dueISO: string | null): Extraction {
  return {
    isCommitment: true,
    title,
    dueISO,
    dueLabel: dueISO ? 'FRI 27 NOV' : '----',
    confidence: 0.9,
    confirmToken: 'token',
  }
}

test('token overlap ignores case and small words', () => {
  assert.ok(tokenOverlap('Send the pricing', 'send pricing') >= 0.8)
  assert.ok(tokenOverlap('send pricing', 'call the bank') < 0.8)
})

test('a duplicate needs a similar title and the same due date', () => {
  assert.equal(findDuplicate(extraction('Send pricing', '2026-11-27'), open)?.id, 'page-1')
  assert.equal(findDuplicate(extraction('Send pricing', null), open), null)
  assert.equal(findDuplicate(extraction('call bank', null), open)?.id, 'page-2')
  assert.equal(findDuplicate(extraction('review the deck', null), open), null)
})
