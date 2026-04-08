// Utility functions for fetching and parsing ontology data
import yaml from 'js-yaml'
import { mcpCall } from './mcp'
import type { Ontology, Project } from '../types/ontology'

/** Fetch project metadata */
export async function fetchProject(projectId: string): Promise<Project> {
  return mcpCall<Project>('get_project', { project_id: projectId })
}

/** Fetch the full parsed ontology for a project (works for both building and published) */
export async function fetchOntology(projectId: string): Promise<Ontology | null> {
  try {
    // Try read_full_ontology_yaml first (works for building + published)
    const result = await mcpCall<{
      yaml_content?: string
      stages?: Record<string, string>
    }>('read_full_ontology_yaml', { project_id: projectId })

    if (result.yaml_content) {
      return parseOntologyYaml(result.yaml_content)
    }

    // Combine stage outputs
    if (result.stages) {
      return combineStages(result.stages)
    }

    return null
  } catch {
    // Fallback: try query_published_ontologies for published projects
    try {
      const pub = await mcpCall<{
        ontologies: Array<{
          id: string
          name: string
          classes: Array<{ id: string; name: string; first_citizen: boolean; attributes?: unknown[] }>
          relationships: Array<{ id: string; name: string; from: string; to: string; cardinality: string }>
        }>
      }>('query_published_ontologies', { ontology_id: projectId, include_attributes: true })

      if (pub.ontologies?.length > 0) {
        const o = pub.ontologies[0]
        return {
          id: o.id,
          name: o.name,
          classes: o.classes.map(c => ({
            ...c,
            attributes: c.attributes as Ontology['classes'][0]['attributes'],
          })),
          relationships: o.relationships as Ontology['relationships'],
          rules: [],
          actions: [],
        }
      }
    } catch {
      // ignore
    }
    return null
  }
}

/** Fetch review report stage output */
export async function fetchReviewReport(projectId: string): Promise<string | null> {
  try {
    const result = await mcpCall<{ stage: string; content: string }>(
      'read_scene_analysis', // We'll use the generic stage reader pattern
      { project_id: projectId }
    )
    return result.content || null
  } catch {
    return null
  }
}

/** Read a specific stage output */
export async function fetchStageOutput(projectId: string, stage: string): Promise<string | null> {
  // Map stage names to MCP tool names
  const toolMap: Record<string, string> = {
    scene_analysis: 'read_scene_analysis',
    ontology_structure: 'read_ontology_structure',
    rules_actions: 'read_rules_actions',
    review_report: 'read_review_report',
  }

  const tool = toolMap[stage]
  if (tool) {
    try {
      const result = await mcpCall<{ content: string }>(tool, { project_id: projectId })
      return result.content || null
    } catch {
      return null
    }
  }

  // For other stages, use read_full_ontology_yaml and extract
  try {
    const result = await mcpCall<{ stages?: Record<string, string> }>(
      'read_full_ontology_yaml', { project_id: projectId }
    )
    return result.stages?.[stage] || null
  } catch {
    return null
  }
}

/** Parse YAML string to Ontology object */
export function parseOntologyYaml(yamlContent: string): Ontology | null {
  try {
    let parsed = yaml.load(yamlContent) as Record<string, unknown>
    if (!parsed || typeof parsed !== 'object') return null
    // Handle ontology: wrapper (S2 agent wraps output under "ontology:" key)
    // Merge wrapper content into top level rather than replacing, since
    // the full YAML may have classes/relationships at top level and
    // rules/actions inside the ontology: wrapper
    if ('ontology' in parsed && typeof parsed.ontology === 'object' && parsed.ontology !== null) {
      const wrapper = parsed.ontology as Record<string, unknown>
      for (const [k, v] of Object.entries(wrapper)) {
        if (!(k in parsed) || parsed[k] == null || (Array.isArray(parsed[k]) && (parsed[k] as unknown[]).length === 0)) {
          parsed[k] = v
        }
      }
      delete parsed.ontology
    }
    // Remove legacy fields
    delete parsed.graph_config
    const ont = parsed as unknown as Ontology
    ont.classes = ont.classes || []
    ont.relationships = ont.relationships || []
    ont.rules = ont.rules || []
    ont.actions = ont.actions || []
    return ont
  } catch {
    return null
  }
}

/** Combine multiple stage YAML outputs into a single Ontology */
function combineStages(stages: Record<string, string>): Ontology | null {
  const combined: Partial<Ontology> = {
    id: '',
    name: '',
    classes: [],
    relationships: [],
    rules: [],
    actions: [],
  }

  // ontology_structure stage contains classes + relationships + metrics + telemetry + functions
  if (stages.ontology_structure) {
    const structure = parseOntologyYaml(stages.ontology_structure)
    if (structure) {
      combined.id = structure.id || combined.id
      combined.name = structure.name || combined.name
      combined.classes = structure.classes
      combined.relationships = structure.relationships
      combined.metrics = structure.metrics
      combined.telemetry = structure.telemetry
      combined.functions = structure.functions
    }
  }

  // rules stage contains rules + actions (agent saves as "rules_actions" or "rules_design")
  const rulesStage = stages.rules_actions || stages.rules_design
  if (rulesStage) {
    const rules = parseOntologyYaml(rulesStage)
    if (rules) {
      combined.rules = rules.rules || []
      combined.actions = rules.actions || []
    }
  }

  // scene_analysis might contain metadata
  if (stages.scene_analysis) {
    try {
      const scene = yaml.load(stages.scene_analysis) as Record<string, unknown>
      if (scene && !combined.id) {
        combined.id = (scene.id as string) || ''
        combined.name = (scene.name as string) || ''
      }
    } catch { /* ignore */ }
  }

  return combined as Ontology
}
