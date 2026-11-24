import type { Extraction, Task } from './api'

const STOP = new Set(['the', 'a', 'an', 'to'])

function tokens(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word && !STOP.has(word))
  return new Set(words)
}

/** Jaccard overlap of the words in two titles. */
export function tokenOverlap(a: string, b: string): number {
  const left = tokens(a)
  const right = tokens(b)
  if (left.size === 0 || right.size === 0) return 0
  let shared = 0
  for (const word of left) if (right.has(word)) shared += 1
  const union = left.size + right.size - shared
  return union === 0 ? 0 : shared / union
}

export function findDuplicate(extraction: Extraction, tasks: Task[]): Task | null {
  const title = extraction.title ?? ''
  const due = extraction.dueISO ?? null
  for (const task of tasks) {
    if ((task.due ?? null) !== due) continue
    if (tokenOverlap(title, task.title) >= 0.8) return task
  }
  return null
}
