export const API_BASE = 'http://localhost:8787'

export class ApiError extends Error {
  status: number
  code?: string
  constructor(status: number, message: string, code?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

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
  text?: string
  isCommitment: boolean
  title: string | null
  dueISO: string | null
  dueLabel: string
  confidence: number
  confirmToken: string
  person: string | null
  direction: Direction | null
}

type RequestInitJson = {
  method?: string
  token?: string | null
  json?: unknown
  body?: BodyInit
  contentType?: string
}

export function sessionHeader(token: string): string {
  return `Bearer ${token}`
}

export async function api<T>(path: string, init: RequestInitJson = {}): Promise<T> {
  const headers = new Headers()
  if (init.token) headers.set('Authorization', sessionHeader(init.token))
  let body = init.body
  if (init.json !== undefined) {
    headers.set('Content-Type', 'application/json')
    body = JSON.stringify(init.json)
  } else if (init.contentType) {
    headers.set('Content-Type', init.contentType)
  }
  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, { method: init.method ?? 'GET', headers, body })
  } catch {
    throw new ApiError(0, 'Server unreachable')
  }
  const data = (await response.json().catch(() => ({}))) as { error?: string; code?: string }
  if (!response.ok) throw new ApiError(response.status, data.error || `Request failed (${response.status})`, data.code)
  return data as T
}
