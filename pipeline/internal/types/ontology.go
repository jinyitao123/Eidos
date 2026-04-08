package types

import "strings"

// Ontology is the top-level structure of an ontology YAML document.
// Shared between pipeline generators.
type Ontology struct {
	Name          string         `yaml:"name" json:"name"`
	ID            string         `yaml:"id" json:"id"`
	Version       string         `yaml:"version" json:"version"`
	Description   string         `yaml:"description" json:"description"`
	Classes       []Class        `yaml:"classes" json:"classes"`
	Relationships []Relationship `yaml:"relationships" json:"relationships"`
	Metrics       []Metric       `yaml:"metrics,omitempty" json:"metrics,omitempty"`
	Telemetry     []Telemetry    `yaml:"telemetry,omitempty" json:"telemetry,omitempty"`
	Rules         []Rule         `yaml:"rules,omitempty" json:"rules,omitempty"`
	Actions       []Action       `yaml:"actions,omitempty" json:"actions,omitempty"`
	Functions     []Function     `yaml:"functions,omitempty" json:"functions,omitempty"`
}

type OntologyDoc struct {
	Ontology Ontology `yaml:"ontology" json:"ontology"`
}

type Class struct {
	ID                string             `yaml:"id" json:"id"`
	Name              string             `yaml:"name" json:"name"`
	Description       string             `yaml:"description,omitempty" json:"description,omitempty"`
	FirstCitizen      bool               `yaml:"first_citizen,omitempty" json:"first_citizen,omitempty"`
	Phase             string             `yaml:"phase" json:"phase"`
	ImportedFrom      string             `yaml:"imported_from,omitempty" json:"imported_from,omitempty"`
	Attributes        []Attribute        `yaml:"attributes" json:"attributes"`
	UniqueConstraints []UniqueConstraint `yaml:"unique_constraints,omitempty" json:"unique_constraints,omitempty"`
}

type UniqueConstraint struct {
	Columns []string `yaml:"columns" json:"columns"`
}

type Attribute struct {
	ID           string   `yaml:"id" json:"id"`
	Name         string   `yaml:"name" json:"name"`
	Type         string   `yaml:"type" json:"type"`
	Required     bool     `yaml:"required,omitempty" json:"required,omitempty"`
	Unique       bool     `yaml:"unique,omitempty" json:"unique,omitempty"`
	Default      any      `yaml:"default,omitempty" json:"default,omitempty"`
	Derived      string   `yaml:"derived,omitempty" json:"derived,omitempty"`
	Configurable bool     `yaml:"configurable,omitempty" json:"configurable,omitempty"`
	EnumValues   []string `yaml:"enum_values,omitempty" json:"enum_values,omitempty"`
	Unit         string   `yaml:"unit,omitempty" json:"unit,omitempty"`
	ValueRange   string   `yaml:"value_range,omitempty" json:"value_range,omitempty"`
	Phase        string   `yaml:"phase,omitempty" json:"phase,omitempty"`
	Description  string   `yaml:"description,omitempty" json:"description,omitempty"`
}

type Relationship struct {
	ID             string          `yaml:"id" json:"id"`
	Name           string          `yaml:"name" json:"name"`
	From           string          `yaml:"from" json:"from"`
	To             string          `yaml:"to" json:"to"`
	Cardinality    string          `yaml:"cardinality" json:"cardinality"`
	Required       bool            `yaml:"required,omitempty" json:"required,omitempty"`
	Phase          string          `yaml:"phase,omitempty" json:"phase,omitempty"`
	Description    string          `yaml:"description,omitempty" json:"description,omitempty"`
	EdgeAttributes []EdgeAttribute `yaml:"edge_attributes,omitempty" json:"edge_attributes,omitempty"`
}

type EdgeAttribute struct {
	ID          string   `yaml:"id" json:"id"`
	Name        string   `yaml:"name" json:"name"`
	Type        string   `yaml:"type" json:"type"`
	Description string   `yaml:"description,omitempty" json:"description,omitempty"`
	EnumValues  []string `yaml:"enum_values,omitempty" json:"enum_values,omitempty"`
}

// Metric defines a business measurement with explicit semantics.
type Metric struct {
	ID             string             `yaml:"id" json:"id"`
	Name           string             `yaml:"name" json:"name"`
	Description    string             `yaml:"description" json:"description"`
	Phase          string             `yaml:"phase" json:"phase"`
	Kind           string             `yaml:"kind" json:"kind"`
	Formula        string             `yaml:"formula,omitempty" json:"formula,omitempty"`
	Buckets        []MetricBucket     `yaml:"buckets,omitempty" json:"buckets,omitempty"`
	Output         string             `yaml:"output,omitempty" json:"output,omitempty"`
	SourceEntities []string           `yaml:"source_entities" json:"source_entities"`
	Params         []MetricParam      `yaml:"params,omitempty" json:"params,omitempty"`
	Dimensions     []string           `yaml:"dimensions,omitempty" json:"dimensions,omitempty"`
	Granularity    string             `yaml:"granularity,omitempty" json:"granularity,omitempty"`
	DependsOn      []MetricDependency `yaml:"depends_on,omitempty" json:"depends_on,omitempty"`
	Status         string             `yaml:"status" json:"status"`
	Tool           string             `yaml:"tool,omitempty" json:"tool,omitempty"`
	KnownIssues    []string           `yaml:"known_issues,omitempty" json:"known_issues,omitempty"`
}

type MetricBucket struct {
	ID          string `yaml:"id" json:"id"`
	Name        string `yaml:"name" json:"name"`
	Condition   string `yaml:"condition" json:"condition"`
	Description string `yaml:"description,omitempty" json:"description,omitempty"`
}

type MetricParam struct {
	ID           string `yaml:"id" json:"id"`
	Name         string `yaml:"name" json:"name"`
	Type         string `yaml:"type" json:"type"`
	Default      any    `yaml:"default,omitempty" json:"default,omitempty"`
	Configurable bool   `yaml:"configurable,omitempty" json:"configurable,omitempty"`
	Description  string `yaml:"description,omitempty" json:"description,omitempty"`
}

type MetricDependency struct {
	Type string `yaml:"type" json:"type"`
	Ref  string `yaml:"ref" json:"ref"`
}

// Telemetry defines a continuous observable data stream from an entity.
type Telemetry struct {
	ID                string           `yaml:"id" json:"id"`
	Name              string           `yaml:"name" json:"name"`
	Description       string           `yaml:"description" json:"description"`
	Phase             string           `yaml:"phase" json:"phase"`
	SourceClass       string           `yaml:"source_class" json:"source_class"`
	SourceFilter      string           `yaml:"source_filter,omitempty" json:"source_filter,omitempty"`
	ValueType         string           `yaml:"value_type" json:"value_type"`
	Unit              string           `yaml:"unit" json:"unit"`
	Dimensions        []TelemetryDim   `yaml:"dimensions,omitempty" json:"dimensions,omitempty"`
	Sampling          string           `yaml:"sampling" json:"sampling"`
	NormalRange       []float64        `yaml:"normal_range,omitempty" json:"normal_range,omitempty"`
	WarningThreshold  *float64         `yaml:"warning_threshold,omitempty" json:"warning_threshold,omitempty"`
	AlertThreshold    *float64         `yaml:"alert_threshold,omitempty" json:"alert_threshold,omitempty"`
	ReferenceStandard string           `yaml:"reference_standard,omitempty" json:"reference_standard,omitempty"`
	Aggregations      []string         `yaml:"aggregations" json:"aggregations"`
	ContextStrategy   *ContextStrategy `yaml:"context_strategy" json:"context_strategy"`
	Retention         string           `yaml:"retention,omitempty" json:"retention,omitempty"`
	Tool              string           `yaml:"tool,omitempty" json:"tool,omitempty"`
	Status            string           `yaml:"status" json:"status"`
	KnownIssues       []string         `yaml:"known_issues,omitempty" json:"known_issues,omitempty"`
}

type TelemetryDim struct {
	ID     string   `yaml:"id" json:"id"`
	Values []string `yaml:"values" json:"values"`
}

type ContextStrategy struct {
	DefaultWindow      string `yaml:"default_window" json:"default_window"`
	MaxWindow          string `yaml:"max_window" json:"max_window"`
	DefaultAggregation string `yaml:"default_aggregation" json:"default_aggregation"`
	DefaultGranularity string `yaml:"default_granularity" json:"default_granularity"`
}

type Rule struct {
	ID          string        `yaml:"id" json:"id"`
	Name        string        `yaml:"name" json:"name"`
	Description string        `yaml:"description,omitempty" json:"description,omitempty"`
	Phase       string        `yaml:"phase,omitempty" json:"phase,omitempty"`
	Trigger     RuleTrigger   `yaml:"trigger" json:"trigger"`
	Condition   RuleCondition `yaml:"condition" json:"condition"`
	Action      RuleAction    `yaml:"action" json:"action"`
	Severity    string        `yaml:"severity,omitempty" json:"severity,omitempty"`
	Params      []RuleParam   `yaml:"params,omitempty" json:"params,omitempty"`
}

type RuleTrigger struct {
	Type   string      `yaml:"type" json:"type"`
	Source FlexStrings `yaml:"source" json:"source"`
	Cron   string      `yaml:"cron,omitempty" json:"cron,omitempty"`
}

// FlexStrings accepts both a single string ("A01,A02") and a YAML list [A01, A02].
type FlexStrings []string

func (f *FlexStrings) UnmarshalYAML(unmarshal func(interface{}) error) error {
	var list []string
	if err := unmarshal(&list); err == nil {
		*f = list
		return nil
	}
	var single string
	if err := unmarshal(&single); err != nil {
		return err
	}
	parts := strings.Split(single, ",")
	for i := range parts {
		parts[i] = strings.TrimSpace(parts[i])
	}
	*f = parts
	return nil
}

type RuleCondition struct {
	Entity     string `yaml:"entity" json:"entity"`
	Expression string `yaml:"expression" json:"expression"`
}

type RuleAction struct {
	Type            string `yaml:"type" json:"type"`
	Target          string `yaml:"target" json:"target"`
	Value           string `yaml:"value,omitempty" json:"value,omitempty"`
	Notify          string `yaml:"notify,omitempty" json:"notify,omitempty"`
	MessageTemplate string `yaml:"message_template,omitempty" json:"message_template,omitempty"`
}

type RuleParam struct {
	ID           string `yaml:"id" json:"id"`
	Name         string `yaml:"name" json:"name"`
	Type         string `yaml:"type" json:"type"`
	Default      any    `yaml:"default,omitempty" json:"default,omitempty"`
	Configurable bool   `yaml:"configurable,omitempty" json:"configurable,omitempty"`
	Description  string `yaml:"description,omitempty" json:"description,omitempty"`
}

type Action struct {
	ID             string           `yaml:"id" json:"id"`
	Name           string           `yaml:"name" json:"name"`
	Description    string           `yaml:"description,omitempty" json:"description,omitempty"`
	Phase          string           `yaml:"phase,omitempty" json:"phase,omitempty"`
	Params         []ActionParam    `yaml:"params,omitempty" json:"params,omitempty"`
	Writes         []ActionWrite    `yaml:"writes,omitempty" json:"writes,omitempty"`
	TriggersBefore []string         `yaml:"triggers_before,omitempty" json:"triggers_before,omitempty"`
	TriggersAfter  []string         `yaml:"triggers_after,omitempty" json:"triggers_after,omitempty"`
	Permission     ActionPermission `yaml:"permission,omitempty" json:"permission,omitempty"`
	DecisionLog    bool             `yaml:"decision_log,omitempty" json:"decision_log,omitempty"`
}

type ActionParam struct {
	ID       string `yaml:"id" json:"id"`
	Name     string `yaml:"name" json:"name"`
	Type     string `yaml:"type" json:"type"`
	Required bool   `yaml:"required,omitempty" json:"required,omitempty"`
}

type ActionWrite struct {
	Target     string            `yaml:"target" json:"target"`
	Operation  string            `yaml:"operation" json:"operation"`
	Expression string            `yaml:"expression,omitempty" json:"expression,omitempty"`
	Set        map[string]string `yaml:"set,omitempty" json:"set,omitempty"`
}

type ActionPermission struct {
	Roles  []string `yaml:"roles,omitempty" json:"roles,omitempty"`
	Agents []string `yaml:"agents,omitempty" json:"agents,omitempty"`
}

// Function defines a decision-assistance read-only computation.
// No implementation field — YAML defines semantics only.
type Function struct {
	ID          string           `yaml:"id" json:"id"`
	Name        string           `yaml:"name" json:"name"`
	Description string           `yaml:"description,omitempty" json:"description,omitempty"`
	Phase       string           `yaml:"phase,omitempty" json:"phase,omitempty"`
	Inputs      []FunctionInput  `yaml:"inputs,omitempty" json:"inputs,omitempty"`
	Output      FunctionOutput   `yaml:"output" json:"output"`
}

type FunctionInput struct {
	ID       string `yaml:"id" json:"id"`
	Type     string `yaml:"type" json:"type"`
	Required bool   `yaml:"required,omitempty" json:"required,omitempty"`
	Default  any    `yaml:"default,omitempty" json:"default,omitempty"`
}

type FunctionOutput struct {
	Type   string              `yaml:"type" json:"type"`
	Fields []FunctionOutputField `yaml:"fields,omitempty" json:"fields,omitempty"`
}

type FunctionOutputField struct {
	ID          string `yaml:"id" json:"id"`
	Type        string `yaml:"type" json:"type"`
	Description string `yaml:"description,omitempty" json:"description,omitempty"`
}
