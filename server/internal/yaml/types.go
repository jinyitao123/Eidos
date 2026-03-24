package ontoyaml

// Ontology is the top-level structure of an ontology YAML document.
type Ontology struct {
	Name             string            `yaml:"name" json:"name"`
	ID               string            `yaml:"id" json:"id"`
	Version          string            `yaml:"version" json:"version"`
	Description      string            `yaml:"description" json:"description"`
	SceneAnalysisRef string            `yaml:"scene_analysis_ref,omitempty" json:"scene_analysis_ref,omitempty"`
	Classes          []Class           `yaml:"classes" json:"classes"`
	Relationships    []Relationship    `yaml:"relationships" json:"relationships"`
	Rules            []Rule            `yaml:"rules,omitempty" json:"rules,omitempty"`
	Actions          []Action          `yaml:"actions,omitempty" json:"actions,omitempty"`
	Functions        []Function        `yaml:"functions,omitempty" json:"functions,omitempty"`
	Interfaces       []Interface       `yaml:"interfaces,omitempty" json:"interfaces,omitempty"`
	Security         *Security         `yaml:"security,omitempty" json:"security,omitempty"`
	GraphConfig      *GraphConfig      `yaml:"graph_config,omitempty" json:"graph_config,omitempty"`
	ConnectorHints   []ConnectorHint   `yaml:"connector_hints,omitempty" json:"connector_hints,omitempty"`
}

// OntologyDoc wraps the top-level "ontology:" key in the YAML file.
type OntologyDoc struct {
	Ontology Ontology `yaml:"ontology" json:"ontology"`
}

// Class represents a data entity in the ontology.
type Class struct {
	ID           string      `yaml:"id" json:"id"`
	Name         string      `yaml:"name" json:"name"`
	Description  string      `yaml:"description,omitempty" json:"description,omitempty"`
	FirstCitizen bool        `yaml:"first_citizen,omitempty" json:"first_citizen,omitempty"`
	Phase        string      `yaml:"phase" json:"phase"`
	ImportedFrom string      `yaml:"imported_from,omitempty" json:"imported_from,omitempty"`
	Attributes   []Attribute `yaml:"attributes" json:"attributes"`
}

// Attribute represents a single field within a class.
type Attribute struct {
	ID           string   `yaml:"id" json:"id"`
	Name         string   `yaml:"name" json:"name"`
	Type         string   `yaml:"type" json:"type"`
	Required     bool     `yaml:"required,omitempty" json:"required,omitempty"`
	Unique       bool     `yaml:"unique,omitempty" json:"unique,omitempty"`
	Default      any      `yaml:"default,omitempty" json:"default,omitempty"`
	Derived      string   `yaml:"derived,omitempty" json:"derived,omitempty"`
	GraphSync    bool     `yaml:"graph_sync,omitempty" json:"graph_sync,omitempty"`
	Configurable bool     `yaml:"configurable,omitempty" json:"configurable,omitempty"`
	EnumValues   []string `yaml:"enum_values,omitempty" json:"enum_values,omitempty"`
	Unit         string   `yaml:"unit,omitempty" json:"unit,omitempty"`
	Phase        string   `yaml:"phase,omitempty" json:"phase,omitempty"`
	Description  string   `yaml:"description,omitempty" json:"description,omitempty"`
}

// Relationship connects two classes.
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

// EdgeAttribute is a data field on a relationship edge.
type EdgeAttribute struct {
	ID          string   `yaml:"id" json:"id"`
	Name        string   `yaml:"name" json:"name"`
	Type        string   `yaml:"type" json:"type"`
	Description string   `yaml:"description,omitempty" json:"description,omitempty"`
	EnumValues  []string `yaml:"enum_values,omitempty" json:"enum_values,omitempty"`
}

// Rule defines a business rule with trigger, condition, and action.
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
	Type   string   `yaml:"type" json:"type"`
	Source []string `yaml:"source,omitempty" json:"source,omitempty"`
	Cron   string   `yaml:"cron,omitempty" json:"cron,omitempty"`
}

type RuleCondition struct {
	Entity     string `yaml:"entity" json:"entity"`
	Expression string `yaml:"expression" json:"expression"`
}

type RuleAction struct {
	Type            string `yaml:"type" json:"type"`
	Target          string `yaml:"target,omitempty" json:"target,omitempty"`
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
}

// Action defines a user-initiated operation.
type Action struct {
	ID             string          `yaml:"id" json:"id"`
	Name           string          `yaml:"name" json:"name"`
	Description    string          `yaml:"description,omitempty" json:"description,omitempty"`
	Phase          string          `yaml:"phase,omitempty" json:"phase,omitempty"`
	Params         []ActionParam   `yaml:"params,omitempty" json:"params,omitempty"`
	Writes         []ActionWrite   `yaml:"writes,omitempty" json:"writes,omitempty"`
	TriggersBefore []string        `yaml:"triggers_before,omitempty" json:"triggers_before,omitempty"`
	TriggersAfter  []string        `yaml:"triggers_after,omitempty" json:"triggers_after,omitempty"`
	Permission     ActionPermission `yaml:"permission,omitempty" json:"permission,omitempty"`
	DecisionLog    bool            `yaml:"decision_log,omitempty" json:"decision_log,omitempty"`
}

type ActionParam struct {
	ID       string `yaml:"id" json:"id"`
	Name     string `yaml:"name" json:"name"`
	Type     string `yaml:"type" json:"type"`
	Required bool   `yaml:"required,omitempty" json:"required,omitempty"`
}

type ActionWrite struct {
	Target     string            `yaml:"target" json:"target"`
	Operation  string            `yaml:"operation,omitempty" json:"operation,omitempty"`
	Expression string            `yaml:"expression,omitempty" json:"expression,omitempty"`
	Set        map[string]string `yaml:"set,omitempty" json:"set,omitempty"`
}

type ActionPermission struct {
	Roles  []string `yaml:"roles,omitempty" json:"roles,omitempty"`
	Agents []string `yaml:"agents,omitempty" json:"agents,omitempty"`
}

// Function defines a read-only computation.
type Function struct {
	ID             string         `yaml:"id" json:"id"`
	Name           string         `yaml:"name" json:"name"`
	Description    string         `yaml:"description,omitempty" json:"description,omitempty"`
	Phase          string         `yaml:"phase,omitempty" json:"phase,omitempty"`
	Inputs         []FunctionInput  `yaml:"inputs,omitempty" json:"inputs,omitempty"`
	Output         FunctionOutput `yaml:"output" json:"output"`
	Implementation string         `yaml:"implementation" json:"implementation"`
	Body           string         `yaml:"body,omitempty" json:"body,omitempty"`
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

// Interface defines a cross-class capability contract (beta).
type Interface struct {
	ID            string             `yaml:"id" json:"id"`
	Name          string             `yaml:"name" json:"name"`
	Description   string             `yaml:"description,omitempty" json:"description,omitempty"`
	Phase         string             `yaml:"phase,omitempty" json:"phase,omitempty"`
	Attributes    []InterfaceAttr    `yaml:"attributes,omitempty" json:"attributes,omitempty"`
	Actions       []InterfaceAction  `yaml:"actions,omitempty" json:"actions,omitempty"`
	ImplementedBy []string           `yaml:"implemented_by,omitempty" json:"implemented_by,omitempty"`
}

type InterfaceAttr struct {
	ID   string `yaml:"id" json:"id"`
	Name string `yaml:"name" json:"name"`
	Type string `yaml:"type" json:"type"`
}

type InterfaceAction struct {
	ActionID string `yaml:"action_id" json:"action_id"`
}

// Security defines permission policies (beta).
type Security struct {
	ObjectLevel    []ObjectLevelSec    `yaml:"object_level,omitempty" json:"object_level,omitempty"`
	AttributeLevel []AttributeLevelSec `yaml:"attribute_level,omitempty" json:"attribute_level,omitempty"`
	ActionLevel    []ActionLevelSec    `yaml:"action_level,omitempty" json:"action_level,omitempty"`
}

type ObjectLevelSec struct {
	Class       string `yaml:"class" json:"class"`
	Rule        string `yaml:"rule" json:"rule"`
	Description string `yaml:"description,omitempty" json:"description,omitempty"`
}

type AttributeLevelSec struct {
	Class       string   `yaml:"class" json:"class"`
	Attribute   string   `yaml:"attribute" json:"attribute"`
	VisibleTo   []string `yaml:"visible_to" json:"visible_to"`
	Description string   `yaml:"description,omitempty" json:"description,omitempty"`
}

type ActionLevelSec struct {
	Action       string           `yaml:"action" json:"action"`
	ExecutableBy ActionPermission `yaml:"executable_by" json:"executable_by"`
}

// GraphConfig controls Neo4j synchronization behavior.
type GraphConfig struct {
	ArchiveEventsAfterDays int              `yaml:"archive_events_after_days,omitempty" json:"archive_events_after_days,omitempty"`
	StructureSync          string           `yaml:"structure_sync,omitempty" json:"structure_sync,omitempty"`
	StatusSync             *StatusSyncConfig `yaml:"status_sync,omitempty" json:"status_sync,omitempty"`
	EventSync              string           `yaml:"event_sync,omitempty" json:"event_sync,omitempty"`
	NodesNotInGraph        []string         `yaml:"nodes_not_in_graph,omitempty" json:"nodes_not_in_graph,omitempty"`
}

type StatusSyncConfig struct {
	Primary   string `yaml:"primary,omitempty" json:"primary,omitempty"`
	Secondary string `yaml:"secondary,omitempty" json:"secondary,omitempty"`
}

// ConnectorHint provides source-system field mapping hints.
type ConnectorHint struct {
	ClassID    string                   `yaml:"class_id" json:"class_id"`
	Attributes []ConnectorHintAttribute `yaml:"attributes,omitempty" json:"attributes,omitempty"`
}

type ConnectorHintAttribute struct {
	AttributeID   string `yaml:"attribute_id" json:"attribute_id"`
	SourceHint    string `yaml:"source_hint,omitempty" json:"source_hint,omitempty"`
	MappingStatus string `yaml:"mapping_status,omitempty" json:"mapping_status,omitempty"`
}
