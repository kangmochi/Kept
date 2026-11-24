import assert from 'node:assert/strict'
import test from 'node:test'
import { createSilenceWatch, pcmRms } from './silence.ts'

function pcm(samples: number, amplitude: number): Uint8Array {
  const bytes = new Uint8Array(samples * 2)
  const view = new DataView(bytes.buffer)
  for (let i = 0; i < samples; i += 1) view.setInt16(i * 2, amplitude, true)
  return bytes
}

test('RMS separates silence from speech', () => {
  assert.equal(pcmRms(pcm(1600, 0)), 0)
  assert.ok(pcmRms(pcm(1600, 8000)) > 0.02)
})

test('listening stops after about 1.5s of silence once speech has started', () => {
  const watch = createSilenceWatch()
  const speech = pcm(1600, 8000)
  const quiet = pcm(1600, 0)
  assert.equal(watch.push(quiet), false)
  assert.equal(watch.push(speech), false)
  for (let i = 0; i < 14; i += 1) assert.equal(watch.push(quiet), false)
  assert.equal(watch.push(quiet), true)
})
