import type { Extraction, Task } from './api'

export function clip(text: string, max = 40): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length <= max) return clean
  return `${clean.slice(0, max - 3)}...`
}

export function idleCopy(tasks: Task[]): string {
  const next = tasks.find((task) => task.due) ?? tasks[0]
  const lines = ['KEPT', `${tasks.length} open promise${tasks.length === 1 ? '' : 's'}`]
  if (next) {
    lines.push(`next due: ${next.dueLabel || '----'}`)
    lines.push(`"${clip(next.title)}"`)
  } else {
    lines.push('nothing open')
  }
  lines.push('[press] listen  [swipe] list')
  return lines.join('\n')
}

export function pairCopy(code: string): string {
  return ['KEPT', `PAIR  ${code}`, 'open the link page', 'localhost:8787/link', '[press] new code'].join('\n')
}

export function listeningCopy(seconds: number): string {
  return ['LISTENING...', `${seconds}s`, '[press] stop'].join('\n')
}

export function confirmCopy(extraction: Extraction): string {
  return [
    'SAVE THIS?',
    clip(extraction.title),
    `DUE  ${extraction.dueLabel || '----'}`,
    'owner: you',
    '[press] SAVE  [swipe] DISCARD',
  ].join('\n')
}

export function notPromiseCopy(phrase: string): string {
  return ['NOT A PROMISE', clip(phrase), '[press] ok'].join('\n')
}

export function savedCopy(title: string, dueLabel: string): string {
  return ['SAVED to Notion', clip(title), dueLabel || '----', '[press] next'].join('\n')
}

export function markCopy(task: Task): string {
  return ['MARK DONE?', clip(task.title), `DUE  ${task.dueLabel || '----'}`, '[press] DONE  [swipe] back'].join('\n')
}

export function emptyListCopy(): string {
  return ['OPEN PROMISES', 'none yet', '[dbl] back'].join('\n')
}

export function listHeader(): string {
  return 'OPEN PROMISES\n[press] done  [dbl] back'
}

export function listItem(title: string, label: string): string {
  const due = (label || '----').slice(0, 14)
  const width = 63
  let name = title.replace(/\s+/g, ' ').trim()
  const maxName = width - due.length - 1
  if (name.length > maxName) name = `${name.slice(0, Math.max(1, maxName - 3))}...`
  const gap = width - name.length - due.length
  return `${name}${' '.repeat(Math.max(1, gap))}${due}`
}

export function errorCopy(title: string, detail: string, action = '[press] retry'): string {
  return [title, clip(detail, 48), action].join('\n')
}
