// Chat client for the Eidos server (swappable executor at /chat via /mcp proxy).
// Weave-direct helpers were removed when the old pages were retired.

/** SSE event (event name + parsed data). */
export interface SSEEvent {
  event: string
  data: Record<string, unknown>
}

/** Chat request body for the Eidos server's swappable-executor /chat endpoint. */
export interface EidosChatBody {
  agent: string
  message: string
  profile?: string
  session_id?: string
  context?: Record<string, unknown>
  history?: { role: string; content: string }[]
}

/**
 * Stream chat from the Eidos server's /chat endpoint (via the /mcp proxy → :9091/chat).
 * The backend (Weave / Claude Code / opencode) is chosen server-side by EIDOS_EXECUTOR;
 * the event vocabulary matches weaveStream so callers parse identically. No auth token —
 * the Eidos server is reached through the same proxy as the MCP tools.
 */
export async function eidosChatStream(
  body: EidosChatBody,
  onEvent: (evt: SSEEvent) => void,
): Promise<Record<string, unknown>> {
  const res = await fetch('/mcp/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Eidos chat ${res.status}`)
  if (!res.body) throw new Error('No response body')
  return consumeSSE(res.body, onEvent)
}

/** Parse an SSE stream, dispatching each event to onEvent; returns the final "done" payload. */
async function consumeSSE(
  body: ReadableStream<Uint8Array>,
  onEvent: (evt: SSEEvent) => void,
): Promise<Record<string, unknown>> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let donePayload: Record<string, unknown> = {}

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

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
          onEvent({ event: currentEvent, data: parsed })
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
