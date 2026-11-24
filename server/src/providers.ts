import { ExtractError, type LlmClient } from './extract.js'
import { ensureWav } from './wav.js'

export function createLlmClient(baseUrl: string, apiKey: string, model: string): LlmClient {
  return {
    async complete(system: string, user: string): Promise<string> {
      if (!apiKey) throw new ExtractError('LLM_API_KEY is not set', 503)
      const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`
      let response = await postChat(url, apiKey, {
        model,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      })
      if (response.status === 400) {
        response = await postChat(url, apiKey, {
          model,
          temperature: 0,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        })
      }
      if (!response.ok) throw new ExtractError('The language model request failed', 502)
      const data = (await response.json()) as { choices?: { message?: { content?: string } }[] }
      const content = data.choices?.[0]?.message?.content
      if (!content) throw new ExtractError('The language model returned an empty message', 502)
      return content
    },
  }
}

async function postChat(url: string, apiKey: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

export function createTranscriber(baseUrl: string, apiKey: string, model: string) {
  return async function transcribe(body: Buffer): Promise<string> {
    if (!apiKey) throw new Error('STT_API_KEY is not set')
    const wav = ensureWav(body)
    const file = new Blob([wav], { type: 'audio/wav' })
    const form = new FormData()
    form.set('model', model)
    form.set('file', file, 'audio.wav')
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    })
    if (!response.ok) throw new Error('Transcription failed')
    const data = (await response.json()) as { text?: string }
    return (data.text ?? '').trim()
  }
}
