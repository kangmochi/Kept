import assert from 'node:assert/strict'
import test from 'node:test'
import { correctTranscript } from './stt-correct.js'

test('invoice mishears are whole words and case-insensitive', () => {
  assert.equal(correctTranscript('Bayar info C besok'), 'Bayar invoice besok')
  assert.equal(correctTranscript('INFO SEE the file'), 'invoice the file')
  assert.equal(correctTranscript('kirim invois'), 'kirim invoice')
  assert.equal(correctTranscript('information center'), 'information center')
  assert.equal(correctTranscript('see you'), 'see you')
})
