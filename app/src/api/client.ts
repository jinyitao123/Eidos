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
