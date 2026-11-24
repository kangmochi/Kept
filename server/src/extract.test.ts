import assert from 'node:assert/strict'
import test from 'node:test'
import { loadEnvFiles, readEnv } from './env.js'
import { ExtractError, cleanTitle, extractCommitment, type LlmClient } from './extract.js'
import { createLlmClient } from './providers.js'

const TUESDAY = new Date('2026-11-24T03:00:00.000Z')

function fake(reply: unknown, calls: string[] = []): LlmClient {
  return {
    async complete(_system: string, user: string) {
      calls.push(user)
      return JSON.stringify(reply)
    },
  }
}

test('Friday commitment resolves to the coming Friday and a short title', async () => {
  const result = await extractCommitment(
    "I'll send the pricing by Friday",
    fake({ isCommitment: true, title: 'Send the pricing.', dueISO: null, confidence: 0.9 }),
    TUESDAY,
  )
  assert.equal(result.isCommitment, true)
  assert.equal(result.dueISO, '2026-11-27')
  assert.equal(result.dueLabel, 'FRI 27 NOV')
  assert.equal(result.direction, 'I owe')
  assert.equal(result.person, null)
  assert.equal(typeof result.title, 'string')
  if (!result.title) return
  assert.match(result.title, /pricing/i)
  assert.ok(result.title.length <= 40)
  assert.equal(result.title.endsWith('.'), false)
})

test('tomorrow and besok resolve in WIB', async () => {
  const english = await extractCommitment(
    "I'll call Budi tomorrow",
    fake({ isCommitment: true, title: 'call Budi', dueISO: null, confidence: 0.8 }),
    TUESDAY,
  )
  const indonesian = await extractCommitment(
    'Besok aku telepon Budi',
    fake({ isCommitment: true, title: 'telepon Budi', dueISO: null, confidence: 0.8 }),
    TUESDAY,
  )
  assert.equal(english.dueISO, '2026-11-25')
  assert.equal(english.dueLabel, 'TOMORROW')
  assert.equal(indonesian.dueISO, '2026-11-25')
  assert.equal(indonesian.isCommitment, true)
  assert.equal(typeof indonesian.title, 'string')
  if (!indonesian.title) return
  assert.match(indonesian.title, /Budi/)
})

test('small talk is not a commitment and does not invent a date', async () => {
  for (const text of ['thanks, see you', 'ok sip']) {
    const calls: string[] = []
    const result = await extractCommitment(
      text,
      fake({ isCommitment: true, title: 'meet', dueISO: '2026-12-01', confidence: 0.99 }, calls),
      TUESDAY,
    )
    assert.equal(result.isCommitment, false)
    assert.equal(result.title, null)
    assert.equal(result.confidence, 0)
    assert.equal(result.dueISO, null)
    assert.equal(result.person, null)
    assert.equal(result.direction, null)
    assert.equal(calls.length, 0)
  }
})

test('a dateless reminder stays dateless even if the model invents one', async () => {
  const result = await extractCommitment(
    'remind me to review the deck',
    fake({ isCommitment: true, title: 'review the deck', dueISO: '2026-12-01', confidence: 0.95 }),
    TUESDAY,
  )
  assert.equal(result.isCommitment, true)
  assert.equal(result.dueISO, null)
  assert.equal(result.dueLabel, '----')
  assert.equal(result.title, 'review the deck')
})

test('live model extracts a Friday promise', { skip: process.env.LIVE_LLM !== '1' }, async () => {
  loadEnvFiles()
  const env = readEnv()
  const result = await extractCommitment(
    "I'll send the pricing by Friday",
    createLlmClient(env.llmBaseUrl, env.llmApiKey, env.llmModel),
    TUESDAY,
  )
  assert.equal(result.isCommitment, true)
  assert.equal(result.dueISO, '2026-11-27')
  assert.equal(typeof result.title, 'string')
  if (!result.title) return
  assert.match(result.title, /pricing/i)
})

test('titles drop the date and keep a clock time', async () => {
  const friday = await extractCommitment(
    "I'll send the pricing by Friday",
    fake({ isCommitment: true, title: 'Send pricing by Friday', dueISO: null, confidence: 0.9 }),
    TUESDAY,
  )
  const bank = await extractCommitment(
    'Call bank tomorrow at 9',
    fake({ isCommitment: true, title: 'Call bank tomorrow at 9', dueISO: null, confidence: 0.9 }),
    TUESDAY,
  )
  const invoice = await extractCommitment(
    'Bayar invoice Jumat depan',
    fake({ isCommitment: true, title: 'Bayar invoice Jumat depan', dueISO: null, confidence: 0.88 }),
    TUESDAY,
  )
  assert.equal(friday.title, 'Send pricing')
  assert.equal(bank.title, 'Call bank at 9')
  assert.equal(bank.dueISO, '2026-11-25')
  assert.equal(invoice.title, 'Bayar invoice')
  assert.equal(invoice.dueISO, '2026-11-27')
})

test('a past model date is dropped and low confidence hides the date', async () => {
  const past = await extractCommitment(
    "I'll send the pricing by 2026-11-01",
    fake({ isCommitment: true, title: 'send the pricing', dueISO: '2020-01-01', confidence: 0.95 }),
    TUESDAY,
  )
  assert.equal(past.dueISO, null)
  const unsure = await extractCommitment(
    "I'll send the pricing by Friday",
    fake({ isCommitment: true, title: 'send pricing', dueISO: '2026-11-27', confidence: 0.4 }),
    TUESDAY,
  )
  assert.equal(unsure.isCommitment, true)
  assert.equal(unsure.dueISO, null)
  assert.equal(unsure.dueLabel, '----')
  assert.equal(unsure.confidence, 0.4)
})

test('the model saying it is not a promise returns a null title', async () => {
  const result = await extractCommitment(
    'the weather is nice',
    fake({ isCommitment: false, title: 'weather', dueISO: '2026-12-01', confidence: 0.2 }),
    TUESDAY,
  )
  assert.equal(result.isCommitment, false)
  assert.equal(result.title, null)
  assert.equal(result.confidence, 0)
  assert.equal(result.dueISO, null)
})

test('someone else promising is owed to me, and a named recipient is I owe', async () => {
  const owed = await extractCommitment(
    "Budi said he'll pay the invoice Friday",
    fake({ isCommitment: true, title: 'Budi pay the invoice', dueISO: null, confidence: 0.9, person: null, direction: null }),
    TUESDAY,
  )
  assert.equal(owed.direction, 'Owed to me')
  assert.equal(owed.person, 'Budi')
  assert.equal(owed.dueISO, '2026-11-27')

  const mine = await extractCommitment(
    'besok aku kirim proposal ke Sari',
    fake({ isCommitment: true, title: 'kirim proposal ke Sari', dueISO: null, confidence: 0.9 }),
    TUESDAY,
  )
  assert.equal(mine.direction, 'I owe')
  assert.equal(mine.person, 'Sari')
  assert.equal(mine.dueISO, '2026-11-25')
  assert.match(mine.title ?? '', /proposal/)
  assert.match(mine.title ?? '', /Sari/)
  assert.equal((mine.title ?? '').toLowerCase().includes('besok'), false)
})

test('a personal task does not invent a person or a direction', async () => {
  const result = await extractCommitment(
    'I need to book the flight',
    fake({ isCommitment: true, title: 'book the flight', dueISO: null, confidence: 0.9, person: 'Flight', direction: 'I owe' }),
    TUESDAY,
  )
  assert.equal(result.isCommitment, true)
  assert.equal(result.person, null)
  assert.equal(result.direction, null)
})

test('titles stay in the spoken language and drop the new date words', async () => {
  const spanish = await extractCommitment(
    'Mañana envío la propuesta',
    fake({ isCommitment: true, title: 'envío la propuesta mañana', dueISO: null, confidence: 0.9 }),
    TUESDAY,
  )
  assert.equal(spanish.dueISO, '2026-11-25')
  assert.equal(spanish.title, 'envío la propuesta')
  assert.equal(spanish.person, null)
  assert.equal(spanish.direction, null)

  const japanese = await extractCommitment(
    '明日提案を送る',
    fake({ isCommitment: true, title: '提案を送る 金曜日', dueISO: null, confidence: 0.9 }),
    TUESDAY,
  )
  assert.equal(japanese.dueISO, '2026-11-25')
  assert.equal(japanese.title, '提案を送る')
  assert.equal(cleanTitle('Friday', 'Friday').length > 0, true)
  assert.equal(cleanTitle('envoyer à 17h', 'envoyer à 17h'), 'envoyer à 17h')
  assert.equal(cleanTitle('Call María', 'Call María'), 'Call María')
})

test('a request to the listener is not filed as the speaker owing it', async () => {
  const english = await extractCommitment(
    'If you happen to have those meeting notes, maybe you could send them sometime.',
    fake({ isCommitment: true, title: 'send meeting notes', dueISO: null, confidence: 0.9, person: null, direction: 'I owe' }),
    TUESDAY,
  )
  assert.equal(english.isCommitment, false)
  assert.equal(english.title, null)
  assert.equal(english.person, null)
  assert.equal(english.direction, null)

  const indo = await extractCommitment(
    'Kalau kamu bisa kirim catatan rapatnya nanti.',
    fake({ isCommitment: true, title: 'kirim catatan', dueISO: null, confidence: 0.9, direction: 'I owe' }),
    TUESDAY,
  )
  assert.equal(indo.isCommitment, false)
  assert.equal(indo.direction, null)

  const tolong = await extractCommitment(
    'Bisa tolong kirim nota rapatnya.',
    fake({ isCommitment: true, title: 'kirim nota', dueISO: null, confidence: 0.8, direction: 'I owe' }),
    TUESDAY,
  )
  assert.equal(tolong.isCommitment, false)

  const agreed = await extractCommitment(
    'Could you send the notes? He said he will on Friday.',
    fake({ isCommitment: false, title: 'send the notes', dueISO: null, confidence: 0.9, person: 'He', direction: 'I owe' }),
    TUESDAY,
  )
  assert.equal(agreed.isCommitment, true)
  assert.equal(agreed.direction, 'Owed to me')
  assert.equal(agreed.person, null)
  assert.equal(agreed.dueISO, '2026-11-27')
  assert.match(agreed.title ?? '', /notes/)
})

test('thanks for hopping does not steal the person next to the promise', async () => {
  const result = await extractCommitment(
    'Hey, thanks for hopping on. ... I will send the pricing to Sarah by Friday.',
    fake({ isCommitment: true, title: 'send the pricing', dueISO: null, confidence: 0.9, person: 'hopping', direction: null }),
    TUESDAY,
  )
  assert.equal(result.person, 'Sarah')
  assert.equal(result.direction, 'I owe')
  assert.equal(result.dueISO, '2026-11-27')
})

test('titles drop leftover date words and a leading I will', () => {
  assert.equal(cleanTitle('Schicke Lukas Preise bis Ende Monat', 'bis Ende Monat'), 'Schicke Lukas Preise')
  assert.equal(cleanTitle('Schicke Lukas Preise bis Ende des Monats', 'bis Ende des Monats'), 'Schicke Lukas Preise')
  assert.equal(cleanTitle('Schicke Lukas Preise bis zum Monatsende', 'bis zum Monatsende'), 'Schicke Lukas Preise')
  assert.equal(cleanTitle('enviar el viernes', 'enviar el viernes'), 'enviar')
  assert.equal(cleanTitle('、今月末までに提案を送る', '今月末までに提案を送る'), '提案を送る')
  assert.equal(cleanTitle('今 までに提案を送る', '今月末までに提案を送る'), '提案を送る')
  assert.equal(cleanTitle('I will send the pricing', "I'll send the pricing"), 'send the pricing')
  assert.equal(cleanTitle('aku akan kirim proposal', 'aku akan kirim proposal'), 'kirim proposal')
  assert.equal(cleanTitle('el viernes', 'el viernes').length > 0, true)
})

test('empty text is a safe error and does not call the model', async () => {
  const calls: string[] = []
  await assert.rejects(
    () => extractCommitment('   ', fake({ isCommitment: true, title: 'x', dueISO: null, confidence: 1 }, calls), TUESDAY),
    (err: unknown) => err instanceof ExtractError && err.status === 400,
  )
  assert.equal(calls.length, 0)
})
