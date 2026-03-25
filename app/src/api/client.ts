// Weave API client
// In dev: proxied via Vite /api → :8080
// In Docker: proxied via nginx /api → weave:8080

let _token: string | null = null

async function getToken(): Promise<string> {
  if (_token) return _token
  const res = await fetch('/api/v1/auth/token', { method: 'POST' })
  if (!res.ok) throw new Error('Failed to get auth token')
  const data = await res.json()
  _token = data.token
  return _token!
}

export async function weaveGet<T = unknown>(path: string): Promise<T> {
  const token = await getToken()
  const res = await fetch(`/api${path}`, {
    headers: { 'Authorization': `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`Weave API ${res.status}: ${path}`)
  return res.json()
}

export async function weavePost<T = unknown>(path: string, body: unknown): Promise<T> {
  const token = await getToken()
  const res = await fetch(`/api${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Weave API ${res.status}: ${path}`)
  return res.json()
}

/** SSE event from Weave streaming API */
export interface SSEEvent {
  event: string
  data: Record<string, unknown>
}

/**
 * Stream a POST request to Weave API via SSE.
 * Calls onEvent for each SSE event, returns the final "done" payload.
 */
export async function weaveStream(
  path: string,
  body: unknown,
  onEvent: (evt: SSEEvent) => void,
): Promise<Record<string, unknown>> {
  const token = await getToken()
  const res = await fetch(`/api${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ ...body as object, stream: true }),
  })
  if (!res.ok) throw new Error(`Weave API ${res.status}: ${path}`)
  if (!res.body) throw new Error('No response body')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let donePayload: Record<string, unknown> = {}

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    // Parse SSE lines
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    let currentEvent = ''
    let currentData = ''

    for (const line of lines) {
      if (line.startsWith('event: ')) {
        currentEvent = line.slice(7).trim()
      } else if (line.startsWith('data: ')) {
        currentData = line.slice(6)
      } else if (line === '' && currentEvent && currentData) {
        try {
          const parsed = JSON.parse(currentData)
          const evt: SSEEvent = { event: currentEvent, data: parsed }
          onEvent(evt)
          if (currentEvent === 'done') {
            donePayload = parsed
          }
        } catch { /* skip malformed */ }
        currentEvent = ''
        currentData = ''
      }
    }
  }

  return donePayload
}
