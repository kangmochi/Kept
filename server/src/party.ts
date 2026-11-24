import type { Direction } from './types.js'

const NOT_PERSON = new Set([
  'i',
  'me',
  'my',
  'aku',
  'saya',
  'yo',
  'ich',
  'je',
  'moi',
  'the',
  'a',
  'an',
  'to',
  'for',
  'ke',
  'untuk',
  'he',
  'she',
  'they',
  'it',
  'this',
  'that',
  'there',
  'we',
  'you',
  'kamu',
  'dia',
  'send',
  'pay',
  'call',
  'review',
  'deliver',
  'kirim',
  'bayar',
  'friday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'saturday',
  'sunday',
  'tomorrow',
  'besok',
  'today',
  'hari',
  'ini',
])

const NAME = String.raw`[\p{L}][\p{L}'’-]{0,40}`
const EDGE = String.raw`(?<![\p{L}\p{N}_])`
const END = String.raw`(?![\p{L}\p{N}_])`

const PROPER = String.raw`\p{Lu}[\p{L}'’-]{0,40}`
const PROMISE_VERBS =
  'pay\\s+back|settle|refund|cover|bring|fix|sign|share|finish|submit|email|text|message|prepare|write|check|book|buy|send|pay|call|review|deliver|return|remind|kirim|bayar'
const OWED = [
  new RegExp(`${EDGE}(${PROPER})\\s+said\\s+(?:he|she|they)'?ll\\b`, 'giu'),
  new RegExp(`${EDGE}(${PROPER})\\s+will\\s+(?:${PROMISE_VERBS})${END}`, 'giu'),
  // No i flag: the name has to be capitalised, so "the meeting is going to" is not a person.
  new RegExp(`${EDGE}(${PROPER})\\s+(?:promised\\s+to|is\\s+going\\s+to)\\s+`, 'gu'),
  new RegExp(`${EDGE}(${PROPER})\\s+(?:bilang|berkata)${END}`, 'giu'),
]

const SPEAKER_OWES = new RegExp(
  `${EDGE}(?:i'll|i will|i'm going to|im going to|i promised(?:\\s+to)?|aku akan|saya akan|aku|saya)\\s+(?:send|pay|call|review|deliver|return|remind|kirim|bayar|telepon|menelpon)${END}`,
  'iu',
)
const PERSONAL = new RegExp(`${EDGE}(?:i need to|i have to|remind me to|jangan lupa|don't forget to)${END}`, 'iu')
const VERB = new RegExp(
  `${EDGE}(?:send|pay|call|review|deliver|kirim|bayar|telepon|menelpon)${END}`,
  'giu',
)
const ASK_SRC = [
  `${EDGE}(?:maybe\\s+you\\s+could|could\\s+you|can\\s+you|would\\s+you|you\\s+could)${END}`,
  `${EDGE}(?:if\\s+)?i\\s+ask\\s+you${END}`,
  `${EDGE}(?:bisa\\s+tolong|kamu\\s+bisa|boleh\\s+kirim)${END}`,
  `${EDGE}k[oö]nntest\\s+du${END}`,
  `${EDGE}tu\\s+pourra(?:is|s)${END}`,
  `${EDGE}¿\\s*puedes${END}`,
  `${EDGE}puedes\\s+enviar\\p{L}*${END}`,
  `${EDGE}podr[ií]as${END}`,
  `${EDGE}quiz[aá]s?\\s+puedas${END}`,
].join('|')
const JA_ASKS = ['送ってもらえる', 'もらえますか']
const EXTRA_SPEAKER = new RegExp(
  [
    `${EDGE}(?:enviar[eé]|mandar[eé])${END}`,
    `${EDGE}voy\\s+a\\s+(?:enviar|mandar|pagar|llamar|entregar|revisar)\\p{L}*`,
    `${EDGE}ich\\s+(?:schicke|sende|mache|bezahle)${END}`,
    `${EDGE}(?:schicke|sende|mache|bezahle)\\s+ich${END}`,
    `${EDGE}rufe\\s+ich\\b[^.?!。？]{0,80}\\ban${END}`,
    `${EDGE}(?:ich\\s+werde|werde\\s+ich)\\b[^.?!。？]{0,80}\\b(?:schicken|senden|machen|bezahlen|anrufen|rufen|schicke|sende)`,
    `${EDGE}j['’]enverrai${END}`,
    `${EDGE}je\\s+vous\\s+enverrai${END}`,
    `${EDGE}je\\s+vais\\s+(?:envoyer|payer|appeler|livrer|revoir|finir)\\p{L}*`,
    '送ります',
    'やります',
  ].join('|'),
  'iu',
)
const AGREES = new RegExp(
  `${EDGE}(?:(?:he|she|they|dia)\\s+(?:will|agreed|said|mau|akan|setuju)|said\\s+(?:he|she|they)'?ll|bilang\\s+(?:iya|ya))${END}`,
  'iu',
)

export function cleanPerson(raw: string | null | undefined): string | null {
  if (!raw) return null
  const name = raw.trim().replace(/^[^\p{L}]+|[^\p{L}'’-]+$/gu, '')
  if (!name || NOT_PERSON.has(name.toLowerCase())) return null
  if (!new RegExp(`^${NAME}$`, 'u').test(name)) return null
  return name
}

export function cleanDirection(raw: unknown): Direction | null {
  if (raw === 'I owe' || raw === 'Owed to me') return raw
  return null
}

function endsWithIng(name: string): boolean {
  return /[\p{L}]ing$/iu.test(name)
}

function thanksFor(text: string, index: number): boolean {
  return /thank(?:s|\s+you)\s+$/i.test(text.slice(Math.max(0, index - 16), index))
}

/**
 * The other person next to the promise. English "for" and "to" need a
 * capitalised name. "thanks for hopping" and a gerund are not names.
 * Several names and no commitment verb means we are not sure, so return null.
 */
function namedCounterparty(text: string): string | null {
  const found: { name: string; index: number }[] = []
  const english = new RegExp(`${EDGE}(?:[Ff]or|[Tt]o)\\s+(\\p{Lu}[\\p{L}'’-]{0,40})${END}`, 'gu')
  for (const match of text.matchAll(english)) {
    const raw = match[1]
    const index = match.index ?? 0
    if (!raw || endsWithIng(raw) || thanksFor(text, index)) continue
    const name = cleanPerson(raw)
    if (name) found.push({ name, index })
  }
  const indo = new RegExp(`${EDGE}(?:ke|untuk)\\s+(${NAME})${END}`, 'giu')
  for (const match of text.matchAll(indo)) {
    const name = cleanPerson(match[1])
    if (name) found.push({ name, index: match.index ?? 0 })
  }
  if (found.length === 0) return null
  if (found.length === 1) return found[0].name
  VERB.lastIndex = 0
  const verbs = [...text.matchAll(VERB)].map((match) => match.index ?? 0)
  if (verbs.length === 0) return null
  let best = found[0]
  let bestScore = Number.POSITIVE_INFINITY
  for (const candidate of found) {
    let score = Number.POSITIVE_INFINITY
    for (const verb of verbs) {
      const distance = candidate.index - verb
      const weighted = distance >= 0 ? distance : Math.abs(distance) + 1000
      if (weighted < score) score = weighted
    }
    if (score < bestScore) {
      best = candidate
      bestScore = score
    }
  }
  return best.name
}

const PRODUCTS = new Set(['notion', 'slack', 'zoom', 'google', 'pdf'])

/** A capitalised person, not a product, an acronym, or a single letter. */
function objectName(token: string | undefined): string | null {
  if (!token || token.length < 2) return null
  if (/^\p{Lu}+$/u.test(token)) return null
  if (PRODUCTS.has(token.toLowerCase())) return null
  if (!/^\p{Lu}/u.test(token)) return null
  return cleanPerson(token)
}

/**
 * The other person the speaker names. "for/to Nadia" still counts. Otherwise
 * only the word directly after call, pay, remind, send, and the other person verbs.
 */
function speakerPerson(text: string): string | null {
  const named = namedCounterparty(text)
  if (named && !PRODUCTS.has(named.toLowerCase())) return named
  const promised = text.match(new RegExp(`${EDGE}i\\s+promised\\s+(\\p{L}[\\p{L}'’-]*)`, 'iu'))
  const fromPromise = objectName(promised?.[1])
  if (fromPromise) return fromPromise
  const match = text.match(
    new RegExp(
      `${EDGE}(?:i'll|i will|i'm going to|im going to|i promised(?:\\s+to)?)\\s+(?:pay\\s+back|call|pay|remind|send|tell|email|text|message|ping|meet)\\s+(\\p{L}[\\p{L}'’-]*)`,
      'iu',
    ),
  )
  return objectName(match?.[1])
}

function speakerLeadIndex(text: string): number {
  const match = new RegExp(`${EDGE}(?:i'll|i will|i'm going to|im going to|i promised(?:\\s+to)?)`, 'iu').exec(text)
  return match?.index ?? -1
}

function firstOwed(text: string): { person: string; index: number } | null {
  let best: { person: string; index: number } | null = null
  for (const pattern of OWED) {
    pattern.lastIndex = 0
    for (const match of text.matchAll(pattern)) {
      const raw = match[1]
      if (!raw || !/^\p{Lu}/u.test(raw)) continue
      const person = cleanPerson(raw)
      if (!person) continue
      const index = match.index ?? 0
      if (!best || index < best.index) best = { person, index }
    }
  }
  return best
}

const REMIND = [
  `${EDGE}(?:can|could|would)\\s+you\\s+remind\\s+me${END}`,
  `${EDGE}bisa\\s+ingetin\\s+aku${END}`,
  `${EDGE}me\\s+recuerdas${END}`,
  `${EDGE}erinnerst\\s+du\\s+mich${END}`,
  `${EDGE}tu\\s+peux\\s+me\\s+rappeler${END}`,
]

/** Reminding the speaker is their own task, so it is not a request to the listener. */
function maskRemind(text: string): string {
  let masked = text
  for (const cue of REMIND) masked = masked.replace(new RegExp(cue, 'giu'), (hit) => ' '.repeat(hit.length))
  return masked.replaceAll('思い出させて', ' '.repeat('思い出させて'.length))
}

function findAsk(text: string): { index: number } | null {
  const masked = maskRemind(text)
  const latin = new RegExp(ASK_SRC, 'iu').exec(masked)
  if (latin && latin.index >= 0) return { index: latin.index }
  const ja = JA_ASKS.map((cue) => masked.indexOf(cue)).filter((index) => index >= 0)
  if (ja.length === 0) return null
  return { index: Math.min(...ja) }
}

/** The listener-request sentence, or null when this utterance is not asking them. */
export function askClause(text: string): string | null {
  const found = findAsk(text)
  if (!found) return null
  const rest = text.slice(found.index)
  const stop = rest.search(/[.!?。？\n]/u)
  const clause = (stop === -1 ? rest : rest.slice(0, stop)).trim()
  return clause || null
}

/** A request aimed at the listener. Agreement in the same utterance is owed to the speaker. */
export function listenerAsk(text: string): 'ask' | 'owed' | 'none' {
  if (!findAsk(text)) return 'none'
  return AGREES.test(text) ? 'owed' : 'ask'
}

/** します counts only when a real verb precedes it, not a set farewell. */
function japaneseSpeakerPromise(text: string): boolean {
  if (/送ります|やります|払います|届けます|かけます/.test(text)) return true
  const rest = text.replace(/お願いします/g, '').replace(/失礼します/g, '')
  return rest.includes('します')
}

export function speakerPromises(text: string): boolean {
  return SPEAKER_OWES.test(text) || EXTRA_SPEAKER.test(text) || japaneseSpeakerPromise(text)
}

const ACTION = PROMISE_VERBS

/**
 * True only for a real owed promise or an I'll plus an action verb.
 * "I'll think about it" is not enough to override the model.
 */
export function forcesCommitment(text: string): boolean {
  const speakerAt = speakerLeadIndex(text)
  const owed = firstOwed(text)
  if (owed && (speakerAt < 0 || owed.index < speakerAt)) {
    const tail = text.slice(owed.index)
    const owedAction = new RegExp(
      `^${PROPER}\\s+(?:will\\s+(?:${ACTION})|(?:promised\\s+to|is\\s+going\\s+to)\\s+(?:${ACTION}))${END}`,
      'u',
    )
    if (owedAction.test(tail)) return true
  }
  const speakerAction = new RegExp(
    `${EDGE}(?:i'll|i will|i'm going to|im going to|i promised(?:\\s+to)?)\\s+(?:${ACTION})${END}`,
    'iu',
  )
  return speakerAction.test(text)
}

/**
 * Locked means the utterance itself decides the party, so a model guess cannot
 * invent a person or a direction for these shapes.
 */
export function inferParty(text: string): { person: string | null; direction: Direction | null; locked: boolean } {
  const speakerAt = speakerLeadIndex(text)
  const owed = firstOwed(text)
  if (owed && (speakerAt < 0 || owed.index < speakerAt)) {
    return { person: owed.person, direction: 'Owed to me', locked: true }
  }
  if (speakerAt >= 0 || SPEAKER_OWES.test(text)) {
    if (/\b(?:my own|myself)\b/i.test(text) && !namedCounterparty(text)) {
      return { person: null, direction: null, locked: true }
    }
    return { person: speakerAt >= 0 ? speakerPerson(text) : namedCounterparty(text), direction: 'I owe', locked: true }
  }
  if (PERSONAL.test(text) && !namedCounterparty(text)) {
    return { person: null, direction: null, locked: true }
  }
  return { person: null, direction: null, locked: false }
}
