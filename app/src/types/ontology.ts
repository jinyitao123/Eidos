// TypeScript interfaces matching the ontology YAML structure

export interface OntologyAttribute {
  id: string
  name: string
  type: 'integer' | 'decimal' | 'string' | 'text' | 'boolean' | 'date' | 'datetime' | 'enum'
  required?: boolean
  unique?: boolean
  default?: string | number | boolean
  derived?: string | boolean
  formula?: string
  graph_sync?: boolean
  configurable?: boolean
  enum_values?: string[]
  unit?: string
  value_range?: string
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
  enum_values?: string[]
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

// --- Metrics ---

export interface MetricBucket {
  id: string
  name: string
  condition: string
  description?: string
}

export interface MetricParam {
  id: string
  name: string
  type: string
  default?: string | number | boolean
  configurable?: boolean
  description?: string
}

export interface MetricDependency {
  type: 'metric' | 'attribute' | 'telemetry' | 'rule_param'
  ref: string
}

export interface OntologyMetric {
  id: string
  name: string
  description: string
  phase: string
  kind: 'aggregate' | 'composite' | 'classification'
  formula?: string
  buckets?: MetricBucket[]
  output?: string
  source_entities: string[]
  params?: MetricParam[]
  dimensions?: string[]
  granularity?: string
  depends_on?: MetricDependency[]
  status: 'implemented' | 'designed' | 'undefined'
  tool?: string
  known_issues?: string[]
}

// --- Telemetry ---

export interface TelemetryDimension {
  id: string
  values: string[]
}

export interface ContextStrategy {
  default_window: string
  max_window: string
  default_aggregation: string
  default_granularity: string
}

export interface OntologyTelemetry {
  id: string
  name: string
  description: string
  phase: string
  source_class: string
  source_filter?: string
  value_type: 'decimal' | 'integer' | 'boolean' | 'string'
  unit: string
  dimensions?: TelemetryDimension[]
  sampling: string
  normal_range?: number[]
  warning_threshold?: number
  alert_threshold?: number
  reference_standard?: string
  aggregations: string[]
  context_strategy: ContextStrategy
  retention?: string
  tool?: string
  status: 'implemented' | 'designed' | 'undefined'
  known_issues?: string[]
}

// --- Functions ---

export interface FunctionInput {
  id: string
  type: string
  required?: boolean
  default?: string | number | boolean
}

export interface FunctionOutputField {
  id: string
  type: string
  description?: string
}

export interface FunctionOutput {
  type: string
  fields?: FunctionOutputField[]
}

export interface OntologyFunction {
  id: string
  name: string
  description?: string
  phase?: string
  inputs?: FunctionInput[]
  output: FunctionOutput
}

// --- Top-level Ontology ---

export interface Ontology {
  id: string
  name: string
  version?: string
  description?: string
  classes: OntologyClass[]
  relationships: OntologyRelationship[]
  metrics?: OntologyMetric[]
  telemetry?: OntologyTelemetry[]
  rules?: OntologyRule[]
  actions?: OntologyAction[]
  functions?: OntologyFunction[]
  interfaces?: unknown[]
  security?: unknown
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
