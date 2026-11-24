export type Task = {
  id: string
  title: string
  due: string | null
  dueLabel: string
  done: boolean
}

export type Extraction = {
  isCommitment: boolean
  title: string
  dueISO: string | null
  dueLabel: string
  confidence: number
}
