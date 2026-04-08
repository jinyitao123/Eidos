package ontoyaml

import (
	"fmt"
	"regexp"
	"strings"
)

var snakeCaseRe = regexp.MustCompile(`^[a-z][a-z0-9]*(_[a-z0-9]+)*$`)

// ValidationError represents a single validation issue.
type ValidationError struct {
	Type    string `json:"type"`    // "format" or "semantic"
	Message string `json:"message"`
	Path    string `json:"path,omitempty"`
}

// ValidationResult holds the complete validation outcome.
type ValidationResult struct {
	Valid    bool              `json:"valid"`
	Errors   []ValidationError `json:"errors"`
	Warnings []ValidationError `json:"warnings"`
}

// Validate runs format and/or semantic checks on an Ontology.
// checkLevel: "format", "semantic", or "full" (both).
func Validate(o *Ontology, checkLevel string) *ValidationResult {
	r := &ValidationResult{Valid: true}

	if checkLevel == "format" || checkLevel == "full" {
		validateFormat(o, r)
	}
	if checkLevel == "semantic" || checkLevel == "full" {
		validateSemantic(o, r)
	}

	r.Valid = len(r.Errors) == 0
	return r
}

func validateFormat(o *Ontology, r *ValidationResult) {
	classIDs := make(map[string]bool)

	// Check ontology ID
	if !snakeCaseRe.MatchString(o.ID) {
		r.addError("format", fmt.Sprintf("ontology id '%s' is not snake_case", o.ID), "ontology.id")
	}

	// Check classes
	firstCitizenCount := 0
	for i, c := range o.Classes {
		path := fmt.Sprintf("classes[%d]", i)

		if !snakeCaseRe.MatchString(c.ID) {
			r.addError("format", fmt.Sprintf("class id '%s' is not snake_case", c.ID), path+".id")
		}
		if classIDs[c.ID] {
			r.addError("format", fmt.Sprintf("duplicate class id '%s'", c.ID), path+".id")
		}
		classIDs[c.ID] = true

		if c.FirstCitizen {
			firstCitizenCount++
		}

		if !isValidPhase(c.Phase) {
			r.addError("format", fmt.Sprintf("class '%s' has invalid phase '%s'", c.ID, c.Phase), path+".phase")
		}

		attrIDs := make(map[string]bool)
		for j, a := range c.Attributes {
			aPath := fmt.Sprintf("%s.attributes[%d]", path, j)

			if !snakeCaseRe.MatchString(a.ID) {
				r.addError("format", fmt.Sprintf("attribute '%s.%s' is not snake_case", c.ID, a.ID), aPath+".id")
			}
			if attrIDs[a.ID] {
				r.addError("format", fmt.Sprintf("duplicate attribute id '%s' in class '%s'", a.ID, c.ID), aPath+".id")
			}
			attrIDs[a.ID] = true

			if !isValidType(a.Type) {
				r.addError("format", fmt.Sprintf("attribute '%s.%s' has invalid type '%s'", c.ID, a.ID, a.Type), aPath+".type")
			}

			if a.Type == "enum" && len(a.EnumValues) == 0 {
				r.addError("format", fmt.Sprintf("enum attribute '%s.%s' must have enum_values", c.ID, a.ID), aPath+".enum_values")
			}

			if a.Derived != "" && a.Required {
				r.addError("format", fmt.Sprintf("derived attribute '%s.%s' cannot be required", c.ID, a.ID), aPath+".required")
			}
		}
	}

	if firstCitizenCount == 0 {
		r.addWarning("format", "no class has first_citizen=true (recommended: mark exactly one class)", "classes")
	} else if firstCitizenCount > 1 {
		r.addWarning("format", fmt.Sprintf("found %d classes with first_citizen=true, expected exactly 1", firstCitizenCount), "classes")
	}

	// Check relationships
	for i, rel := range o.Relationships {
		path := fmt.Sprintf("relationships[%d]", i)

		if !snakeCaseRe.MatchString(rel.ID) {
			r.addError("format", fmt.Sprintf("relationship id '%s' is not snake_case", rel.ID), path+".id")
		}

		if !classIDs[rel.From] {
			r.addError("format", fmt.Sprintf("relationship '%s' references unknown from class '%s'", rel.ID, rel.From), path+".from")
		}
		if !classIDs[rel.To] {
			r.addError("format", fmt.Sprintf("relationship '%s' references unknown to class '%s'", rel.ID, rel.To), path+".to")
		}

		if !isValidCardinality(rel.Cardinality) {
			r.addError("format", fmt.Sprintf("relationship '%s' has invalid cardinality '%s'", rel.ID, rel.Cardinality), path+".cardinality")
		}
	}

	// Check rules reference valid classes
	for i, rule := range o.Rules {
		path := fmt.Sprintf("rules[%d]", i)
		if rule.Condition.Entity != "" && !classIDs[rule.Condition.Entity] {
			r.addError("format", fmt.Sprintf("rule '%s' references unknown entity '%s'", rule.ID, rule.Condition.Entity), path+".condition.entity")
		}
	}

	// Check metrics
	metricIDs := make(map[string]bool)
	for i, m := range o.Metrics {
		path := fmt.Sprintf("metrics[%d]", i)

		if !snakeCaseRe.MatchString(m.ID) {
			r.addError("format", fmt.Sprintf("metric id '%s' is not snake_case", m.ID), path+".id")
		}
		if metricIDs[m.ID] {
			r.addError("format", fmt.Sprintf("duplicate metric id '%s'", m.ID), path+".id")
		}
		metricIDs[m.ID] = true

		if !isValidMetricKind(m.Kind) {
			r.addError("format", fmt.Sprintf("metric '%s' has invalid kind '%s'", m.ID, m.Kind), path+".kind")
		}

		if !isValidMetricStatus(m.Status) {
			r.addError("format", fmt.Sprintf("metric '%s' has invalid status '%s'", m.ID, m.Status), path+".status")
		}

		if m.Kind == "classification" && len(m.Buckets) == 0 {
			r.addError("format", fmt.Sprintf("classification metric '%s' must have buckets", m.ID), path+".buckets")
		}

		for _, se := range m.SourceEntities {
			if !classIDs[se] {
				r.addError("format", fmt.Sprintf("metric '%s' references unknown source_entity '%s'", m.ID, se), path+".source_entities")
			}
		}
	}

	// Check telemetry
	telemetryIDs := make(map[string]bool)
	for i, t := range o.Telemetry {
		path := fmt.Sprintf("telemetry[%d]", i)

		if !snakeCaseRe.MatchString(t.ID) {
			r.addError("format", fmt.Sprintf("telemetry id '%s' is not snake_case", t.ID), path+".id")
		}
		if telemetryIDs[t.ID] {
			r.addError("format", fmt.Sprintf("duplicate telemetry id '%s'", t.ID), path+".id")
		}
		telemetryIDs[t.ID] = true

		if !classIDs[t.SourceClass] {
			r.addError("format", fmt.Sprintf("telemetry '%s' references unknown source_class '%s'", t.ID, t.SourceClass), path+".source_class")
		}

		if !isValidMetricStatus(t.Status) {
			r.addError("format", fmt.Sprintf("telemetry '%s' has invalid status '%s'", t.ID, t.Status), path+".status")
		}

		if len(t.Aggregations) == 0 {
			r.addError("format", fmt.Sprintf("telemetry '%s' must have at least one aggregation", t.ID), path+".aggregations")
		}

		if t.ContextStrategy == nil {
			r.addError("format", fmt.Sprintf("telemetry '%s' must have context_strategy", t.ID), path+".context_strategy")
		} else {
			cs := t.ContextStrategy
			if cs.DefaultWindow == "" {
				r.addError("format", fmt.Sprintf("telemetry '%s' context_strategy missing default_window", t.ID), path+".context_strategy.default_window")
			}
			if cs.MaxWindow == "" {
				r.addError("format", fmt.Sprintf("telemetry '%s' context_strategy missing max_window", t.ID), path+".context_strategy.max_window")
			}
			if cs.DefaultAggregation == "" {
				r.addError("format", fmt.Sprintf("telemetry '%s' context_strategy missing default_aggregation", t.ID), path+".context_strategy.default_aggregation")
			}
			if cs.DefaultGranularity == "" {
				r.addError("format", fmt.Sprintf("telemetry '%s' context_strategy missing default_granularity", t.ID), path+".context_strategy.default_granularity")
			}
		}
	}

	// Check metric depends_on references
	for i, m := range o.Metrics {
		path := fmt.Sprintf("metrics[%d]", i)
		for j, dep := range m.DependsOn {
			dPath := fmt.Sprintf("%s.depends_on[%d]", path, j)
			switch dep.Type {
			case "metric":
				if !metricIDs[dep.Ref] {
					r.addError("format", fmt.Sprintf("metric '%s' depends_on references unknown metric '%s'", m.ID, dep.Ref), dPath)
				}
			case "attribute":
				parts := strings.SplitN(dep.Ref, ".", 2)
				if len(parts) == 2 && !classIDs[parts[0]] {
					r.addError("format", fmt.Sprintf("metric '%s' depends_on references unknown class '%s'", m.ID, parts[0]), dPath)
				}
			case "telemetry":
				if !telemetryIDs[dep.Ref] {
					r.addError("format", fmt.Sprintf("metric '%s' depends_on references unknown telemetry '%s'", m.ID, dep.Ref), dPath)
				}
			case "rule_param":
				// rule_param references are checked in semantic validation
			default:
				r.addError("format", fmt.Sprintf("metric '%s' depends_on has invalid type '%s'", m.ID, dep.Type), dPath)
			}
		}
	}
}

func validateSemantic(o *Ontology, r *ValidationResult) {
	classMap := make(map[string]*Class)
	for i := range o.Classes {
		classMap[o.Classes[i].ID] = &o.Classes[i]
	}

	// Check first citizen has enough attributes
	for _, c := range o.Classes {
		if c.FirstCitizen && len(c.Attributes) < 10 {
			r.addWarning("semantic",
				fmt.Sprintf("first citizen class '%s' has only %d attributes, recommended >= 10", c.ID, len(c.Attributes)),
				fmt.Sprintf("classes.%s", c.ID))
		}
	}

	// Check for isolated classes (no relationships)
	relatedClasses := make(map[string]bool)
	for _, rel := range o.Relationships {
		relatedClasses[rel.From] = true
		relatedClasses[rel.To] = true
	}
	for _, c := range o.Classes {
		if !relatedClasses[c.ID] {
			r.addWarning("semantic",
				fmt.Sprintf("class '%s' has no relationships (isolated)", c.ID),
				fmt.Sprintf("classes.%s", c.ID))
		}
	}

	// Check action trigger references
	actionIDs := make(map[string]bool)
	for _, a := range o.Actions {
		actionIDs[a.ID] = true
	}
	ruleIDs := make(map[string]bool)
	for _, rule := range o.Rules {
		ruleIDs[rule.ID] = true
	}
	for _, a := range o.Actions {
		for _, rID := range a.TriggersBefore {
			if !ruleIDs[rID] {
				r.addWarning("semantic",
					fmt.Sprintf("action '%s' triggers_before references unknown rule '%s'", a.ID, rID),
					fmt.Sprintf("actions.%s.triggers_before", a.ID))
			}
		}
		for _, rID := range a.TriggersAfter {
			if !ruleIDs[rID] {
				r.addWarning("semantic",
					fmt.Sprintf("action '%s' triggers_after references unknown rule '%s'", a.ID, rID),
					fmt.Sprintf("actions.%s.triggers_after", a.ID))
			}
		}
	}

	// Check rule trigger sources reference valid actions
	for _, rule := range o.Rules {
		if rule.Trigger.Type == "before_action" || rule.Trigger.Type == "after_action" {
			for _, src := range rule.Trigger.Source {
				src = strings.TrimSpace(src)
				if src != "" && !actionIDs[src] {
					r.addWarning("semantic",
						fmt.Sprintf("rule '%s' trigger references unknown action '%s'", rule.ID, src),
						fmt.Sprintf("rules.%s.trigger.source", rule.ID))
				}
			}
		}
	}

	// Check metrics: implemented metrics should have tool
	for _, m := range o.Metrics {
		if m.Status == "implemented" && m.Tool == "" {
			r.addWarning("semantic",
				fmt.Sprintf("metric '%s' is implemented but has no tool", m.ID),
				fmt.Sprintf("metrics.%s.tool", m.ID))
		}
		if m.Status == "undefined" && len(m.KnownIssues) == 0 {
			r.addWarning("semantic",
				fmt.Sprintf("metric '%s' is undefined but has no known_issues explaining why", m.ID),
				fmt.Sprintf("metrics.%s.known_issues", m.ID))
		}
	}

	// Check telemetry: implemented should have tool, alert_threshold should have corresponding rule
	for _, t := range o.Telemetry {
		if t.Status == "implemented" && t.Tool == "" {
			r.addWarning("semantic",
				fmt.Sprintf("telemetry '%s' is implemented but has no tool", t.ID),
				fmt.Sprintf("telemetry.%s.tool", t.ID))
		}
	}

	// P05: graph_sync over-synchronization
	totalAttrs := 0
	syncedAttrs := 0
	for _, c := range o.Classes {
		for _, a := range c.Attributes {
			totalAttrs++
			if a.GraphSync {
				syncedAttrs++
			}
		}
	}
	if totalAttrs > 0 {
		syncPct := float64(syncedAttrs) / float64(totalAttrs) * 100
		if syncPct > 80 {
			r.addWarning("semantic",
				fmt.Sprintf("P05: graph_sync 标记过度：%d/%d (%.0f%%) 属性标记为同步。建议只同步 Agent 查询需要的属性（如数量、状态、关键标记），不同步描述性文字、时间戳等", syncedAttrs, totalAttrs, syncPct),
				"classes.*.attributes.graph_sync")
		}
	}

	// P06: phase diversity check
	phases := make(map[string]bool)
	for _, c := range o.Classes {
		phases[c.Phase] = true
	}
	if len(o.Classes) >= 3 && len(phases) == 1 {
		r.addWarning("semantic",
			fmt.Sprintf("P06: 所有 %d 个类都在同一个 phase (%s)，缺少分期规划。建议将核心类标记 alpha、辅助类标记 beta、扩展类标记 full", len(o.Classes), o.Classes[0].Phase),
			"classes.*.phase")
	}

	// P07: first citizen derived attributes ratio
	for _, c := range o.Classes {
		if c.FirstCitizen && len(c.Attributes) >= 10 {
			derivedCount := 0
			for _, a := range c.Attributes {
				if a.Derived != "" || a.Formula != "" {
					derivedCount++
				}
			}
			pct := float64(derivedCount) / float64(len(c.Attributes)) * 100
			if pct < 15 {
				r.addWarning("semantic",
					fmt.Sprintf("P07: 第一公民 '%s' 派生属性不足：%d/%d (%.0f%%)。建议至少 15%% 的属性为派生计算（如金额、缺口、状态标记等）", c.ID, derivedCount, len(c.Attributes), pct),
					fmt.Sprintf("classes.%s.attributes", c.ID))
			}
		}
	}

	// P08: rule trigger type diversity
	if len(o.Rules) >= 3 {
		triggerCounts := make(map[string]int)
		for _, rule := range o.Rules {
			triggerCounts[rule.Trigger.Type]++
		}
		for trigType, count := range triggerCounts {
			pct := float64(count) / float64(len(o.Rules)) * 100
			if pct > 70 {
				r.addWarning("semantic",
					fmt.Sprintf("P08: %.0f%% 的规则使用 '%s' 触发，类型过于单一。建议区分事件驱动 (on_change/after_action) 和定时 (cron) 场景", pct, trigType),
					"rules.*.trigger")
			}
		}
	}
}

func (r *ValidationResult) addError(typ, msg, path string) {
	r.Errors = append(r.Errors, ValidationError{Type: typ, Message: msg, Path: path})
}

func (r *ValidationResult) addWarning(typ, msg, path string) {
	r.Warnings = append(r.Warnings, ValidationError{Type: typ, Message: msg, Path: path})
}

func isValidPhase(p string) bool {
	return p == "alpha" || p == "beta" || p == "full"
}

func isValidType(t string) bool {
	switch t {
	case "integer", "decimal", "string", "text", "boolean", "date", "datetime", "enum":
		return true
	}
	return false
}

func isValidCardinality(c string) bool {
	switch c {
	case "one_to_one", "one_to_many", "many_to_one", "many_to_many":
		return true
	}
	return false
}

func isValidMetricKind(k string) bool {
	return k == "aggregate" || k == "composite" || k == "classification"
}

func isValidMetricStatus(s string) bool {
	return s == "implemented" || s == "designed" || s == "undefined"
}
