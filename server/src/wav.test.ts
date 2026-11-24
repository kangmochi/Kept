import assert from 'node:assert/strict'
import test from 'node:test'
import { MAX_PCM_BYTES, ensureWav, pcmToWav } from './wav.js'

test('wraps raw s16le PCM in a 16 kHz mono WAV header', () => {
  const pcm = Buffer.alloc(3200, 1)
  const wav = pcmToWav(pcm)
  assert.equal(wav.subarray(0, 4).toString('ascii'), 'RIFF')
  assert.equal(wav.subarray(8, 12).toString('ascii'), 'WAVE')
  assert.equal(wav.readUInt16LE(22), 1)
  assert.equal(wav.readUInt32LE(24), 16000)
  assert.equal(wav.readUInt16LE(34), 16)
  assert.equal(wav.readUInt32LE(40), 3200)
  assert.equal(wav.length, 44 + 3200)
})

test('ensureWav wraps PCM and caps a long buffer at 20 seconds', () => {
  const pcm = Buffer.alloc(MAX_PCM_BYTES + 8000, 2)
  const wav = ensureWav(pcm)
  assert.equal(wav.readUInt32LE(40), MAX_PCM_BYTES)
  assert.equal(wav.length, 44 + MAX_PCM_BYTES)
})

test('ensureWav rewraps an existing WAV so the data stays capped', () => {
  const original = pcmToWav(Buffer.alloc(1000, 3))
  const again = ensureWav(original)
  assert.equal(again.readUInt32LE(40), 1000)
  assert.equal(again[44], 3)
})
