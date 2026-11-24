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
const ASK = new RegExp(
  `${EDGE}(?:maybe\\s+you\\s+could|could\\s+you|can\\s+you|would\\s+you|you\\s+could|bisa\\s+tolong|kamu\\s+bisa|puedes|k[oö]nntest\\s+du|tu\\s+pourrais)${END}`,
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

/** A request aimed at the listener. Agreement in the same utterance is owed to the speaker. */
export function listenerAsk(text: string): 'ask' | 'owed' | 'none' {
  const asked = ASK.test(text) || text.includes('もらえますか')
  if (!asked) return 'none'
  return AGREES.test(text) ? 'owed' : 'ask'
}

export function speakerPromises(text: string): boolean {
  return SPEAKER_OWES.test(text)
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
