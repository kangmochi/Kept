import { dueLabel, hasDateCue, isValidISO, resolveDue, zonedISO } from './dates.js'
import { cleanDirection, cleanPerson, inferParty, listenerAsk, speakerPromises } from './party.js'
import type { Direction, Extraction } from './types.js'

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

const EDGE = String.raw`(?<![\p{L}\p{N}_])`
const END = String.raw`(?![\p{L}\p{N}_])`
const FOREIGN_DAY =
  'domingo|lunes|martes|miércoles|miercoles|jueves|viernes|sábado|sabado|sonntag|montag|dienstag|mittwoch|donnerstag|freitag|samstag|dimanche|lundi|mardi|mercredi|jeudi|vendredi|samedi'
const JA_WEEKDAY = '日曜日|月曜日|火曜日|水曜日|木曜日|金曜日|土曜日'

/** Drop calendar words from a title. Clock times such as "at 9" stay. */
export function stripDateWords(title: string): string {
  let text = title
    .replace(/今月末までに|今月末|月末までに/g, ' ')
    .replace(new RegExp(`来週の(?:${JA_WEEKDAY})`, 'g'), ' ')
    .replace(new RegExp(JA_WEEKDAY, 'g'), ' ')
    .replace(/明日|来週|月末/g, ' ')
    .replace(/までに/g, ' ')
    .replace(/\d+週間後|\d+日後/g, ' ')
    .replace(/^今\s+/g, ' ')
  const patterns = [
    new RegExp(`${EDGE}bis\\s+(?:zum\\s+)?(?:ende(?:\\s+des)?\\s+monats?|monatsende)${END}`, 'giu'),
    new RegExp(`${EDGE}(?:el|la|le|am|der)\\s+(?:${WEEKDAY}|${FOREIGN_DAY})${END}`, 'giu'),
    new RegExp(`${EDGE}(?:el\\s+)?pr[oó]xim[oa]\\s+(?:${FOREIGN_DAY})${END}`, 'giu'),
    new RegExp(`${EDGE}(?:${FOREIGN_DAY})\\s+que\\s+viene${END}`, 'giu'),
    new RegExp(
      `${EDGE}(?:nächsten|nächste|nächster|naechsten|naechste|naechster)\\s+(?:${FOREIGN_DAY})${END}`,
      'giu',
    ),
    new RegExp(`${EDGE}(?:${FOREIGN_DAY})\\s+prochain${END}`, 'giu'),
    new RegExp(
      `${EDGE}(?:la\\s+pr[oó]xima\\s+semana|la\\s+semana\\s+que\\s+viene|nächste\\s+woche|naechste\\s+woche|la\\s+semaine\\s+prochaine|fin\\s+de\\s+mes|a\\s+finales\\s+de\\s+mes|ende\\s+des\\s+monats|monatsende|fin\\s+du\\s+mois|mañana|manana|morgen|demain)${END}`,
      'giu',
    ),
    new RegExp(`${EDGE}en\\s+\\d+\\s+(?:d[ií]as|semanas)${END}`, 'giu'),
    new RegExp(`${EDGE}in\\s+\\d+\\s+(?:tagen|wochen)${END}`, 'giu'),
    new RegExp(`${EDGE}dans\\s+\\d+\\s+(?:jours|semaines)${END}`, 'giu'),
    new RegExp(`${EDGE}(?:by|on|before|due|this|next)(?:\\s+next)?\\s+(?:${WEEKDAY})${END}`, 'giu'),
    new RegExp(`${EDGE}(?:${WEEKDAY})\\s+depan${END}`, 'giu'),
    new RegExp(
      `${EDGE}(?:end of (?:the )?month|akhir bulan|next week|minggu depan|tomorrow|besok|today|tonight|hari ini|lusa)${END}`,
      'giu',
    ),
    new RegExp(`${EDGE}in\\s+\\d+\\s+(?:days?|weeks?)${END}`, 'giu'),
    new RegExp(`${EDGE}\\d+\\s+(?:hari|minggu)\\s+lagi${END}`, 'giu'),
    new RegExp(`${EDGE}(?:on\\s+)?(?:${MONTH})\\s+\\d{1,2}${END}`, 'giu'),
    new RegExp(`${EDGE}\\d{1,2}\\s+(?:${MONTH})${END}`, 'giu'),
    new RegExp(`${EDGE}(?:${WEEKDAY}|${FOREIGN_DAY})${END}`, 'giu'),
    /\b20\d{2}-\d{2}-\d{2}\b/g,
  ]
  for (const pattern of patterns) text = text.replace(pattern, ' ')
  text = text
    .replace(/\s+/g, ' ')
    .replace(/\s+([,])/g, '$1')
    .replace(/、/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const dangling = new RegExp(`${EDGE}(?:el|la|le|der|de|zum|des|bis|à|a|ke|by|on|before|due)${END}$`, 'iu')
  for (let i = 0; i < 4 && dangling.test(text); i += 1) text = text.replace(dangling, '').trim()
  return text.replace(/^[,.\-、\s]+|[,.\-、\s]+$/g, '').trim()
}

const LEAD_IN =
  /^(?:please\s+)?(?:remind me to|i'll|i will|i'm going to|im going to|aku akan|saya akan|tolong)\s+/i

function withoutLead(title: string): string {
  return title.replace(LEAD_IN, '')
}

export function fallbackTitle(text: string): string {
  return sanitizeTitle(stripDateWords(withoutLead(normalizeUtterance(text))))
}

/** Prefer a title without the date. Never return an empty string. */
export function cleanTitle(candidate: string, utterance: string): string {
  const base = sanitizeTitle(withoutLead(candidate)) || fallbackTitle(utterance) || sanitizeTitle(utterance)
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
  person: string | null
  direction: Direction | null
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
    person: cleanPerson(typeof parsed.person === 'string' ? parsed.person : null),
    direction: cleanDirection(parsed.direction),
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
    'The speaker may use English, Indonesian, Spanish, German, French, or Japanese.',
    `Today is ${today}. The timezone is ${timeZone}.`,
    'Return only a JSON object with keys isCommitment (boolean), title (string), dueISO (YYYY-MM-DD or null), confidence (number from 0 to 1), person (string or null), direction ("I owe", "Owed to me", or null).',
    'person is the other named person, never I, me, aku, or saya. Use null when nobody else is named.',
    'direction is "I owe" when the speaker promises to send, pay, review, call, or deliver for someone else, even if that person is unnamed.',
    'direction is "Owed to me" when someone else promised the speaker.',
    'direction is null for a personal task with no counterparty, such as booking your own flight or reviewing your own deck.',
    'Keep the title in the utterance language. Do not translate it. Keep a person name in the title when the speaker said it.',
    'isCommitment is true only when the speaker promised to do something (send, call, review, remind me, I will, aku akan, saya akan).',
    'A request aimed at the listener is not the speaker\'s promise. could you, can you, maybe you could, would you, bisa tolong, kamu bisa, puedes, könntest du, tu pourrais, and もらえますか are asks. Do not file those as I owe.',
    'If the other person agrees in the same utterance, isCommitment is true and direction is "Owed to me".',
    'Small talk such as thanks, see you, or ok sip is not a commitment.',
    'person is the named counterparty of the promise. Ignore "thanks for" and words ending in -ing, such as hopping.',
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

  const blank = { person: null, direction: null } as const
  if (isSmallTalk(utterance)) {
    return { isCommitment: false, title: null, dueISO: null, dueLabel: '----', confidence: 0, ...blank }
  }

  const ask = listenerAsk(utterance)
  const raw = await llm.complete(buildExtractSystem(now, timeZone), utterance)
  const model = parseModelJson(raw)
  if (ask === 'ask' && !speakerPromises(utterance)) {
    return { isCommitment: false, title: null, dueISO: null, dueLabel: '----', confidence: 0, ...blank }
  }
  const owed = ask === 'owed' && !speakerPromises(utterance)
  if (!model.isCommitment && !owed) {
    return { isCommitment: false, title: null, dueISO: null, dueLabel: '----', confidence: 0, ...blank }
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
  const party = inferParty(utterance)

  return {
    isCommitment: true,
    title,
    dueISO,
    dueLabel: dueLabel(dueISO, now, timeZone),
    confidence: model.confidence,
    person: party.locked ? party.person : model.person,
    direction: owed ? 'Owed to me' : party.locked ? party.direction : model.direction,
  }
}
