import type { HealthReport, Proposal, VersionMeta, Ontology } from '../types/ontology'

async function restGet<T>(path: string): Promise<T> {
  const res = await fetch(`/mcp${path}`)
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error((body as { error?: string }).error || `REST ${res.status}`)
  }
  return res.json()
}

export function fetchOntologyDoc(id: string): Promise<Ontology> {
  return restGet(`/ontologies/${encodeURIComponent(id)}`)
}

export function fetchVersions(id: string): Promise<VersionMeta[]> {
  return restGet(`/ontologies/${encodeURIComponent(id)}/versions`)
}

export function fetchHealth(id: string): Promise<HealthReport> {
  return restGet(`/ontologies/${encodeURIComponent(id)}/health`)
}

export function fetchProposals(id: string, status?: string): Promise<Proposal[]> {
  const qs = status ? `?status=${encodeURIComponent(status)}` : ''
  return restGet(`/ontologies/${encodeURIComponent(id)}/proposals${qs}`)
}
