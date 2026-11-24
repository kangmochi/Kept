import type { Direction, Extraction, Task } from './api'

export function clip(text: string, max = 28): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  const chars = [...clean]
  if (chars.length <= max) return clean
  const budget = Math.max(1, max - 1)
  let end = budget
  const slice = chars.slice(0, budget).join('')
  const space = slice.lastIndexOf(' ')
  if (space >= 12) end = space
  return `${chars.slice(0, end).join('').trimEnd()}…`
}

export function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length
}

function clipBytes(text: string, maxBytes: number): string {
  if (utf8Bytes(text) <= maxBytes) return text
  const ellipsis = '…'
  const budget = maxBytes - utf8Bytes(ellipsis)
  let out = ''
  for (const ch of text) {
    if (utf8Bytes(out + ch) > budget) break
    out += ch
  }
  return `${out.trimEnd()}${ellipsis}`
}

export function jakartaToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

export function dueCounts(tasks: Task[], today: string): { today: number; late: number } {
  let dueToday = 0
  let late = 0
  for (const task of tasks) {
    if (!task.due) continue
    if (task.due < today) late += 1
    else if (task.due === today) dueToday += 1
  }
  return { today: dueToday, late }
}

export function idleCopy(
  tasks: Task[],
  opts: { offline?: boolean; today?: string; week?: { kept: number; total: number } | null } = {},
): string {
  const today = opts.today ?? jakartaToday()
  const counts = dueCounts(tasks, today)
  const next = tasks.find((task) => task.due) ?? tasks[0]
  const lines = ['KEPT', `${tasks.length} open promise${tasks.length === 1 ? '' : 's'}`]
  if (counts.today > 0 || counts.late > 0) {
    lines.push(`${counts.today} DUE TODAY  ${counts.late} LATE`)
  }
  if (opts.week && opts.week.total > 0) {
    lines.push(`KEPT ${opts.week.kept}/${opts.week.total} THIS WEEK`)
  }
  const debt = mostUrgentDebt(tasks)
  if (debt) {
    const label = debt.dueLabel || '----'
    lines.push(debt.person ? `I OWE ${debt.person.toUpperCase()} · ${label}` : `I OWE · ${label}`)
    lines.push(`"${clip(debt.title)}"`)
  } else if (next) {
    lines.push(`next due: ${next.dueLabel || '----'}`)
    lines.push(`"${clip(next.title)}"`)
  } else {
    lines.push('nothing open')
  }
  if (opts.offline) lines.push('offline')
  lines.push('[press] listen  [swipe] list')
  return lines.join('\n')
}

export function pairCopy(code: string): string {
  return ['KEPT', `PAIR  ${code}`, 'open the link page', 'localhost:8787/link', '[press] new code'].join('\n')
}

export function pairExpiredCopy(): string {
  return ['KEPT', 'Code expired.', '[press] new code'].join('\n')
}

export function listeningCopy(seconds: number): string {
  return ['LISTENING...', `${seconds}s`, '[press] stop'].join('\n')
}

export function thinkingCopy(): string {
  return 'THINKING...'
}

export function relationLine(person: string | null | undefined, direction: Direction | null | undefined): string | null {
  if (direction !== 'I owe' && direction !== 'Owed to me') return null
  const label = direction === 'I owe' ? 'I OWE' : 'OWED TO ME'
  if (person && person.trim()) return `FOR ${person.trim().toUpperCase()} · ${label}`
  return label
}

export function confirmCopy(extraction: Extraction): string {
  const lines = ['SAVE THIS?', clip(extraction.title || 'promise'), `DUE  ${extraction.dueLabel || '----'}`]
  const relation = relationLine(extraction.person, extraction.direction)
  if (relation) lines.push(relation)
  lines.push('[press] SAVE  [swipe] DISCARD')
  return lines.join('\n')
}

export function checkCopy(extraction: Extraction): string {
  const lines = ['CHECK THIS?', clip(extraction.title || 'promise'), 'DUE  ----']
  const relation = relationLine(extraction.person, extraction.direction)
  if (relation) lines.push(relation)
  lines.push('[press] SAVE  [swipe] DISCARD')
  return lines.join('\n')
}

function byDue(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    if (a.due && b.due) return a.due < b.due ? -1 : a.due > b.due ? 1 : 0
    if (a.due) return -1
    if (b.due) return 1
    return a.title.localeCompare(b.title)
  })
}

export function mostUrgentDebt(tasks: Task[]): Task | null {
  const debts = byDue(tasks.filter((task) => task.direction === 'I owe'))
  return debts[0] ?? null
}

/** Section headers plus at most 20 task rows. A null entry is a header. */
export function promiseList(tasks: Task[]): { rows: string[]; tasks: (Task | null)[] } {
  const groups = [
    { label: 'I OWE', items: byDue(tasks.filter((task) => task.direction === 'I owe')) },
    { label: 'OWED TO ME', items: byDue(tasks.filter((task) => task.direction === 'Owed to me')) },
    { label: 'OTHER', items: byDue(tasks.filter((task) => task.direction == null)) },
  ]
  const rows: string[] = []
  const mapped: (Task | null)[] = []
  let slots = 20
  for (const group of groups) {
    if (group.items.length === 0 || slots <= 0) continue
    rows.push(`${group.label} · ${group.items.length}`)
    mapped.push(null)
    for (const task of group.items) {
      if (slots <= 0) break
      rows.push(listItem(task.title, task.dueLabel))
      mapped.push(task)
      slots -= 1
    }
  }
  return { rows, tasks: mapped }
}

export function alreadyCopy(title: string): string {
  return ['ALREADY SAVED?', clip(title), '[press] save anyway  [swipe] discard'].join('\n')
}

export function notPromiseCopy(): string {
  return ['NOT A PROMISE', 'not a promise', '[press] ok'].join('\n')
}

export function savedCopy(title: string, dueLabel: string, canUndo: boolean): string {
  return [
    'SAVED to Notion',
    clip(title),
    dueLabel || '----',
    canUndo ? '[press] undo  [swipe] next' : '[press] next',
  ].join('\n')
}

export function undoneCopy(): string {
  return ['UNDONE', '[press] next'].join('\n')
}

export function markCopy(task: Task): string {
  return ['MARK DONE?', clip(task.title), `DUE  ${task.dueLabel || '----'}`, '[press] DONE  [swipe] back'].join('\n')
}

export function emptyListCopy(): string {
  return ['OPEN PROMISES', 'none yet', '[press] back'].join('\n')
}

export function listHeader(): string {
  return 'OPEN PROMISES\n[press] select  [dbl] back'
}

export function listItem(title: string, label: string): string {
  const due = clipBytes((label || '----').toUpperCase(), 14)
  const width = 63
  const maxName = width - utf8Bytes(due) - 1
  const name = clipBytes(title.replace(/\s+/g, ' ').trim(), Math.max(1, maxName))
  let spaces = width - utf8Bytes(name) - utf8Bytes(due)
  if (spaces < 1) spaces = 1
  let row = `${name}${' '.repeat(spaces)}${due}`
  while (utf8Bytes(row) > width && row.includes(' ')) {
    row = row.replace(' ', '')
  }
  if (utf8Bytes(row) > width) row = clipBytes(row, width)
  return row
}

export type ErrorKind = 'hear' | 'extract' | 'save' | 'tasks' | 'mic' | 'pair' | 'expired' | 'undo'

export function errorText(kind: ErrorKind): { title: string; detail: string; action: string } {
  switch (kind) {
    case 'hear':
      return { title: "COULDN'T HEAR", detail: 'Try again.', action: '[press] ok' }
    case 'mic':
      return { title: 'MIC UNAVAILABLE', detail: 'Use inject on the phone.', action: '[press] ok' }
    case 'extract':
      return { title: 'KEPT', detail: "Couldn't read that.", action: '[press] back' }
    case 'save':
      return { title: 'SAVE FAILED', detail: 'Notion did not save.', action: '[press] retry  [swipe] back' }
    case 'tasks':
      return { title: 'KEPT', detail: "Couldn't load promises.", action: '[press] back' }
    case 'pair':
      return { title: 'KEPT', detail: "Couldn't get a code.", action: '[press] retry' }
    case 'expired':
      return { title: 'KEPT', detail: 'Expired. Speak again.', action: '[press] speak' }
    case 'undo':
      return { title: 'KEPT', detail: "Couldn't undo.", action: '[press] back' }
  }
}

export function errorCopy(title: string, detail: string, action = '[press] back'): string {
  return [title, detail, action].join('\n')
}
