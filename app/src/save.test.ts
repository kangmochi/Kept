import assert from 'node:assert/strict'
import test from 'node:test'
import { claimSave, interpretSaveFailure, shouldResetSession } from './save.ts'

test('a second save press is ignored while the first request is in flight', () => {
  assert.equal(claimSave(false), true)
  assert.equal(claimSave(true), false)
})

test('a consumed confirm token shows saved, and an expired one does not retry', () => {
  assert.equal(interpretSaveFailure(409, 'consumed'), 'saved')
  assert.equal(interpretSaveFailure(409, 'expired'), 'expired')
  assert.equal(interpretSaveFailure(409, 'mismatch'), 'failed')
  assert.equal(interpretSaveFailure(502, undefined), 'failed')
})

test('any 401 clears the session', () => {
  assert.equal(shouldResetSession(401), true)
  assert.equal(shouldResetSession(503), false)
})
