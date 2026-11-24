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

const COUNTERPARTY = new RegExp(`${EDGE}(?:ke|untuk|for)\\s+(${NAME})${END}`, 'iu')
const COUNTERPARTY_TO = new RegExp(`${EDGE}to\\s+(\\p{Lu}[\\p{L}'’-]{0,40})${END}`, 'u')

const PERSONAL = new RegExp(`${EDGE}(?:i need to|i have to|remind me to|jangan lupa|don't forget to)${END}`, 'iu')

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

/**
 * Locked means the utterance itself decides the party, so a model guess cannot
 * invent a person or a direction for these shapes.
 */
function namedCounterparty(text: string): string | null {
  return cleanPerson(text.match(COUNTERPARTY)?.[1] ?? text.match(COUNTERPARTY_TO)?.[1])
}

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
