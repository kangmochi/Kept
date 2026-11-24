import { existsSync, readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export type Env = {
  allowDevPair: boolean
  pairingTtlSeconds: number
  sessionSecret: string
  ephemeralSecret: boolean
  notionToken: string
  notionDatabaseId: string
  notionDataSourceId: string
  llmBaseUrl: string
  llmApiKey: string
  llmModel: string
  sttBaseUrl: string
  sttApiKey: string
  sttModel: string
  port: number
  host: string
  tz: string
}

function loadDotEnv(path: string) {
  if (!existsSync(path)) return
  const text = readFileSync(path, 'utf8')
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 1) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = value
  }
}

export function loadEnvFiles() {
  const here = dirname(fileURLToPath(import.meta.url))
  loadDotEnv(resolve(here, '../../.env'))
  loadDotEnv(resolve(here, '../.env'))
}

function flag(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback
  return value === '1' || value.toLowerCase() === 'true'
}

export function readEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const sessionSecret = source.SESSION_SECRET?.trim() || ''
  return {
    allowDevPair: flag(source.ALLOW_DEV_PAIR, false),
    pairingTtlSeconds: Number(source.PAIRING_TTL_SECONDS || 300) || 300,
    sessionSecret: sessionSecret || randomBytes(32).toString('hex'),
    ephemeralSecret: !sessionSecret,
    notionToken: source.NOTION_TOKEN?.trim() || '',
    notionDatabaseId: source.NOTION_DATABASE_ID?.trim() || '',
    notionDataSourceId: source.NOTION_DATA_SOURCE_ID?.trim() || '',
    llmBaseUrl: source.LLM_BASE_URL?.trim() || 'https://api.mistral.ai/v1',
    llmApiKey: source.LLM_API_KEY?.trim() || '',
    llmModel: source.LLM_MODEL?.trim() || 'ministral-8b-2512',
    sttBaseUrl: source.STT_BASE_URL?.trim() || 'https://api.mistral.ai/v1',
    sttApiKey: source.STT_API_KEY?.trim() || '',
    sttModel: source.STT_MODEL?.trim() || 'voxtral-mini-transcribe-3-0',
    port: Number(source.PORT || 8787) || 8787,
    host: source.HOST?.trim() || '127.0.0.1',
    tz: source.TZ?.trim() || 'Asia/Jakarta',
  }
}
