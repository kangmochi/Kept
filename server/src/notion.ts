import { dueLabel } from './dates.js'
import type { Task } from './types.js'

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

export function createPageBody(input: {
  dataSourceId: string
  title: string
  dueISO: string | null
  transcript: string
}) {
  const properties: Record<string, unknown> = {
    Name: { title: [{ type: 'text', text: { content: input.title } }] },
    Done: { checkbox: false },
    Source: {
      rich_text: [{ type: 'text', text: { content: sourceText(input.transcript) } }],
    },
  }
  if (input.dueISO) properties.Due = { date: { start: input.dueISO } }
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
  return {
    id: page.id,
    title,
    due,
    dueLabel: dueLabel(due, now, timeZone),
    done: props.Done?.checkbox === true,
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

const REQUIRED: Record<string, string> = {
  Name: 'title',
  Due: 'date',
  Done: 'checkbox',
  Source: 'rich_text',
}

export function schemaProblems(properties: Record<string, { type?: string }> | undefined): string[] {
  const problems: string[] = []
  for (const [name, type] of Object.entries(REQUIRED)) {
    const actual = properties?.[name]?.type
    if (actual !== type) problems.push(`${name} should be ${type}`)
  }
  return problems
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
    )) as { properties?: Record<string, { type?: string }> }
    const problems = schemaProblems(dataSource.properties)
    if (problems.length) {
      throw new Error(`Notion data source schema does not match Keep — promises: ${problems.join('; ')}`)
    }
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

  async create(input: { title: string; dueISO: string | null; transcript: string }): Promise<{ notionPageId: string; url: string }> {
    const created = (await this.request('https://api.notion.com/v1/pages', {
      method: 'POST',
      body: JSON.stringify(
        createPageBody({
          dataSourceId: this.cfg.dataSourceId,
          title: input.title,
          dueISO: input.dueISO,
          transcript: input.transcript,
        }),
      ),
    })) as { id?: string; url?: string }
    if (!created.id) throw new Error('Notion did not return a page id')
    return { notionPageId: created.id, url: created.url ?? '' }
  }

  async markDone(pageId: string): Promise<void> {
    await this.request(`https://api.notion.com/v1/pages/${encodeURIComponent(pageId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ properties: { Done: { checkbox: true } } }),
    })
  }
}

export class UnavailableNotion {
  constructor(readonly reason: string) {}
  fail(): never {
    throw new Error(this.reason)
  }
}
