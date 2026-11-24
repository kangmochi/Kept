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

const OWED = [
  new RegExp(`${EDGE}(${NAME})\\s+said\\s+(?:he|she|they)'?ll\\b`, 'iu'),
  new RegExp(`${EDGE}(${NAME})\\s+will\\s+(?:send|pay|call|review|deliver|kirim|bayar)${END}`, 'iu'),
  new RegExp(`${EDGE}(${NAME})\\s+(?:bilang|berkata)${END}`, 'iu'),
]

const SPEAKER_OWES = new RegExp(
  `${EDGE}(?:i'll|i will|i'm going to|im going to|aku akan|saya akan|aku|saya)\\s+(?:send|pay|call|review|deliver|kirim|bayar|telepon|menelpon)${END}`,
  'iu',
)

const PERSONAL = new RegExp(`${EDGE}(?:i need to|i have to|remind me to|jangan lupa|don't forget to)${END}`, 'iu')
const VERB = new RegExp(
  `${EDGE}(?:send|pay|call|review|deliver|kirim|bayar|telepon|menelpon)${END}`,
  'giu',
)
const ASK_SRC = [
  `${EDGE}(?:maybe\\s+you\\s+could|could\\s+you|can\\s+you|would\\s+you|you\\s+could)${END}`,
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

/**
 * Locked means the utterance itself decides the party, so a model guess cannot
 * invent a person or a direction for these shapes.
 */
export function inferParty(text: string): { person: string | null; direction: Direction | null; locked: boolean } {
  for (const pattern of OWED) {
    const match = text.match(pattern)
    const person = cleanPerson(match?.[1])
    if (person) return { person, direction: 'Owed to me', locked: true }
  }
  if (SPEAKER_OWES.test(text)) {
    return { person: namedCounterparty(text), direction: 'I owe', locked: true }
  }
  if (PERSONAL.test(text) && !namedCounterparty(text)) {
    return { person: null, direction: null, locked: true }
  }
  return { person: null, direction: null, locked: false }
}
