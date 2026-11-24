import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createPageBody,
  donePageBody,
  pageToTask,
  queryOpenUrl,
  directionOptionWarnings,
  schemaProblems,
  sortOpenTasks,
  sourceText,
  trashPageBody,
  weekQueryBody,
} from './notion.js'

test('queries the data source, not the legacy database query path', () => {
  const url = queryOpenUrl('source-id')
  assert.match(url, /\/v1\/data_sources\/source-id\/query$/)
  assert.equal(url.includes('/databases/'), false)
})

test('creates a page under the data source and prefixes the transcript', () => {
  const body = createPageBody({
    dataSourceId: 'source-id',
    title: 'send pricing',
    dueISO: '2026-11-27',
    transcript: "I'll send the pricing by Friday",
  })
  assert.deepEqual(body.parent, { type: 'data_source_id', data_source_id: 'source-id' })
  assert.equal('database_id' in body.parent, false)
  const source = (body.properties.Source as { rich_text: { text: { content: string } }[] }).rich_text[0].text.content
  assert.equal(source, "kept-g2: I'll send the pricing by Friday")
  assert.equal((body.properties.Done as { checkbox: boolean }).checkbox, false)
  assert.equal(sourceText('hello').startsWith('kept-g2: '), true)
})

test('omits Due when the promise has no date', () => {
  const body = createPageBody({
    dataSourceId: 'source-id',
    title: 'review the deck',
    dueISO: null,
    transcript: 'remind me to review the deck',
  })
  assert.equal('Due' in body.properties, false)
})

test('schema check expects the Keep — promises properties', () => {
  assert.deepEqual(
    schemaProblems({
      Name: { type: 'title' },
      Due: { type: 'date' },
      Done: { type: 'checkbox' },
      Source: { type: 'rich_text' },
      Person: { type: 'rich_text' },
      Direction: { type: 'select', select: { options: [{ name: 'I owe' }, { name: 'Owed to me' }] } },
    }),
    [],
  )
  assert.ok(schemaProblems({ Name: { type: 'rich_text' } }).length > 0)
  const missing = schemaProblems({
    Name: { type: 'title' },
    Due: { type: 'date' },
    Done: { type: 'checkbox' },
    Source: { type: 'rich_text' },
  })
  assert.ok(missing.some((problem) => problem.includes('Person')))
  assert.ok(missing.some((problem) => problem.includes('Direction')))

  const keep = {
    Name: { type: 'title' },
    Due: { type: 'date' },
    Done: { type: 'checkbox' },
    Source: { type: 'rich_text' },
    Person: { type: 'rich_text' },
  }
  const wrongCase = {
    ...keep,
    Direction: { type: 'select', select: { options: [{ name: 'I Owe' }] } },
  }
  assert.deepEqual(schemaProblems(wrongCase), [])
  assert.deepEqual(directionOptionWarnings(wrongCase), [
    'Direction select is missing I owe; Notion creates missing select options on write',
    'Direction select is missing Owed to me; Notion creates missing select options on write',
  ])
  const wrongType = { ...keep, Direction: { type: 'rich_text' } }
  assert.ok(schemaProblems(wrongType).some((problem) => problem.includes('Direction')))
  assert.deepEqual(directionOptionWarnings(wrongType), [])
})

test('parses a page and sorts empty dates last', () => {
  const now = new Date('2026-11-24T03:00:00.000Z')
  const dated = pageToTask(
    {
      id: 'page-a',
      properties: {
        Name: { title: [{ plain_text: 'call Budi' }] },
        Due: { date: { start: '2026-11-27' } },
        Done: { checkbox: false },
      },
    },
    now,
    'Asia/Jakarta',
  )
  const open = pageToTask(
    {
      id: 'page-b',
      properties: {
        Name: { title: [{ plain_text: 'review the deck' }] },
        Due: { date: null },
        Done: { checkbox: false },
      },
    },
    now,
    'Asia/Jakarta',
  )
  assert.equal(dated?.dueLabel, 'FRI 27 NOV')
  assert.equal(open?.due, null)
  assert.deepEqual(
    sortOpenTasks([open!, dated!]).map((task) => task.id),
    ['page-a', 'page-b'],
  )
})

test('person and direction are optional on the page body and round-trip from a page', () => {
  const omitted = createPageBody({
    dataSourceId: 'source-id',
    title: 'send pricing',
    dueISO: '2026-11-27',
    transcript: 'by Friday',
    person: null,
    direction: null,
  })
  assert.equal('Person' in omitted.properties, false)
  assert.equal('Direction' in omitted.properties, false)
  const filled = createPageBody({
    dataSourceId: 'source-id',
    title: 'kirim proposal',
    dueISO: '2026-11-25',
    transcript: 'ke Sari',
    person: 'Sari',
    direction: 'I owe',
  })
  const person = (filled.properties.Person as { rich_text: { text: { content: string } }[] }).rich_text[0].text.content
  const direction = (filled.properties.Direction as { select: { name: string } }).select.name
  assert.equal(person, 'Sari')
  assert.equal(direction, 'I owe')
  const now = new Date('2026-11-24T03:00:00.000Z')
  const task = pageToTask(
    {
      id: 'page-c',
      properties: {
        Name: { title: [{ plain_text: 'kirim proposal' }] },
        Person: { rich_text: [{ plain_text: 'Sari' }] },
        Direction: { select: { name: 'I owe' } },
        Done: { checkbox: false },
      },
    },
    now,
    'Asia/Jakarta',
  )
  assert.equal(task?.person, 'Sari')
  assert.equal(task?.direction, 'I owe')
  const unknown = pageToTask(
    {
      id: 'page-d',
      properties: {
        Name: { title: [{ plain_text: 'book flight' }] },
        Direction: { select: { name: 'Maybe' } },
        Done: { checkbox: false },
      },
    },
    now,
    'Asia/Jakarta',
  )
  assert.equal(unknown?.person, null)
  assert.equal(unknown?.direction, null)
})

test('week query, done, and trash bodies match the Notion API', () => {
  const week = weekQueryBody('2026-11-23', '2026-11-29')
  assert.deepEqual(week.filter.and[0], { property: 'Due', date: { on_or_after: '2026-11-23' } })
  assert.deepEqual(week.filter.and[1], { property: 'Due', date: { on_or_before: '2026-11-29' } })
  assert.deepEqual(donePageBody(false), { properties: { Done: { checkbox: false } } })
  assert.deepEqual(trashPageBody(), { in_trash: true })
})
