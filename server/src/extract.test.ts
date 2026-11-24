import assert from 'node:assert/strict'
import test from 'node:test'
import { loadEnvFiles, readEnv } from './env.js'
import {
  ExtractError,
  buildExtractSystem,
  capitalizeTitle,
  cleanTitle,
  englishPromiseTitle,
  extractCommitment,
  fallbackTitle,
  promiseSentence,
  type LlmClient,
} from './extract.js'
import { inferParty, listenerAsk, speakerPromises } from './party.js'
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
  assert.equal(result.title, 'Review the deck')
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
  assert.equal(spanish.title, 'Envío la propuesta')
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
  assert.equal(result.title, 'Send the proposal')
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
      goodTitle: 'Send the pricing to Sarah',
      bads: ['If you still have the meeting notes,', 'send the meeting notes'],
    },
    {
      text: 'El viernes le enviaré los precios a Carlos. Si tienes las notas de la reunión, quizá puedas mandármelas.',
      due: '2026-11-27',
      good: 'enviar los precios a Carlos el viernes',
      goodTitle: 'Enviar los precios a Carlos',
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
      goodTitle: 'Send the pricing to Sarah',
      bads: ['maybe you could send the notes sometime'],
    },
    {
      text: 'Mañana le enviaré los precios a Carlos. Quizá puedas mandármelas.',
      due: '2026-11-25',
      good: 'Mañana enviar los precios a Carlos',
      goodTitle: 'Enviar los precios a Carlos',
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
      goodTitle: 'Bayar tagihan listrik ke Andi',
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
      assert.equal(filed.title, capitalizeTitle(recovered), bad)
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

test('english promises stay in English with a stable party', async () => {
  const system = buildExtractSystem(TUESDAY, 'Asia/Jakarta')
  assert.match(system, /Write the title in the same language as the utterance/)
  assert.match(system, /Never translate English into Indonesian or the reverse/)
  assert.match(system, /at 9 or 5pm/)
  assert.equal(system.includes('jam 5'), false)

  const cases = [
    {
      text: "I'll call Nadia by 5pm tomorrow",
      bad: 'call Nadia jam 5',
      title: 'Call Nadia by 5pm',
      person: 'Nadia',
      direction: 'I owe' as const,
      due: '2026-11-25',
    },
    {
      text: 'Alex promised to return the laptop by Friday',
      bad: 'Kembalikan laptop',
      title: 'Return the laptop',
      person: 'Alex',
      direction: 'Owed to me' as const,
      due: '2026-11-27',
    },
    {
      text: 'Alex promised to return the deposit by Friday',
      bad: 'Kembalikan deposit',
      title: 'Return the deposit',
      person: 'Alex',
      direction: 'Owed to me' as const,
      due: '2026-11-27',
    },
    {
      text: 'Alex promised to pay me back the deposit by Friday',
      bad: 'Bayar kembali deposit',
      title: 'Pay me back the deposit',
      person: 'Alex',
      direction: 'Owed to me' as const,
      due: '2026-11-27',
    },
    {
      text: 'Alex will send the samples by Friday',
      bad: 'Kirim sampel',
      title: 'Send the samples',
      person: 'Alex',
      direction: 'Owed to me' as const,
      due: '2026-11-27',
    },
    {
      text: "I'll pay Alex back by Friday",
      bad: 'Bayar Alex',
      title: 'Pay Alex back',
      person: 'Alex',
      direction: 'I owe' as const,
      due: '2026-11-27',
    },
    {
      text: "I'll remind Nadia by Friday",
      bad: 'Inget Nadia',
      title: 'Remind Nadia',
      person: 'Nadia',
      direction: 'I owe' as const,
      due: '2026-11-27',
    },
  ]
  for (const item of cases) {
    const calls: string[] = []
    const result = await extractCommitment(
      item.text,
      {
        async complete(prompt: string) {
          calls.push(prompt)
          return JSON.stringify({
            isCommitment: true,
            title: item.bad,
            dueISO: null,
            confidence: 0.9,
            person: null,
            direction: 'I owe',
          })
        },
      },
      TUESDAY,
    )
    assert.equal(calls.length, 2, item.text)
    assert.match(calls[1], /Write the title in English only/, item.text)
    assert.equal(result.isCommitment, true, item.text)
    assert.equal(result.title, item.title, item.text)
    assert.equal(result.title, englishPromiseTitle(item.text), item.text)
    assert.equal(result.person, item.person, item.text)
    assert.equal(result.direction, item.direction, item.text)
    assert.equal(result.dueISO, item.due, item.text)
    const again = await extractCommitment(
      item.text,
      fake({ isCommitment: true, title: item.bad, dueISO: null, confidence: 0.9, person: null, direction: 'I owe' }),
      TUESDAY,
    )
    assert.equal(again.title, result.title, item.text)
  }

  const controlCalls: string[] = []
  const control = await extractCommitment(
    "I'll call Nadia tomorrow",
    {
      async complete(prompt: string) {
        controlCalls.push(prompt)
        return JSON.stringify({ isCommitment: true, title: 'call Nadia', dueISO: null, confidence: 0.9, person: null, direction: null })
      },
    },
    TUESDAY,
  )
  assert.equal(controlCalls.length, 1)
  assert.equal(control.title, 'Call Nadia')
  assert.equal(control.person, 'Nadia')
  assert.equal(control.direction, 'I owe')
  assert.equal(control.dueISO, '2026-11-25')

  const retriedCalls: string[] = []
  const retried = await extractCommitment(
    "I'll call Nadia by 5pm tomorrow",
    {
      async complete() {
        const title = retriedCalls.length === 0 ? 'call Nadia jam 5' : 'call Nadia at 5pm'
        retriedCalls.push(title)
        return JSON.stringify({ isCommitment: true, title, dueISO: null, confidence: 0.9, person: 'Nadia', direction: 'I owe' })
      },
    },
    TUESDAY,
  )
  assert.equal(retriedCalls.length, 2)
  assert.equal(retried.title, 'Call Nadia at 5pm')
  assert.equal(retried.person, 'Nadia')
  assert.equal(retried.direction, 'I owe')
  assert.equal(retried.dueISO, '2026-11-25')

  const indonesian = [
    {
      text: 'Besok aku bayar tagihan listrik ke Andi',
      title: 'Bayar tagihan listrik ke Andi',
      person: 'Andi',
      direction: 'I owe' as const,
      due: '2026-11-25',
    },
    {
      text: 'Jumat aku akan kirim sampel ke Budi',
      title: 'Kirim sampel ke Budi',
      person: 'Budi',
      direction: 'I owe' as const,
      due: '2026-11-27',
    },
  ]
  for (const item of indonesian) {
    const calls: string[] = []
    const result = await extractCommitment(
      item.text,
      {
        async complete(prompt: string) {
          calls.push(prompt)
          return JSON.stringify({
            isCommitment: true,
            title: item.title,
            dueISO: null,
            confidence: 0.9,
            person: null,
            direction: null,
          })
        },
      },
      TUESDAY,
    )
    assert.equal(calls.length, 1, item.text)
    assert.equal(result.title, item.title, item.text)
    assert.equal(result.person, item.person, item.text)
    assert.equal(result.direction, item.direction, item.text)
    assert.equal(result.dueISO, item.due, item.text)
  }
})

test('english party rules ignore ordinary words and products', async () => {
  const rows = [
    {
      text: "I'll send the deck, the meeting is going to be on Friday",
      title: "I'll send the deck on Friday",
      expectTitle: 'Send the deck',
      person: null,
      direction: 'I owe' as const,
      due: '2026-11-27',
      modelPerson: 'meeting',
      modelDirection: 'Owed to me' as const,
    },
    {
      text: "I'll send it since the price is going to go up",
      title: "I'll send it",
      expectTitle: 'Send it',
      person: null,
      direction: 'I owe' as const,
      due: null,
      modelPerson: 'price',
      modelDirection: 'Owed to me' as const,
    },
    {
      text: "It is going to rain, I'll bring the umbrella for Nadia",
      title: 'Bring the umbrella',
      expectTitle: 'Bring the umbrella',
      person: 'Nadia',
      direction: 'I owe' as const,
      due: null,
      modelPerson: 'It',
      modelDirection: 'Owed to me' as const,
    },
    {
      text: 'The client promised to pay',
      title: 'Pay',
      expectTitle: 'Pay',
      person: null,
      direction: null,
      due: null,
      modelPerson: 'client',
      modelDirection: null,
    },
    {
      text: "I'll send the PDF by Friday",
      title: "I'll send the PDF by Friday",
      expectTitle: 'Send the PDF',
      person: null,
      direction: 'I owe' as const,
      due: '2026-11-27',
      modelPerson: 'PDF',
      modelDirection: 'I owe' as const,
    },
    {
      text: "I'll review the Notion page",
      title: "I'll review the Notion page",
      expectTitle: 'Review the Notion page',
      person: null,
      direction: 'I owe' as const,
      due: null,
      modelPerson: 'Notion',
      modelDirection: 'I owe' as const,
    },
    {
      text: "I'll ping you on Slack",
      title: "I'll ping you on Slack",
      expectTitle: 'Ping you on Slack',
      person: null,
      direction: 'I owe' as const,
      due: null,
      modelPerson: 'Slack',
      modelDirection: 'I owe' as const,
    },
    {
      text: "I'll finish the Q3 report",
      title: "I'll finish the Q3 report",
      expectTitle: 'Finish the Q3 report',
      person: null,
      direction: 'I owe' as const,
      due: null,
      modelPerson: 'Q',
      modelDirection: 'I owe' as const,
    },
  ]
  for (const row of rows) {
    const party = inferParty(row.text)
    assert.equal(party.person, row.person, row.text)
    if (row.person === null && row.text.startsWith('The client')) assert.equal(party.locked, false, row.text)
    const calls: string[] = []
    const result = await extractCommitment(
      row.text,
      {
        async complete() {
          calls.push('x')
          return JSON.stringify({
            isCommitment: true,
            title: row.title,
            dueISO: null,
            confidence: 0.9,
            person: row.modelPerson,
            direction: row.modelDirection,
          })
        },
      },
      TUESDAY,
    )
    assert.equal(calls.length, 1, row.text)
    assert.equal(result.person, row.person, row.text)
    assert.equal(result.direction, row.direction, row.text)
    assert.equal(result.title, row.expectTitle, row.text)
    assert.equal(result.dueISO, row.due, row.text)
  }

  assert.equal(englishPromiseTitle("Tomorrow I'll call Nadia"), 'Call Nadia')
  const booked = await extractCommitment(
    "I'll book my own flight",
    fake({ isCommitment: true, title: 'book my own flight', dueISO: null, confidence: 0.9, person: 'Flight', direction: 'I owe' }),
    TUESDAY,
  )
  assert.equal(booked.person, null)
  assert.equal(booked.direction, null)
  assert.equal(booked.title, 'Book my own flight')

  const normalised = await extractCommitment(
    'Alex will send the samples by Friday',
    fake({
      isCommitment: true,
      title: 'Alex will send the samples by Friday',
      dueISO: null,
      confidence: 0.9,
      person: null,
      direction: null,
    }),
    TUESDAY,
  )
  assert.equal(normalised.title, 'Send the samples')
  assert.equal(normalised.person, 'Alex')
  assert.equal(normalised.direction, 'Owed to me')
  assert.equal(normalised.dueISO, '2026-11-27')

  const also = await extractCommitment(
    'Alex will send the samples by Friday',
    fake({ isCommitment: false, title: "I'll send the samples by Friday", dueISO: null, confidence: 0.9, person: null, direction: 'I owe' }),
    TUESDAY,
  )
  assert.equal(also.isCommitment, true)
  assert.equal(also.title, 'Send the samples')
  assert.equal(also.person, 'Alex')
  assert.equal(also.direction, 'Owed to me')

  for (const line of ["I'll avoid the traffic jam tomorrow", "I'll stay for the jam session tomorrow"]) {
    const calls: string[] = []
    const result = await extractCommitment(
      line,
      {
        async complete() {
          calls.push('x')
          return JSON.stringify({
            isCommitment: true,
            title: line.includes('traffic') ? 'avoid the traffic jam' : 'stay for the jam session',
            dueISO: null,
            confidence: 0.9,
            person: null,
            direction: 'I owe',
          })
        },
      },
      TUESDAY,
    )
    assert.equal(calls.length, 1, line)
    assert.equal(result.dueISO, '2026-11-25', line)
    assert.equal((result.title ?? '').includes('jam'), true, line)
    assert.equal(result.person, null, line)
    assert.equal(result.direction, 'I owe', line)
  }
})

test('a bare I will is not forced into a promise', async () => {
  for (const line of ["I'll think about it", "I'll let you know", "Maybe I'll go to the gym", "I'll be late tomorrow"]) {
    const result = await extractCommitment(
      line,
      fake({ isCommitment: false, title: 'Think about it', dueISO: '2026-11-25', confidence: 0.9, direction: 'I owe' }),
      TUESDAY,
    )
    assert.equal(result.isCommitment, false, line)
    assert.equal(result.title, null, line)
    assert.equal(result.dueISO, null, line)
    assert.equal(result.person, null, line)
    assert.equal(result.direction, null, line)
  }

  const call = await extractCommitment(
    "I'll call Nadia tomorrow",
    fake({ isCommitment: false, title: "I'll call Nadia tomorrow", dueISO: null, confidence: 0.9, person: null, direction: null }),
    TUESDAY,
  )
  assert.equal(call.isCommitment, true)
  assert.equal(call.title, 'Call Nadia')
  assert.equal(call.person, 'Nadia')
  assert.equal(call.direction, 'I owe')
  assert.equal(call.dueISO, '2026-11-25')

  const invoice = await extractCommitment(
    "I'll send the invoice to Nadia by Friday",
    fake({ isCommitment: false, title: "I'll send the invoice to Nadia by Friday", dueISO: null, confidence: 0.9, person: null, direction: null }),
    TUESDAY,
  )
  assert.equal(invoice.isCommitment, true)
  assert.equal(invoice.title, 'Send the invoice to Nadia')
  assert.equal(invoice.person, 'Nadia')
  assert.equal(invoice.direction, 'I owe')
  assert.equal(invoice.dueISO, '2026-11-27')

  const samples = await extractCommitment(
    'Alex will send the samples by Friday',
    fake({ isCommitment: false, title: 'Alex will send the samples by Friday', dueISO: null, confidence: 0.9, person: null, direction: null }),
    TUESDAY,
  )
  assert.equal(samples.isCommitment, true)
  assert.equal(samples.title, 'Send the samples')
  assert.equal(samples.person, 'Alex')
  assert.equal(samples.direction, 'Owed to me')
  assert.equal(samples.dueISO, '2026-11-27')

  const laptop = await extractCommitment(
    'Alex promised to return the laptop by Friday',
    fake({ isCommitment: false, title: 'Alex promised to return the laptop by Friday', dueISO: null, confidence: 0.9, person: null, direction: null }),
    TUESDAY,
  )
  assert.equal(laptop.isCommitment, true)
  assert.equal(laptop.title, 'Return the laptop')
  assert.equal(laptop.person, 'Alex')
  assert.equal(laptop.direction, 'Owed to me')
  assert.equal(laptop.dueISO, '2026-11-27')

  const promised = await extractCommitment(
    "I promised Alex I'd send the deck",
    fake({ isCommitment: true, title: 'Send the deck', dueISO: null, confidence: 0.9, person: null, direction: null }),
    TUESDAY,
  )
  assert.equal(promised.person, 'Alex')
  assert.equal(promised.direction, 'I owe')
  assert.equal(promised.title, 'Send the deck')

  const myself = await extractCommitment(
    "I'll remind myself",
    fake({ isCommitment: true, title: "I'll remind myself", dueISO: null, confidence: 0.9, person: 'Myself', direction: 'I owe' }),
    TUESDAY,
  )
  assert.equal(myself.person, null)
  assert.equal(myself.direction, null)
  assert.equal(myself.title, 'Remind myself')

  const pair = await extractCommitment(
    'Sarah and Alex will send it',
    fake({ isCommitment: true, title: 'Sarah and Alex will send it', dueISO: null, confidence: 0.9, person: null, direction: null }),
    TUESDAY,
  )
  assert.equal(pair.isCommitment, true)
  assert.equal(pair.title, 'Send it')

  for (const line of ['Alex will.', "I'll."]) {
    const empty = await extractCommitment(
      line,
      fake({ isCommitment: true, title: line, dueISO: null, confidence: 0.9, direction: 'I owe' }),
      TUESDAY,
    )
    assert.equal(empty.isCommitment, false, line)
    assert.equal(empty.title, null, line)
  }
})

test('every saved title starts with an uppercase letter', async () => {
  const rows = [
    { text: "I'll send pricing to Nadia by Friday", title: 'send pricing to Nadia', expect: 'Send pricing to Nadia' },
    { text: "I'll confirm the courier booking", title: 'confirm courier booking', expect: 'Confirm courier booking' },
    { text: 'Jumat aku akan kirim sampel ke Budi', title: 'kirim sampel ke Budi', expect: 'Kirim sampel ke Budi' },
    { text: "I'll send pricing to Nadia", title: '"send pricing to Nadia"', expect: 'Send pricing to Nadia' },
  ]
  for (const row of rows) {
    const result = await extractCommitment(
      row.text,
      fake({ isCommitment: true, title: row.title, dueISO: null, confidence: 0.9 }),
      TUESDAY,
    )
    assert.equal(result.title, row.expect, row.title)
    assert.equal(result.title?.slice(1), row.expect.slice(1), row.title)
  }
  assert.equal(capitalizeTitle('"send pricing to Nadia"'), '"Send pricing to Nadia"')
  assert.equal(capitalizeTitle('envío la propuesta'), 'Envío la propuesta')
  assert.equal(capitalizeTitle('提案を送る'), '提案を送る')
})

test('empty text is a safe error and does not call the model', async () => {
  const calls: string[] = []
  await assert.rejects(
    () => extractCommitment('   ', fake({ isCommitment: true, title: 'x', dueISO: null, confidence: 1 }, calls), TUESDAY),
    (err: unknown) => err instanceof ExtractError && err.status === 400,
  )
  assert.equal(calls.length, 0)
})
