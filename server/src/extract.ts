import { dueLabel, hasDateCue, isValidISO, resolveDue } from './dates.js'
import type { Extraction } from './types.js'

export interface LlmClient {
  complete(system: string, user: string): Promise<string>
}

export class ExtractError extends Error {
  status: number
  constructor(message: string, status = 400) {
    super(message)
    this.name = 'ExtractError'
    this.status = status
  }
}

function isSmallTalk(text: string): boolean {
  const line = text
    .trim()
    .toLowerCase()
    .replace(/[.!]+$/g, '')
    .trim()
  if (/^(thanks|thank you)(,?\s+see you)?$/.test(line)) return true
  return /^(see you|ok sip|okay|ok|sip|baik|ya|yes|no|haha|lol)$/.test(line)
}

export function normalizeUtterance(text: string): string {
  return text.trim().replace(/\s+/g, ' ')
}

export function sanitizeTitle(raw: string): string {
  let title = raw.trim().replace(/^["']+|["']+$/g, '')
  title = title.replace(/[.!]+$/g, '').replace(/\s+/g, ' ').trim()
  if (title.length <= 40) return title
  const cut = title.slice(0, 40)
  const space = cut.lastIndexOf(' ')
  return (space > 20 ? cut.slice(0, space) : cut).trim()
}

export function fallbackTitle(text: string): string {
  let title = normalizeUtterance(text)
  title = title.replace(
    /^(please\s+)?(remind me to|i'll|i will|i'm going to|im going to|aku akan|saya akan|tolong)\s+/i,
    '',
  )
  title = title.replace(
    /\b(by|on|before|due|this|next)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday|senin|selasa|rabu|kamis|jumat|jum'at|sabtu|minggu|tomorrow|besok|today|hari ini).*/i,
    '',
  )
  return sanitizeTitle(title)
}

function clampConfidence(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return 0.5
  return Math.min(1, Math.max(0, n))
}

function parseModelJson(raw: string): {
  isCommitment: boolean
  title: string
  dueISO: string | null
  confidence: number
} {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) throw new ExtractError('The model did not return JSON', 502)
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>
  } catch {
    throw new ExtractError('The model returned malformed JSON', 502)
  }
  if (typeof parsed.isCommitment !== 'boolean') throw new ExtractError('The model omitted isCommitment', 502)
  const due = typeof parsed.dueISO === 'string' ? parsed.dueISO.trim() : null
  return {
    isCommitment: parsed.isCommitment,
    title: typeof parsed.title === 'string' ? parsed.title : '',
    dueISO: due && isValidISO(due) ? due : null,
    confidence: clampConfidence(parsed.confidence),
  }
}

export function buildExtractSystem(now: Date, timeZone: string): string {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'long',
  }).format(now)
  return [
    'You extract one spoken commitment for a glasses app.',
    'The speaker may use English or Indonesian.',
    `Today is ${today}. The timezone is ${timeZone}.`,
    'Return only a JSON object with keys isCommitment (boolean), title (string), dueISO (YYYY-MM-DD or null), confidence (number from 0 to 1).',
    'isCommitment is true only when the speaker promised to do something (send, call, review, remind me, I will, aku akan, saya akan).',
    'Small talk such as thanks, see you, or ok sip is not a commitment.',
    'title is a short display line, at most 40 characters, no trailing period.',
    'dueISO is a calendar date in that timezone. If the utterance has no date, dueISO must be null.',
    'Never guess or invent a date. If you are unsure, use null.',
    'Resolve by Friday, tomorrow, besok, Jumat, and next week against today.',
  ].join('\n')
}

export async function extractCommitment(
  text: string,
  llm: LlmClient,
  now = new Date(),
  timeZone = 'Asia/Jakarta',
): Promise<Extraction> {
  const utterance = normalizeUtterance(text)
  if (!utterance) throw new ExtractError('Say a promise first', 400)

  if (isSmallTalk(utterance)) {
    return {
      isCommitment: false,
      title: sanitizeTitle(utterance).slice(0, 40),
      dueISO: null,
      dueLabel: '----',
      confidence: 1,
    }
  }

  const raw = await llm.complete(buildExtractSystem(now, timeZone), utterance)
  const model = parseModelJson(raw)
  if (!model.isCommitment) {
    const phrase = sanitizeTitle(model.title || utterance).slice(0, 40)
    return {
      isCommitment: false,
      title: phrase || 'not a promise',
      dueISO: null,
      dueLabel: '----',
      confidence: model.confidence,
    }
  }

  const title = sanitizeTitle(model.title) || fallbackTitle(utterance) || 'promise'
  const localDue = resolveDue(utterance, now, timeZone)
  let dueISO: string | null = localDue
  if (!dueISO && model.dueISO && model.confidence >= 0.45 && hasDateCue(utterance)) {
    dueISO = model.dueISO
  }
  if (!hasDateCue(utterance)) dueISO = null

  return {
    isCommitment: true,
    title,
    dueISO,
    dueLabel: dueLabel(dueISO, now, timeZone),
    confidence: model.confidence,
  }
}
