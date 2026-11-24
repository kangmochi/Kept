import assert from 'node:assert/strict'
import test from 'node:test'
import { addDays, dueLabel, resolveDue, upcomingWeekday, zonedISO } from './dates.js'

const TUESDAY = new Date('2026-11-24T03:00:00.000Z')

test('reads Asia/Jakarta calendar dates', () => {
  assert.equal(zonedISO(TUESDAY, 'Asia/Jakarta'), '2026-11-24')
  assert.equal(zonedISO(new Date('2026-11-24T17:30:00.000Z'), 'Asia/Jakarta'), '2026-11-25')
})

test('coming Friday and tomorrow in WIB', () => {
  assert.equal(resolveDue("I'll send the pricing by Friday", TUESDAY), '2026-11-27')
  assert.equal(resolveDue("I'll call Budi tomorrow", TUESDAY), '2026-11-25')
  assert.equal(resolveDue('Besok aku telepon Budi', TUESDAY), '2026-11-25')
  assert.equal(resolveDue('Jumat depan aku kirim deck', TUESDAY), '2026-11-27')
})

test('a bare weekday includes today, next skips today', () => {
  const friday = new Date('2026-11-27T03:00:00.000Z')
  assert.equal(zonedISO(friday, 'Asia/Jakarta'), '2026-11-27')
  assert.equal(resolveDue('by Friday', friday), '2026-11-27')
  assert.equal(resolveDue('next Friday', friday), '2026-12-04')
  assert.equal(upcomingWeekday('2026-11-27', 5, false), '2026-11-27')
  assert.equal(upcomingWeekday('2026-11-27', 5, true), '2026-12-04')
})

test('does not invent a date', () => {
  assert.equal(resolveDue('remind me to review the deck', TUESDAY), null)
  assert.equal(resolveDue('thanks, see you', TUESDAY), null)
  assert.equal(resolveDue('ok sip', TUESDAY), null)
})

test('due labels', () => {
  assert.equal(dueLabel(null, TUESDAY), '----')
  assert.equal(dueLabel('2026-11-24', TUESDAY), 'TODAY')
  assert.equal(dueLabel('2026-11-25', TUESDAY), 'TOMORROW')
  assert.equal(dueLabel('2026-11-27', TUESDAY), 'Fri 27 Nov')
  assert.equal(addDays('2026-11-30', 1), '2026-12-01')
})
