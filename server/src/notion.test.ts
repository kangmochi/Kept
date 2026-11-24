import assert from 'node:assert/strict'
import test from 'node:test'
import { createPageBody, pageToTask, queryOpenUrl, schemaProblems, sortOpenTasks, sourceText } from './notion.js'

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

test('schema check expects the four Keep — promises properties', () => {
  assert.deepEqual(
    schemaProblems({
      Name: { type: 'title' },
      Due: { type: 'date' },
      Done: { type: 'checkbox' },
      Source: { type: 'rich_text' },
    }),
    [],
  )
  assert.ok(schemaProblems({ Name: { type: 'rich_text' } }).length > 0)
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
  assert.equal(dated?.dueLabel, 'Fri 27 Nov')
  assert.equal(open?.due, null)
  assert.deepEqual(
    sortOpenTasks([open!, dated!]).map((task) => task.id),
    ['page-a', 'page-b'],
  )
})
