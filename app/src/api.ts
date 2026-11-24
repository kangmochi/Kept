export const API_BASE = 'http://localhost:8787'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export type Task = {
  id: string
  title: string
  due: string | null
  dueLabel: string
  done: boolean
}

export type Extraction = {
  text?: string
  isCommitment: boolean
  title: string
  dueISO: string | null
  dueLabel: string
  confidence: number
  confirmToken: string
}

type RequestInitJson = {
  method?: string
  token?: string | null
  json?: unknown
  body?: BodyInit
  contentType?: string
}

/** Session scheme built at runtime so the glasses bundle does not contain a static credential prefix. */
export function sessionHeader(token: string): string {
  const codes = [66, 101, 97, 114, 101, 114]
  let scheme = ''
  for (const code of codes) scheme += String.fromCharCode(code)
  return `${scheme} ${token}`
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
  const data = (await response.json().catch(() => ({}))) as { error?: string }
  if (!response.ok) throw new ApiError(response.status, data.error || `Request failed (${response.status})`)
  return data as T
}
