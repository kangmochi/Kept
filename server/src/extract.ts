import { dueLabel, hasDateCue, isValidISO, resolveDue, zonedISO } from './dates.js'
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

const WEEKDAY =
  "monday|tuesday|wednesday|thursday|friday|saturday|sunday|senin|selasa|rabu|kamis|jumat|jum'?at|sabtu|minggu"
const MONTH =
  'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?'

/** Drop calendar words from a title. Clock times such as "at 9" stay. */
export function stripDateWords(title: string): string {
  let text = title
  const patterns = [
    new RegExp(`\\b(?:by|on|before|due|this|next)(?:\\s+next)?\\s+(?:${WEEKDAY})\\b`, 'gi'),
    new RegExp(`\\b(?:${WEEKDAY})\\s+depan\\b`, 'gi'),
    /\b(?:end of (?:the )?month|akhir bulan|next week|minggu depan|tomorrow|besok|today|tonight|hari ini|lusa)\b/gi,
    /\bin\s+\d+\s+(?:days?|weeks?)\b/gi,
    /\b\d+\s+(?:hari|minggu)\s+lagi\b/gi,
    new RegExp(`\\b(?:on\\s+)?(?:${MONTH})\\s+\\d{1,2}\\b`, 'gi'),
    new RegExp(`\\b\\d{1,2}\\s+(?:${MONTH})\\b`, 'gi'),
    /\b20\d{2}-\d{2}-\d{2}\b/g,
  ]
  for (const pattern of patterns) text = text.replace(pattern, ' ')
  return text
    .replace(/\s+/g, ' ')
    .replace(/\s+([,])/g, '$1')
    .replace(/\b(?:by|on|before|due)\b\s*$/i, '')
    .trim()
    .replace(/^[,.\-]+|[,.\-]+$/g, '')
    .trim()
}

export function fallbackTitle(text: string): string {
  let title = normalizeUtterance(text)
  title = title.replace(
    /^(please\s+)?(remind me to|i'll|i will|i'm going to|im going to|aku akan|saya akan|tolong)\s+/i,
    '',
  )
  return sanitizeTitle(stripDateWords(title))
}

/** Prefer a title without the date. Never return an empty string. */
export function cleanTitle(candidate: string, utterance: string): string {
  const base = sanitizeTitle(candidate) || fallbackTitle(utterance) || sanitizeTitle(utterance)
  const stripped = sanitizeTitle(stripDateWords(base))
  return stripped || base || 'promise'
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
    'Do not put the due date, weekday, or relative day in the title. Drop words such as by Friday, tomorrow, besok, Jumat depan, end of month, and in 3 days.',
    'Keep a clock time in the title when the speaker says one, such as at 9 or jam 5.',
    'dueISO is a calendar date in that timezone. If the utterance has no date, dueISO must be null.',
    'Never guess or invent a date. Never return a date before today. If you are unsure, use null.',
    'Resolve by Friday, tomorrow, besok, Jumat, next week, end of month, in N days, and a clock time against today.',
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
    return { isCommitment: false, title: null, dueISO: null, dueLabel: '----', confidence: 0 }
  }

  const raw = await llm.complete(buildExtractSystem(now, timeZone), utterance)
  const model = parseModelJson(raw)
  if (!model.isCommitment) {
    return { isCommitment: false, title: null, dueISO: null, dueLabel: '----', confidence: 0 }
  }

  const title = cleanTitle(model.title, utterance)
  const today = zonedISO(now, timeZone)
  const localDue = resolveDue(utterance, now, timeZone)
  let dueISO: string | null = localDue && localDue >= today ? localDue : null
  if (!dueISO && model.dueISO && model.dueISO >= today && model.confidence >= 0.45 && hasDateCue(utterance)) {
    dueISO = model.dueISO
  }
  if (!hasDateCue(utterance)) dueISO = null
  if (model.confidence < 0.5) dueISO = null

  return {
    isCommitment: true,
    title,
    dueISO,
    dueLabel: dueLabel(dueISO, now, timeZone),
    confidence: model.confidence,
  }
}
