// MCP JSON-RPC 2.0 client for Ontology MCP Server
// In dev: proxied via Vite /mcp → :9091
// In Docker: proxied via nginx /mcp → ontology-mcp:9091

let reqId = 0

export async function mcpCall<T = unknown>(toolName: string, args: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch('/mcp/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: toolName, arguments: args },
      id: ++reqId,
    }),
  })
  if (!res.ok) throw new Error(`MCP request failed: ${res.status}`)
  const json = await res.json()
  if (json.error) throw new Error(json.error.message || 'MCP error')
  const result = json.result
  if (result?.isError) {
    const msg = result.content?.[0]?.text || 'Tool call failed'
    throw new Error(msg)
  }
  const text = result?.content?.[0]?.text
  if (!text) return {} as T
  return JSON.parse(text) as T
}

export async function mcpListTools() {
  const res = await fetch('/mcp/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: ++reqId }),
  })
  if (!res.ok) throw new Error(`MCP request failed: ${res.status}`)
  const json = await res.json()
  return json.result?.tools ?? []
}
