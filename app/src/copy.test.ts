import assert from 'node:assert/strict'
import test from 'node:test'
import {
  alreadyCopy,
  checkCopy,
  clip,
  confirmCopy,
  dueCounts,
  errorText,
  idleCopy,
  jakartaToday,
  listHeader,
  listItem,
  listeningCopy,
  pairExpiredCopy,
  promiseList,
  savedCopy,
  utf8Bytes,
} from './copy.ts'
import type { Extraction, Task } from './api.ts'

const extraction = {
  isCommitment: true,
  title: 'send pricing',
  dueISO: '2026-11-27',
  dueLabel: 'FRI 27 NOV',
  confidence: 0.9,
  confirmToken: 'token',
  person: null,
  direction: null,
} satisfies Extraction

test('confirm copy drops the owner line and listening can be stopped', () => {
  const confirm = confirmCopy(extraction)
  assert.equal(confirm.includes('owner:'), false)
  assert.match(confirm, /SAVE THIS\?/)
  assert.match(listeningCopy(12), /\[press\] stop/)
  assert.match(checkCopy({ ...extraction, confidence: 0.2 }), /CHECK THIS\?/)
  assert.match(checkCopy(extraction), /DUE  ----/)
  assert.match(alreadyCopy('send pricing'), /save anyway/)
  assert.match(pairExpiredCopy(), /Code expired\./)
  assert.match(pairExpiredCopy(), /\[press\] new code/)
  assert.match(listHeader(), /\[press\] select/)
  assert.match(savedCopy('send pricing', 'FRI 27 NOV', true), /\[press\] undo/)
})

test('displayed titles cap at 28 characters and list rows cap at 63 bytes', () => {
  const long = 'send the revised pricing sheet to the client today'
  const clipped = clip(long)
  assert.ok([...clipped].length <= 28)
  assert.ok(clipped.endsWith('…'))
  const row = listItem(`${'é'.repeat(40)} pricing`, 'FRI 27 NOV')
  assert.ok(utf8Bytes(row) <= 63)
  const ascii = listItem('send pricing', 'TOMORROW')
  assert.ok(utf8Bytes(ascii) <= 63)
  assert.match(ascii, /TOMORROW/)
})

test('idle counts today and late promises and hides a zero line', () => {
  const today = '2026-11-24'
  assert.equal(jakartaToday(new Date('2026-11-24T03:00:00.000Z')), today)
  const tasks: Task[] = [
    { id: 'a', title: 'late one', due: '2026-11-20', dueLabel: 'FRI 20 NOV', done: false, person: null, direction: null },
    { id: 'b', title: 'today one', due: today, dueLabel: 'TODAY', done: false, person: null, direction: null },
    { id: 'c', title: 'today two', due: today, dueLabel: 'TODAY', done: false, person: null, direction: null },
  ]
  assert.deepEqual(dueCounts(tasks, today), { today: 2, late: 1 })
  const shown = idleCopy(tasks, { today, week: { kept: 8, total: 10 } })
  assert.match(shown, /2 DUE TODAY  1 LATE/)
  assert.match(shown, /KEPT 8\/10 THIS WEEK/)
  const quiet = idleCopy([], { today, week: { kept: 0, total: 0 } })
  assert.equal(quiet.includes('DUE TODAY'), false)
  assert.equal(quiet.includes('THIS WEEK'), false)
  assert.match(idleCopy(tasks, { today, offline: true }), /offline/)
})

test('confirm copy names the person and direction', () => {
  const owe = confirmCopy({ ...extraction, person: 'Sari', direction: 'I owe' })
  assert.match(owe, /FOR SARI · I OWE/)
  const owed = confirmCopy({ ...extraction, person: 'Budi', direction: 'Owed to me' })
  assert.match(owed, /FOR BUDI · OWED TO ME/)
  const unnamed = confirmCopy({ ...extraction, person: null, direction: 'I owe' })
  assert.match(unnamed, /^I OWE$/m)
  assert.equal(unnamed.includes('FOR '), false)
  const plain = confirmCopy(extraction)
  assert.equal(plain.includes('I OWE'), false)
  assert.equal(plain.includes('OWED TO ME'), false)
  assert.equal(plain.split('\n').length, 4)
  const check = checkCopy({ ...extraction, confidence: 0.2, person: 'Sari', direction: 'I owe' })
  assert.match(check, /CHECK THIS\?/)
  assert.match(check, /FOR SARI · I OWE/)
  assert.match(check, /DUE  ----/)
})

test('idle prefers the most urgent debt and the list splits by direction', () => {
  const today = '2026-11-24'
  const tasks: Task[] = [
    { id: 'late', title: 'old deck', due: '2026-11-20', dueLabel: 'FRI 20 NOV', done: false, person: 'Sari', direction: 'I owe' },
    { id: 'soon', title: 'send pricing', due: '2026-11-27', dueLabel: 'FRI 27 NOV', done: false, person: null, direction: 'I owe' },
    { id: 'budi', title: 'pay invoice', due: '2026-11-27', dueLabel: 'FRI 27 NOV', done: false, person: 'Budi', direction: 'Owed to me' },
    { id: 'self', title: 'book flight', due: '2026-11-24', dueLabel: 'TODAY', done: false, person: null, direction: null },
  ]
  const idle = idleCopy(tasks, { today, offline: true, week: { kept: 8, total: 10 } })
  assert.match(idle, /I OWE SARI · FRI 20 NOV/)
  assert.match(idle, /KEPT 8\/10 THIS WEEK/)
  assert.match(idle, /offline/)
  assert.match(idle, /\[press\] listen  \[swipe\] list/)
  assert.equal(idle.includes('next due:'), false)
  const listed = promiseList(tasks)
  assert.equal(listed.rows[0], 'I OWE · 2')
  assert.match(listed.rows[1] ?? '', /old deck/)
  assert.ok(listed.rows.includes('OWED TO ME · 1'))
  assert.ok(listed.rows.includes('OTHER · 1'))
  assert.equal(listed.tasks[0], null)
  const onlyDebt = promiseList(tasks.filter((task) => task.direction === 'I owe'))
  assert.equal(onlyDebt.rows.some((row) => row.startsWith('OTHER')), false)
  assert.equal(onlyDebt.rows.some((row) => row.startsWith('OWED')), false)
})

test('error copy is a short complete sentence', () => {
  const expired = errorText('expired')
  assert.equal(expired.detail, 'Expired. Speak again.')
  assert.match(expired.action, /\[press\] speak/)
  const save = errorText('save')
  assert.equal(save.detail, 'Notion did not save.')
  assert.equal(save.detail.includes('...'), false)
})
