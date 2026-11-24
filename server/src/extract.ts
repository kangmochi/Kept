import { dueLabel, hasDateCue, isValidISO, resolveDue, zonedISO } from './dates.js'
import { cleanDirection, cleanPerson, forcesCommitment, inferParty, listenerAsk, speakerPromises } from './party.js'
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

/** Uppercase the first letter. Leading quotes and punctuation stay put. */
export function capitalizeTitle(title: string): string {
  const chars = [...title]
  for (let i = 0; i < chars.length; i += 1) {
    if (!/\p{L}/u.test(chars[i])) continue
    chars[i] = chars[i].toUpperCase()
    return chars.join('')
  }
  return title
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

const INDONESIAN_UTTERANCE =
  /\b(?:aku|saya|kamu|besok|kirim|bayar|kembalikan|mengembalikan|inget|ingetin|tolong|nanti|boleh|bisa)\b/i
const ENGLISH_SPEAKER = /\b(?:i'll|i will|i'm going to|im going to|i promised)\b/i
const INDONESIAN_TITLE =
  /\b(?:jam|kembalikan|mengembalikan|kembali|bayar|inget|ingetin|besok|kirim|kirimkan|ingatkan|telepon|telpon|hubungi|mengirim|membayar|pengembalian|selesaikan|perbaiki|siapkan|buatkan|ambil|cek|tanyakan|jemput|antar|lunasi|balas)\b/i

/** English promises stay English. An Indonesian utterance is left alone. */
export function looksEnglish(text: string): boolean {
  if (/[\u3040-\u30ff\u4e00-\u9fff]/.test(text)) return false
  if (INDONESIAN_UTTERANCE.test(text)) return false
  if (ENGLISH_SPEAKER.test(text)) return true
  if (/\b(?:promised to|is going to)\b/i.test(text) && /\b(?:the|a|an|me|by|to)\b/i.test(text)) return true
  return (
    /\bwill\b/i.test(text) &&
    /\b(?:the|a|an|by|tomorrow|today|me|it|him|her|us|them|to|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(text)
  )
}

/** A title word counts only when the utterance itself did not already say it. */
export function indonesianLeak(title: string, utterance = ''): boolean {
  const spoken = new Set(utterance.toLowerCase().match(/\p{L}+/gu) ?? [])
  for (const word of title.match(/\p{L}+/gu) ?? []) {
    if (!INDONESIAN_TITLE.test(word) || spoken.has(word.toLowerCase())) continue
    return true
  }
  return false
}

const SUBJECT_LEAD = /^(?:i'll|i will|i'm going to|im going to|i promised(?:\s+to)?)(?:\s+|$)/i
const NAME_LEAD =
  /^(?:\p{Lu}[\p{L}'’-]{0,40}\s+)(?:and\s+\p{Lu}[\p{L}'’-]{0,40}\s+)?(?:promised\s+to|is\s+going\s+to|will)(?:\s+|$)/u

function bareLead(raw: string): string {
  return stripDateWords(raw)
    .replace(/[.!?]+$/g, '')
    .trim()
}

function stripSubjectLead(raw: string): string {
  let line = bareLead(raw)
  for (let i = 0; i < 4; i += 1) {
    const next = bareLead(line.replace(SUBJECT_LEAD, '').replace(NAME_LEAD, ''))
    if (next === line) break
    line = next
  }
  return line.trim()
}

function hadSubjectLead(raw: string): boolean {
  const line = bareLead(raw)
  return SUBJECT_LEAD.test(line) || NAME_LEAD.test(line)
}

/** A stable English title from the utterance, used when the model translates it. */
export function englishPromiseTitle(text: string): string {
  const line = stripSubjectLead(normalizeUtterance(text))
  const title = sanitizeTitle(line)
  if (!title) return ''
  return title.charAt(0).toUpperCase() + title.slice(1)
}

/** Drop a leading "Alex will" or "I'll" from an English model title. */
export function presentEnglishTitle(raw: string, utterance: string): string {
  if (!hadSubjectLead(raw)) return cleanTitle(raw, utterance)
  const title = sanitizeTitle(stripSubjectLead(raw))
  if (!title) return ''
  return title.charAt(0).toUpperCase() + title.slice(1)
}

function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const CONTENT_STOP = new Set([
  'the', 'a', 'an', 'to', 'for', 'of', 'and', 'or', 'you', 'your', 'me', 'my', 'i', 'we', 'they', 'them', 'it',
  'that', 'this', 'those', 'these', 'if', 'still', 'have', 'has', 'had', 'maybe', 'could', 'would', 'can',
  'please', 'sometime', 'some', 'them', 'du', 'die', 'der', 'das', 'und', 'mir', 'sie', 'noch', 'hast', 'wenn',
  'dir', 'den', 'dem', 'ein', 'eine', 'ich', 'si', 'las', 'los', 'el', 'la', 'de', 'del', 'que', 'un', 'una',
  'tu', 'les', 'des', 'en', 'au', 'aux', 'encore', 'as', 'moi', 'lui', 'kamu', 'kalau', 'masih', 'yang', 'dan',
  'di', 'ke', 'ini', 'itu', 'ada', 'bisa', 'tolong', 'boleh', 'will', 'aku', 'saya', 'je', 'con', 'por', 'para',
  'tienes', 'konntest', 'sometime',
])

const VERB_PREFIXES = [
  'send', 'schick', 'envoy', 'envi', 'mand', 'kirim', 'bayar', 'pagar', 'llam', 'call', 'deliver', 'entreg',
  'review', 'revis', 'ruf', 'bezahl', 'mach', 'pay', 'appel', 'livr', 'remind',
]

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?。？])\s*/u)
    .map((part) => part.trim())
    .filter(Boolean)
}

function isConditionalClause(sentence: string): boolean {
  const line = fold(sentence)
  return /^(if you|si tienes|si tu as|wenn du|kalau kamu)\b/.test(line) || sentence.includes('たら')
}

/** Speaker-promise sentence, skipping the ask and a conditional clause that only introduces it. */
export function promiseSentence(text: string): string | null {
  const parts = splitSentences(text)
  const request = new Set<number>()
  parts.forEach((part, index) => {
    if (listenerAsk(part) === 'none') return
    request.add(index)
    if (index > 0 && isConditionalClause(parts[index - 1])) request.add(index - 1)
  })
  return parts.find((part, index) => !request.has(index) && speakerPromises(part)) ?? null
}

function requestText(text: string): string {
  const parts = splitSentences(text)
  const chunks: string[] = []
  parts.forEach((part, index) => {
    if (listenerAsk(part) === 'none') return
    if (index > 0 && isConditionalClause(parts[index - 1])) chunks.push(parts[index - 1])
    chunks.push(part)
  })
  return chunks.join(' ')
}

function latinTokens(text: string): string[] {
  return fold(stripDateWords(text))
    .split(' ')
    .filter((word) => word.length > 2 && !CONTENT_STOP.has(word) && !VERB_PREFIXES.some((prefix) => word.startsWith(prefix)))
}

function jaGrams(text: string): string[] {
  const core = text.replace(/[\s、。！？をはがにのへともでや]/g, '')
  const grams: string[] = []
  for (let i = 0; i < core.length - 1; i += 1) grams.push(core.slice(i, i + 2))
  return grams
}

function overlapScore(title: string, sentence: string): number {
  if (/[\u3040-\u30ff\u4e00-\u9fff]/.test(title)) {
    const hay = sentence.replace(/[\s、。！？をはがにのへともでや]/g, '')
    return jaGrams(title).filter((gram) => hay.includes(gram)).length
  }
  const words = new Set(latinTokens(sentence))
  const hay = fold(sentence)
  return latinTokens(title).filter((token) => words.has(token) || hay.includes(token)).length
}

/**
 * True when the title is about the listener's request more than the speaker's promise.
 * Content words are folded and stripped of stopwords and verb stems. Japanese uses character bigrams.
 */
export function titleMatchesRequest(title: string, utterance: string): boolean {
  if (!title.trim() || listenerAsk(utterance) === 'none') return false
  if (listenerAsk(title) === 'ask') return true
  const request = requestText(utterance)
  if (!request) return false
  const requestScore = overlapScore(title, request)
  if (requestScore === 0) return false
  const promise = promiseSentence(utterance)
  const promiseScore = promise ? overlapScore(title, promise) : 0
  return requestScore > promiseScore
}

/** Prefer a title without the date. Strip the date before the 40-character cut. Never return an empty string. */
export function cleanTitle(candidate: string, utterance: string): string {
  const stripped = sanitizeTitle(stripDateWords(withoutLead(candidate)))
  return stripped || fallbackTitle(utterance) || sanitizeTitle(utterance) || 'promise'
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
    'direction is "I owe" when the speaker promises to send, pay, review, call, deliver, or remind someone, even if that person is unnamed. "I\'ll", "I will", and "I promised" are "I owe".',
    'direction is "Owed to me" when someone else promised the speaker. When a named person promised to, will, or is going to do something, including "pay me back", person is that name and direction is "Owed to me".',
    'direction is null for a personal task with no counterparty, such as booking your own flight or reviewing your own deck.',
    'Write the title in the same language as the utterance, even when it mixes languages. Never translate English into Indonesian or the reverse.',
    'Keep a person name in the title when the speaker said it.',
    'isCommitment is true when the speaker promised to do something (send, call, review, remind me, I will, I\'ll, aku akan, saya akan). It is also true when a named person promised to, will, or is going to do something: that commitment is owed to the speaker.',
    'A request aimed at the listener is not the speaker\'s promise. could you, can you, maybe you could, would you, bisa tolong, kamu bisa, boleh kirim, ¿puedes, puedes enviarme, podrías, quizá puedas, könntest du, tu pourrais, tu pourras, もらえますか, and 送ってもらえる are asks.',
    'Bare "puedes" or "puedas" (si no puedes, cuando puedas) is not a request. can you remind me, bisa ingetin aku, me recuerdas, erinnerst du mich, tu peux me rappeler, and 思い出させて are the speaker\'s own reminder.',
    'If the speaker also promises something in the same utterance, title is that promise, not the request. Do not drop the promise because a request is also present.',
    'If the other person agrees in the same utterance, isCommitment is true and direction is "Owed to me".',
    'Small talk such as thanks, see you, or ok sip is not a commitment.',
    'person is the named counterparty of the promise. Ignore "thanks for" and words ending in -ing, such as hopping.',
    'title is a short display line, at most 40 characters, no trailing period.',
    'Do not put the due date, weekday, or relative day in the title. Drop words such as by Friday, tomorrow, besok, Jumat depan, end of month, and in 3 days.',
    'Keep a clock time in the title when the speaker says one, such as at 9 or 5pm.',
    'dueISO is a calendar date in that timezone. If the utterance has no date, dueISO must be null.',
    'Never guess or invent a date. Never return a date before today. If you are unsure, use null.',
    'Resolve by Friday, tomorrow, besok, Jumat, next week, end of month, in N days, and a clock time against today.',
  ].join('\n')
}

function strictEnglishSystem(now: Date, timeZone: string): string {
  return [
    buildExtractSystem(now, timeZone),
    'The utterance is English. Write the title in English only.',
    'Never translate English into Indonesian. Do not use jam, kembalikan, bayar, inget, besok, or kirim in the title.',
  ].join('\n')
}

async function recoverEnglishTitle(
  utterance: string,
  llm: LlmClient,
  now: Date,
  timeZone: string,
): Promise<string> {
  try {
    const raw = await llm.complete(strictEnglishSystem(now, timeZone), utterance)
    const again = parseModelJson(raw)
    const cleaned = cleanTitle(again.title, utterance)
    if (again.isCommitment && cleaned && !indonesianLeak(cleaned, utterance)) return cleaned
  } catch {
    // The retry did not return an English title.
  }
  return englishPromiseTitle(utterance)
}

function mentionedPerson(person: string | null, text: string): string | null {
  if (!person || !/^\p{Lu}/u.test(person)) return null
  const escaped = person.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`${EDGE}${escaped}${END}`, 'u').test(text) ? person : null
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
  const promised = speakerPromises(utterance)
  if (ask === 'ask' && !promised) {
    return { isCommitment: false, title: null, dueISO: null, dueLabel: '----', confidence: 0, ...blank }
  }
  let sourceTitle = model.title
  let sourceUtterance = utterance
  if (ask === 'ask' && titleMatchesRequest(model.title, utterance)) {
    const sentence = promiseSentence(utterance)
    if (!sentence) {
      return { isCommitment: false, title: null, dueISO: null, dueLabel: '----', confidence: 0, ...blank }
    }
    sourceTitle = sentence
    sourceUtterance = sentence
  }
  const owed = ask === 'owed' && !speakerPromises(utterance)
  const party = inferParty(utterance)
  const forced = forcesCommitment(utterance)
  if (!model.isCommitment && !owed && !forced) {
    return { isCommitment: false, title: null, dueISO: null, dueLabel: '----', confidence: 0, ...blank }
  }

  let title = cleanTitle(sourceTitle, sourceUtterance)
  const usedPromiseSentence = sourceUtterance !== utterance
  if (looksEnglish(utterance) && indonesianLeak(title, utterance)) {
    title = await recoverEnglishTitle(sourceUtterance, llm, now, timeZone)
  } else if (!usedPromiseSentence && (looksEnglish(utterance) || hadSubjectLead(sourceTitle))) {
    title = presentEnglishTitle(sourceTitle, sourceUtterance)
  }
  if (!title || (hadSubjectLead(sourceTitle) && !sanitizeTitle(stripSubjectLead(sourceTitle)))) {
    return { isCommitment: false, title: null, dueISO: null, dueLabel: '----', confidence: 0, ...blank }
  }
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
    title: capitalizeTitle(title),
    dueISO,
    dueLabel: dueLabel(dueISO, now, timeZone),
    confidence: model.confidence,
    person: party.locked ? party.person : mentionedPerson(model.person, utterance),
    direction: owed ? 'Owed to me' : party.locked ? party.direction : model.direction,
  }
}
