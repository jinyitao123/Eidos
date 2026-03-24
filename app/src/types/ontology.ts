// TypeScript interfaces matching the ontology YAML structure

export interface OntologyAttribute {
  id: string
  name: string
  type: 'integer' | 'decimal' | 'string' | 'text' | 'boolean' | 'date' | 'datetime' | 'enum'
  required?: boolean
  unique?: boolean
  default?: string | number | boolean
  derived?: string
  graph_sync?: boolean
  configurable?: boolean
  enum_values?: string[]
  unit?: string
  description?: string
  phase?: string
}

export interface OntologyClass {
  id: string
  name: string
  first_citizen?: boolean
  phase?: string
  description?: string
  imported_from?: string
  attributes?: OntologyAttribute[]
}

export interface EdgeAttribute {
  id: string
  name: string
  type: string
  description?: string
}

export interface OntologyRelationship {
  id: string
  name: string
  from: string
  to: string
  cardinality: 'one_to_one' | 'one_to_many' | 'many_to_one' | 'many_to_many'
  edge_attributes?: EdgeAttribute[]
}

export interface RuleParam {
  id: string
  name: string
  type: string
  default?: string | number
  configurable?: boolean
  description?: string
}

export interface RuleTrigger {
  type: 'before_action' | 'after_action' | 'schedule'
  source?: string[]
  cron?: string
}

export interface RuleCondition {
  entity: string
  expression: string
}

export interface RuleAction {
  type: string
  target?: string
  message_template?: string
  notify?: string
}

export interface OntologyRule {
  id: string
  name: string
  phase?: string
  severity?: string
  trigger: RuleTrigger
  condition: RuleCondition
  action: RuleAction
  params?: RuleParam[]
}

export interface ActionWrite {
  target: string
  set: Record<string, string>
}

export interface OntologyAction {
  id: string
  name: string
  phase?: string
  params?: RuleParam[]
  writes?: ActionWrite[]
  triggers_before?: string[]
  triggers_after?: string[]
  permission?: { roles?: string[]; agents?: string[] }
  decision_log?: boolean
}

export interface GraphConfig {
  structure_sync?: Record<string, unknown>
  status_sync?: Record<string, unknown>
  event_sync?: Record<string, unknown>
  nodes_not_in_graph?: string[]
  archive_events_after_days?: number
}

export interface Ontology {
  id: string
  name: string
  version?: string
  description?: string
  classes: OntologyClass[]
  relationships: OntologyRelationship[]
  rules?: OntologyRule[]
  actions?: OntologyAction[]
  functions?: unknown[]
  interfaces?: unknown[]
  security?: unknown
  graph_config?: GraphConfig
  connector_hints?: unknown
}

export interface Project {
  id: string
  name: string
  description: string
  status: 'published' | 'building' | 'reviewing' | 'pending' | 'archived'
  current_stage: string
  published_version?: string
  published_at?: string
  created_at: string
  updated_at: string
  yaml_content?: string
  stages?: { stage: string; created_at: string }[]
}

export interface ReviewIssue {
  type: 'consistency' | 'completeness' | 'suggestion'
  id: string
  text: string
  detail: string
  fix_suggestion: string
  auto_fixable: boolean
  blocking: boolean
}

export interface ReviewReport {
  summary: {
    total_checks: number
    passed: number
    consistency_issues: number
    completeness_issues: number
    suggestions: number
  }
  issues: ReviewIssue[]
  passed_items: string[]
}
