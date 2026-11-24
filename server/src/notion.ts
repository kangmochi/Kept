import { dueLabel } from './dates.js'
import type { Direction, Task } from './types.js'

export const NOTION_VERSION = '2026-03-11'

export type NotionConfig = {
  token: string
  databaseId: string
  dataSourceId: string
  timeZone: string
  now?: () => Date
}

type NotionProperty = {
  type?: string
  title?: { plain_text?: string }[]
  rich_text?: { plain_text?: string }[]
  date?: { start?: string | null } | null
  checkbox?: boolean
  select?: { name?: string | null } | null
}

type NotionPage = {
  id?: string
  url?: string
  properties?: Record<string, NotionProperty>
  in_trash?: boolean
}

export function queryOpenUrl(dataSourceId: string): string {
  return `https://api.notion.com/v1/data_sources/${dataSourceId}/query`
}

export function openTasksQueryBody() {
  return {
    filter: {
      property: 'Done',
      checkbox: { equals: false },
    },
    sorts: [{ property: 'Due', direction: 'ascending' }],
    page_size: 100,
  }
}

export function weekQueryBody(start: string, end: string) {
  return {
    filter: {
      and: [
        { property: 'Due', date: { on_or_after: start } },
        { property: 'Due', date: { on_or_before: end } },
      ],
    },
    page_size: 100,
  }
}

export function donePageBody(done: boolean) {
  return { properties: { Done: { checkbox: done } } }
}

export function trashPageBody() {
  return { in_trash: true }
}

export function createPageBody(input: {
  dataSourceId: string
  title: string
  dueISO: string | null
  transcript: string
  person?: string | null
  direction?: Direction | null
}) {
  const properties: Record<string, unknown> = {
    Name: { title: [{ type: 'text', text: { content: input.title } }] },
    Done: { checkbox: false },
    Source: {
      rich_text: [{ type: 'text', text: { content: sourceText(input.transcript) } }],
    },
  }
  if (input.dueISO) properties.Due = { date: { start: input.dueISO } }
  if (input.person) {
    properties.Person = { rich_text: [{ type: 'text', text: { content: input.person } }] }
  }
  if (input.direction === 'I owe' || input.direction === 'Owed to me') {
    properties.Direction = { select: { name: input.direction } }
  }
  return {
    parent: { type: 'data_source_id', data_source_id: input.dataSourceId },
    properties,
  }
}

export function sourceText(transcript: string): string {
  const prefix = 'kept-g2: '
  const room = 2000 - prefix.length
  return prefix + transcript.trim().slice(0, room)
}

function plain(parts: { plain_text?: string }[] | undefined): string {
  return (parts ?? []).map((part) => part.plain_text ?? '').join('').trim()
}

export function pageToTask(page: NotionPage, now: Date, timeZone: string): Task | null {
  if (!page.id || page.in_trash) return null
  const props = page.properties ?? {}
  const title = plain(props.Name?.title) || 'untitled'
  const start = props.Due?.date?.start ?? null
  const due = start && /^\d{4}-\d{2}-\d{2}/.test(start) ? start.slice(0, 10) : null
  const person = plain(props.Person?.rich_text) || null
  const selectName = props.Direction?.select?.name
  const direction: Direction | null = selectName === 'I owe' || selectName === 'Owed to me' ? selectName : null
  return {
    id: page.id,
    title,
    due,
    dueLabel: dueLabel(due, now, timeZone),
    done: props.Done?.checkbox === true,
    person,
    direction,
  }
}

export function sortOpenTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    if (a.due && b.due) return a.due < b.due ? -1 : a.due > b.due ? 1 : 0
    if (a.due) return -1
    if (b.due) return 1
    return a.title.localeCompare(b.title)
  })
}

type SchemaProperty = {
  type?: string
  select?: { options?: { name?: string | null }[] } | null
}

const REQUIRED: Record<string, string> = {
  Name: 'title',
  Due: 'date',
  Done: 'checkbox',
  Source: 'rich_text',
  Person: 'rich_text',
}

const DIRECTION_OPTIONS = ['I owe', 'Owed to me']

export function schemaProblems(properties: Record<string, SchemaProperty> | undefined): string[] {
  const problems: string[] = []
  for (const [name, type] of Object.entries(REQUIRED)) {
    const actual = properties?.[name]?.type
    if (actual !== type) problems.push(`${name} should be ${type}`)
  }
  const direction = properties?.Direction
  if (direction?.type !== 'select') problems.push('Direction should be select')
  return problems
}

/** Missing select labels are not fatal. Notion creates them when a row is written. */
export function directionOptionWarnings(properties: Record<string, SchemaProperty> | undefined): string[] {
  const direction = properties?.Direction
  if (direction?.type !== 'select') return []
  const names = new Set((direction.select?.options ?? []).map((option) => option.name))
  return DIRECTION_OPTIONS.filter((option) => !names.has(option)).map(
    (option) => `Direction select is missing ${option}; Notion creates missing select options on write`,
  )
}

export class NotionClient {
  constructor(private readonly cfg: NotionConfig) {}

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.cfg.token}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    }
  }

  private async request(url: string, init: RequestInit): Promise<unknown> {
    const response = await fetch(url, { ...init, headers: this.headers() })
    const text = await response.text()
    if (!response.ok) {
      throw new Error(`Notion request failed (${response.status})`)
    }
    return text ? JSON.parse(text) : {}
  }

  async checkSchema(): Promise<void> {
    if (this.cfg.databaseId) {
      await this.request(`https://api.notion.com/v1/databases/${this.cfg.databaseId}`, { method: 'GET' })
    }
    const dataSource = (await this.request(
      `https://api.notion.com/v1/data_sources/${this.cfg.dataSourceId}`,
      { method: 'GET' },
    )) as { properties?: Record<string, SchemaProperty> }
    const problems = schemaProblems(dataSource.properties)
    if (problems.length) {
      throw new Error(`Notion data source schema does not match Keep — promises: ${problems.join('; ')}`)
    }
    for (const warning of directionOptionWarnings(dataSource.properties)) console.warn(warning)
  }

  async queryOpen(): Promise<Task[]> {
    const now = this.cfg.now?.() ?? new Date()
    const tasks: Task[] = []
    let cursor: string | undefined
    for (let page = 0; page < 5; page += 1) {
      const body = { ...openTasksQueryBody(), start_cursor: cursor }
      const data = (await this.request(queryOpenUrl(this.cfg.dataSourceId), {
        method: 'POST',
        body: JSON.stringify(body),
      })) as { results?: NotionPage[]; has_more?: boolean; next_cursor?: string | null }
      for (const result of data.results ?? []) {
        const task = pageToTask(result, now, this.cfg.timeZone)
        if (task && !task.done) tasks.push(task)
      }
      if (!data.has_more || !data.next_cursor) break
      cursor = data.next_cursor
    }
    return sortOpenTasks(tasks)
  }

  async create(input: {
    title: string
    dueISO: string | null
    transcript: string
    person?: string | null
    direction?: Direction | null
  }): Promise<{ notionPageId: string; url: string }> {
    const created = (await this.request('https://api.notion.com/v1/pages', {
      method: 'POST',
      body: JSON.stringify(
        createPageBody({
          dataSourceId: this.cfg.dataSourceId,
          title: input.title,
          dueISO: input.dueISO,
          transcript: input.transcript,
          person: input.person,
          direction: input.direction,
        }),
      ),
    })) as { id?: string; url?: string }
    if (!created.id) throw new Error('Notion did not return a page id')
    return { notionPageId: created.id, url: created.url ?? '' }
  }

  async queryWeek(start: string, end: string): Promise<Task[]> {
    const now = this.cfg.now?.() ?? new Date()
    const tasks: Task[] = []
    let cursor: string | undefined
    for (let page = 0; page < 5; page += 1) {
      const body = { ...weekQueryBody(start, end), start_cursor: cursor }
      const data = (await this.request(queryOpenUrl(this.cfg.dataSourceId), {
        method: 'POST',
        body: JSON.stringify(body),
      })) as { results?: NotionPage[]; has_more?: boolean; next_cursor?: string | null }
      for (const result of data.results ?? []) {
        const task = pageToTask(result, now, this.cfg.timeZone)
        if (task) tasks.push(task)
      }
      if (!data.has_more || !data.next_cursor) break
      cursor = data.next_cursor
    }
    return tasks
  }

  async setDone(pageId: string, done: boolean): Promise<void> {
    await this.request(`https://api.notion.com/v1/pages/${encodeURIComponent(pageId)}`, {
      method: 'PATCH',
      body: JSON.stringify(donePageBody(done)),
    })
  }

  async markDone(pageId: string): Promise<void> {
    await this.setDone(pageId, true)
  }

  async trash(pageId: string): Promise<void> {
    await this.request(`https://api.notion.com/v1/pages/${encodeURIComponent(pageId)}`, {
      method: 'PATCH',
      body: JSON.stringify(trashPageBody()),
    })
  }
}

export class UnavailableNotion {
  constructor(readonly reason: string) {}
  fail(): never {
    throw new Error(this.reason)
  }
}
