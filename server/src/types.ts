export type Direction = 'I owe' | 'Owed to me'

export type Task = {
  id: string
  title: string
  due: string | null
  dueLabel: string
  done: boolean
  person: string | null
  direction: Direction | null
}

export type Extraction = {
  isCommitment: boolean
  title: string | null
  dueISO: string | null
  dueLabel: string
  confidence: number
  person: string | null
  direction: Direction | null
}
