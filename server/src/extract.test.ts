import assert from 'node:assert/strict'
import test from 'node:test'
import { loadEnvFiles, readEnv } from './env.js'
import { ExtractError, extractCommitment, type LlmClient } from './extract.js'
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

test('empty text is a safe error and does not call the model', async () => {
  const calls: string[] = []
  await assert.rejects(
    () => extractCommitment('   ', fake({ isCommitment: true, title: 'x', dueISO: null, confidence: 1 }, calls), TUESDAY),
    (err: unknown) => err instanceof ExtractError && err.status === 400,
  )
  assert.equal(calls.length, 0)
})
