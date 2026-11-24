/** Speech above this RMS counts as sound. Silence after speech ends the listen. */
export const SPEECH_RMS = 0.02
export const SILENCE_AFTER_SPEECH_MS = 1500

export function pcmRms(chunk: Uint8Array): number {
  const samples = Math.floor(chunk.byteLength / 2)
  if (samples === 0) return 0
  const view = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength)
  let sum = 0
  for (let i = 0; i < samples; i += 1) {
    const sample = view.getInt16(i * 2, true) / 32768
    sum += sample * sample
  }
  return Math.sqrt(sum / samples)
}

export function createSilenceWatch(threshold = SPEECH_RMS, limitMs = SILENCE_AFTER_SPEECH_MS) {
  let heard = false
  let silenceMs = 0
  return {
    reset() {
      heard = false
      silenceMs = 0
    },
    /** True once about 1.5 s of silence has followed speech. */
    push(chunk: Uint8Array, sampleRate = 16000): boolean {
      const samples = Math.floor(chunk.byteLength / 2)
      const ms = sampleRate > 0 ? (samples / sampleRate) * 1000 : 0
      if (pcmRms(chunk) >= threshold) {
        heard = true
        silenceMs = 0
        return false
      }
      if (!heard) return false
      silenceMs += ms
      return silenceMs >= limitMs
    },
  }
}
