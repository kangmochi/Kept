/** 30 seconds of 16 kHz mono s16le PCM. */
export const MAX_PCM_BYTES = 16000 * 2 * 30

export function pcmToWav(pcm: Buffer, sampleRate = 16000): Buffer {
  const data = pcm.subarray(0, MAX_PCM_BYTES)
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}

export function isWav(body: Buffer): boolean {
  return body.length >= 12 && body.subarray(0, 4).toString('ascii') === 'RIFF' && body.subarray(8, 12).toString('ascii') === 'WAVE'
}

/** Wrap raw PCM. Truncate a WAV's data chunk to the 30 second cap. */
export function ensureWav(body: Buffer): Buffer {
  if (!isWav(body)) return pcmToWav(body)
  if (body.length < 44) return pcmToWav(Buffer.alloc(0))
  const dataSize = body.readUInt32LE(40)
  const data = body.subarray(44, 44 + dataSize)
  return pcmToWav(data.subarray(0, MAX_PCM_BYTES))
}
