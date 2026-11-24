import { API_BASE, ApiError, sessionHeader } from '../api'

/** 20 seconds of 16 kHz mono s16le. The glasses send ~3200 bytes every 100 ms. */
const MAX_PCM_BYTES = 16000 * 2 * 20

/**
 * Buffers glasses PCM and posts it to our backend. The WebView never calls
 * a speech vendor and never holds an API key.
 */
export function createListenBuffer() {
  const chunks: Uint8Array[] = []
  let bytes = 0

  return {
    push(chunk: Uint8Array) {
      if (bytes >= MAX_PCM_BYTES || chunk.byteLength === 0) return
      const room = MAX_PCM_BYTES - bytes
      const slice = chunk.byteLength > room ? chunk.slice(0, room) : chunk
      chunks.push(slice)
      bytes += slice.byteLength
    },
    reset() {
      chunks.length = 0
      bytes = 0
    },
    get empty() {
      return bytes === 0
    },
    full() {
      return bytes >= MAX_PCM_BYTES
    },
    snapshot(): Uint8Array {
      const out = new Uint8Array(bytes)
      let offset = 0
      for (const chunk of chunks) {
        out.set(chunk, offset)
        offset += chunk.byteLength
      }
      return out
    },
  }
}

function pcmBytes(pcm: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(pcm.byteLength)
  new Uint8Array(copy).set(pcm)
  return copy
}

export async function postListen(pcm: Uint8Array, token: string): Promise<string> {
  let response: Response
  try {
    response = await fetch(`${API_BASE}/listen`, {
      method: 'POST',
      headers: {
        Authorization: sessionHeader(token),
        'Content-Type': 'application/octet-stream',
      },
      body: new Blob([pcmBytes(pcm)], { type: 'application/octet-stream' }),
    })
  } catch {
    throw new ApiError(0, 'Server unreachable')
  }
  const data = (await response.json().catch(() => ({}))) as { text?: string; error?: string }
  if (!response.ok) throw new ApiError(response.status, data.error || 'Transcription failed')
  return (data.text ?? '').trim()
}
