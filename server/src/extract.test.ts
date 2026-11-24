import assert from 'node:assert/strict'
import test from 'node:test'
import { loadEnvFiles, readEnv } from './env.js'
import { ExtractError, cleanTitle, extractCommitment, fallbackTitle, promiseSentence, type LlmClient } from './extract.js'
import { listenerAsk, speakerPromises } from './party.js'
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
  assert.equal(cleanTitle('Preise an Lukas schicken bis Ende des Monats', 'bis Ende des Monats'), 'Preise an Lukas schicken')
  assert.equal(
    cleanTitle('Envoyer les tarifs à Julien la semaine prochaine', 'la semaine prochaine'),
    'Envoyer les tarifs à Julien',
  )
  assert.equal(
    cleanTitle('Akhir bulan Bayar tagihan listrik ke Andi', 'akhir bulan'),
    'Bayar tagihan listrik ke Andi',
  )
})

test('remind me is the speaker\'s own promise, not a request', async () => {
  const result = await extractCommitment(
    'Can you remind me to send the proposal tomorrow?',
    fake({ isCommitment: true, title: 'send the proposal tomorrow', dueISO: null, confidence: 0.9, direction: 'I owe' }),
    TUESDAY,
  )
  assert.equal(result.isCommitment, true)
  assert.equal(result.direction, null)
  assert.equal(result.person, null)
  assert.equal(result.dueISO, '2026-11-25')
  assert.equal(result.title, 'send the proposal')
  for (const line of [
    'could you remind me to call',
    'bisa ingetin aku besok',
    '¿me recuerdas llamar',
    'erinnerst du mich morgen',
    'tu peux me rappeler demain',
    '思い出させて',
    'si no puedes',
    'cuando puedas',
  ]) {
    assert.equal(listenerAsk(line), 'none', line)
  }
})

test('a bare puedes is not an ask, and the dialog request lines are not filed', async () => {
  for (const line of ['quizá puedas mandármelas', 'tu pourras me les envoyer', '送ってもらえると助かります', 'boleh kirim']) {
    const filed = await extractCommitment(
      line,
      fake({ isCommitment: true, title: line, dueISO: '2026-11-27', confidence: 0.9, direction: 'I owe' }),
      TUESDAY,
    )
    assert.equal(filed.isCommitment, false, line)
    assert.equal(filed.title, null, line)
    assert.equal(filed.direction, null, line)
  }
})

test('a promise next to a request is kept, and the request itself is not filed', async () => {
  const dialogs = [
    {
      text: 'Thanks for the call. I will send the pricing to Sarah by Friday. If you still have the meeting notes, maybe you could send them sometime.',
      due: '2026-11-27',
      good: 'send the pricing to Sarah by Friday',
      goodTitle: 'send the pricing to Sarah',
      bads: ['If you still have the meeting notes,', 'send the meeting notes'],
    },
    {
      text: 'El viernes le enviaré los precios a Carlos. Si tienes las notas de la reunión, quizá puedas mandármelas.',
      due: '2026-11-27',
      good: 'enviar los precios a Carlos el viernes',
      goodTitle: 'enviar los precios a Carlos',
      bads: ['Si tienes las notas de la reunión,', 'mandar las notas'],
    },
    {
      text: 'Ich schicke Lukas die Preise bis Ende des Monats. Wenn du die Notizen noch hast, könntest du sie mir irgendwann schicken?',
      due: '2026-11-30',
      good: 'Preise an Lukas schicken bis Ende des Monats',
      goodTitle: 'Preise an Lukas schicken',
      bads: ['Wenn du die Notizen noch hast, könntest', 'Notizen schicken'],
    },
    {
      text: "La semaine prochaine, j'enverrai les tarifs à Julien. Si tu as encore les notes de la réunion, tu pourras me les envoyer.",
      due: '2026-12-01',
      good: 'Envoyer les tarifs à Julien la semaine prochaine',
      goodTitle: 'Envoyer les tarifs à Julien',
      bads: ['Si tu as encore les notes de la', 'envoyer les notes'],
    },
    {
      text: '今月末までに、田中さんに見積もりを送ります。会議のメモが残っていたら、いつか送ってもらえると助かります。',
      due: '2026-11-30',
      good: '今月末までに田中さんに見積もりを送ります',
      goodTitle: '田中さんに見積もりを送ります',
      bads: ['会議のメモが残っていたら いつか送ってもらえると助かります', 'メモを送る'],
    },
    {
      text: 'Akhir bulan aku bayar tagihan listrik ke Andi. Kalau kamu masih simpan catatan rapat, boleh kirim kapan-kapan.',
      due: '2026-11-30',
      good: 'Akhir bulan Bayar tagihan listrik ke Andi',
      goodTitle: 'Bayar tagihan listrik ke Andi',
      bads: ['Kalau kamu masih simpan catatan', 'Kirim catatan rapat'],
    },
    {
      text: 'I will send the pricing to Sarah tomorrow. Maybe you could send the notes sometime.',
      due: '2026-11-25',
      good: 'send the pricing to Sarah tomorrow',
      goodTitle: 'send the pricing to Sarah',
      bads: ['maybe you could send the notes sometime'],
    },
    {
      text: 'Mañana le enviaré los precios a Carlos. Quizá puedas mandármelas.',
      due: '2026-11-25',
      good: 'Mañana enviar los precios a Carlos',
      goodTitle: 'enviar los precios a Carlos',
      bads: ['quizá puedas mandármelas'],
    },
    {
      text: 'Ich schicke Lukas die Preise morgen. Könntest du sie mir schicken?',
      due: '2026-11-25',
      good: 'Preise an Lukas schicken morgen',
      goodTitle: 'Preise an Lukas schicken',
      bads: ['Könntest du sie mir schicken'],
    },
    {
      text: "Demain j'enverrai les tarifs à Julien. Tu pourras me les envoyer.",
      due: '2026-11-25',
      good: 'Envoyer les tarifs à Julien demain',
      goodTitle: 'Envoyer les tarifs à Julien',
      bads: ['tu pourras me les envoyer'],
    },
    {
      text: '明日、田中さんに見積もりを送ります。送ってもらえると助かります。',
      due: '2026-11-25',
      good: '明日田中さんに見積もりを送ります',
      goodTitle: '田中さんに見積もりを送ります',
      bads: ['送ってもらえると助かります'],
    },
    {
      text: 'Besok aku bayar tagihan listrik ke Andi. Boleh kirim.',
      due: '2026-11-25',
      good: 'Besok bayar tagihan listrik ke Andi',
      goodTitle: 'bayar tagihan listrik ke Andi',
      bads: ['boleh kirim'],
    },
  ]
  for (const dialog of dialogs) {
    const kept = await extractCommitment(
      dialog.text,
      fake({ isCommitment: true, title: dialog.good, dueISO: null, confidence: 0.9, direction: 'I owe' }),
      TUESDAY,
    )
    assert.equal(kept.isCommitment, true, dialog.text)
    assert.equal(kept.dueISO, dialog.due, dialog.text)
    assert.equal(kept.title, dialog.goodTitle, dialog.text)
    assert.equal((kept.title ?? '').length > 0, true, dialog.text)

    const recovered = fallbackTitle(promiseSentence(dialog.text) ?? '')
    for (const bad of dialog.bads) {
      const filed = await extractCommitment(
        dialog.text,
        fake({ isCommitment: true, title: bad, dueISO: dialog.due, confidence: 0.9, direction: 'I owe' }),
        TUESDAY,
      )
      assert.equal(filed.isCommitment, true, bad)
      assert.equal(filed.dueISO, dialog.due, bad)
      assert.equal(filed.title, recovered, bad)
      assert.equal(filed.title === bad, false, bad)
    }
  }
})

test('german verb-second order is still the speaker promise', async () => {
  const first = await extractCommitment(
    'Morgen schicke ich den Vorschlag an Anna. Könntest du mir die Notizen schicken?',
    fake({ isCommitment: true, title: 'den Vorschlag an Anna schicken', dueISO: null, confidence: 0.9 }),
    TUESDAY,
  )
  assert.equal(first.isCommitment, true)
  assert.equal(first.dueISO, '2026-11-25')
  assert.match(first.title ?? '', /Vorschlag/)
  assert.doesNotMatch(first.title ?? '', /Notizen/)

  const second = await extractCommitment(
    'Dann sende ich die Datei morgen. Könntest du das prüfen?',
    fake({ isCommitment: true, title: 'die Datei senden', dueISO: null, confidence: 0.9 }),
    TUESDAY,
  )
  assert.equal(second.isCommitment, true)
  assert.equal(second.dueISO, '2026-11-25')
  assert.match(second.title ?? '', /Datei/)
  assert.doesNotMatch(second.title ?? '', /prüfen|prufen/)
})

test('casual phrases are not speaker promises', () => {
  for (const line of [
    'je vais bien',
    'voy a comer',
    'voy a casa',
    'Ich werde müde',
    'よろしくお願いします',
    '失礼します',
    'お疲れ様です',
  ]) {
    assert.equal(speakerPromises(line), false, line)
  }
  assert.equal(speakerPromises('voy a enviar el informe'), true)
  assert.equal(speakerPromises('je vais envoyer les tarifs'), true)
  assert.equal(speakerPromises('Ich werde die Datei senden'), true)
  assert.equal(speakerPromises('Morgen schicke ich den Vorschlag'), true)
  assert.equal(speakerPromises('Dann sende ich die Datei'), true)
  assert.equal(speakerPromises('Morgen rufe ich Anna an'), true)
  assert.equal(speakerPromises('見積もりを送ります'), true)
})

test('empty text is a safe error and does not call the model', async () => {
  const calls: string[] = []
  await assert.rejects(
    () => extractCommitment('   ', fake({ isCommitment: true, title: 'x', dueISO: null, confidence: 1 }, calls), TUESDAY),
    (err: unknown) => err instanceof ExtractError && err.status === 400,
  )
  assert.equal(calls.length, 0)
})
