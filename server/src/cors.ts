/** Browser origins allowed to call the API. Everything else gets no CORS header. */
const APP_ORIGINS = new Set(['http://localhost:5173', 'http://127.0.0.1:5173'])

export function allowedOrigin(origin: string | undefined): string | null {
  if (!origin) return null
  if (APP_ORIGINS.has(origin)) return origin
  // Even Hub's packaged webview. The simulator loads the Vite origin above.
  if (origin === 'evenhub://app' || origin === 'https://evenhub.app') return origin
  return null
}

export function corsHeaders(origin: string | undefined): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    Vary: 'Origin',
  }
  const allow = allowedOrigin(origin)
  if (allow) headers['Access-Control-Allow-Origin'] = allow
  return headers
}
