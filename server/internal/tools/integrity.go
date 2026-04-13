package tools

import (
	"fmt"
	"regexp"
	"strings"

	ontoyaml "ontologyserver/internal/yaml"
)

var gbtStandardRe = regexp.MustCompile(`GB/T\s*(\d+)(?:-(\d{4}))?`)

// GuardResult represents the outcome of an integrity guard check.
type GuardResult struct {
	Blocked bool
	Message string // Actionable error message for Agent self-healing
}

func guardPass() GuardResult {
	return GuardResult{Blocked: false}
}

func guardBlock(msg string) GuardResult {
	return GuardResult{Blocked: true, Message: msg}
}

// RunOntologyGuards runs all integrity guards on a parsed ontology.
// Guards are hard constraints — they BLOCK the save operation and return
// an actionable error message that guides the Agent to self-correct.
// This is Layer 3 (Backend Hard Guard) from the integrity engineering model.
// RunOntologyGuardsWithRaw runs guards that need the raw YAML text
// (e.g., fabricated standard detection scans the full text).
func RunOntologyGuardsWithRaw(o *ontoyaml.Ontology, rawYAML string) GuardResult {
	r := RunOntologyGuards(o)
	if r.Blocked {
		return r
	}
	// Scan raw YAML for fabricated standards (catches extra fields not in struct)
	for _, match := range gbtStandardRe.FindAllStringSubmatch(rawYAML, -1) {
		num := match[1]
		year := match[2]
		if len(num) >= 4 {
			allSame := true
			for i := 1; i < len(num); i++ {
				if num[i] != num[0] {
					allSame = false
					break
				}
			}
			if allSame {
				return guardBlock(fmt.Sprintf(
					"YAML 包含疑似编造的标准号 'GB/T %s' — "+
						"重复数字编号通常是伪造的。请引用真实标准或删除该引用",
					num))
			}
		}
		if year != "" && len(year) == 4 && year > "2026" {
			return guardBlock(fmt.Sprintf(
				"YAML 引用了未来年份的标准 'GB/T %s-%s' — "+
					"标准号年份不应超过当前年份。请核实或删除",
				num, year))
		}
	}
	return guardPass()
}

func RunOntologyGuards(o *ontoyaml.Ontology) GuardResult {
	guards := []func(*ontoyaml.Ontology) GuardResult{
		// Structure guards (catch Agent using wrong field names / missing required fields)
		guardNoDuplicateMetricIDs,
		guardMetricRequiredFields,
		guardTelemetryRequiredFields,
		// Semantic guards (catch logical errors in well-formed YAML)
		guardImplementedMetricHasFormula,
		guardClassificationHasBuckets,
		guardMetricSourceEntitiesExist,
		guardNoPhantomDependencies,
		guardTelemetrySourceClassExists,
		guardTelemetryHasContextStrategy,
		guardNoFabricatedStandards,
		guardDerivedFormulaRefsExist,
	}

	for _, g := range guards {
		if r := g(o); r.Blocked {
			return r
		}
	}
	return guardPass()
}

// Guard: No duplicate metric IDs.
// R4 (AI startup CTO) copy-pasted metrics with the same ID. Downstream pipeline
// generates one tool per metric ID — duplicates cause silent overwrites.
func guardNoDuplicateMetricIDs(o *ontoyaml.Ontology) GuardResult {
	seen := make(map[string]bool, len(o.Metrics))
	for _, m := range o.Metrics {
		if seen[m.ID] {
			return guardBlock(fmt.Sprintf(
				"存在重复的指标 ID '%s' — "+
					"每个指标的 id 必须唯一。请重命名其中一个（如 %s_v2）",
				m.ID, m.ID))
		}
		seen[m.ID] = true
	}
	return guardPass()
}

// Guard 0a: Every metric MUST have kind, status, and source_entities.
// S2 (DeepSeek) was observed producing metrics with completely wrong field names
// (e.g., "refresh_frequency" instead of "status", missing "kind" and "source_entities").
// Without these fields, the pipeline cannot generate MCP tools.
func guardMetricRequiredFields(o *ontoyaml.Ontology) GuardResult {
	validKinds := map[string]bool{"aggregate": true, "composite": true, "classification": true}
	validStatuses := map[string]bool{"implemented": true, "designed": true, "undefined": true}

	for _, m := range o.Metrics {
		if m.Kind == "" || !validKinds[m.Kind] {
			return guardBlock(fmt.Sprintf(
				"指标 '%s' (%s) 缺少 kind 字段或值无效 — "+
					"必须为 aggregate（聚合）、composite（复合）或 classification（分类）之一。"+
					"请在该指标下添加 kind 字段",
				m.Name, m.ID))
		}
		if m.Status == "" || !validStatuses[m.Status] {
			return guardBlock(fmt.Sprintf(
				"指标 '%s' (%s) 缺少 status 字段或值无效 — "+
					"必须为 implemented（已实现）、designed（已设计）或 undefined（未定义）之一。"+
					"请在该指标下添加 status 字段",
				m.Name, m.ID))
		}
		if len(m.SourceEntities) == 0 {
			return guardBlock(fmt.Sprintf(
				"指标 '%s' (%s) 缺少 source_entities 字段 — "+
					"必须指定该指标的数据来源类（如 source_entities: [inventory_position]）。"+
					"当前可用的类: [%s]",
				m.Name, m.ID, strings.Join(classIDList(o), ", ")))
		}
	}
	return guardPass()
}

// Guard 0b: Every telemetry MUST have source_class, value_type, sampling, aggregations.
// S2 was observed using wrong field names (e.g., "source" instead of "source_class",
// "aggregation" instead of "aggregations", "interval" instead of "sampling").
func guardTelemetryRequiredFields(o *ontoyaml.Ontology) GuardResult {
	validValueTypes := map[string]bool{"decimal": true, "integer": true, "boolean": true, "string": true}
	validStatuses := map[string]bool{"implemented": true, "designed": true, "undefined": true}

	for _, t := range o.Telemetry {
		if t.Status == "" || !validStatuses[t.Status] {
			return guardBlock(fmt.Sprintf(
				"遥测 '%s' (%s) 缺少 status 字段或值无效 — "+
					"必须为 implemented（已实现）、designed（已设计）或 undefined（未定义）之一",
				t.Name, t.ID))
		}
		if t.SourceClass == "" {
			return guardBlock(fmt.Sprintf(
				"遥测 '%s' (%s) 缺少 source_class 字段 — "+
					"必须指定数据来源类（如 source_class: equipment）。"+
					"注意：字段名是 source_class 不是 source。"+
					"当前可用的类: [%s]",
				t.Name, t.ID, strings.Join(classIDList(o), ", ")))
		}
		if t.ValueType == "" || !validValueTypes[t.ValueType] {
			return guardBlock(fmt.Sprintf(
				"遥测 '%s' (%s) 缺少 value_type 字段或值无效 — "+
					"必须为 decimal、integer、boolean 或 string 之一",
				t.Name, t.ID))
		}
		if t.Sampling == "" {
			return guardBlock(fmt.Sprintf(
				"遥测 '%s' (%s) 缺少 sampling 字段 — "+
					"必须指定采样频率（如 sampling: 1min）。"+
					"注意：字段名是 sampling 不是 interval",
				t.Name, t.ID))
		}
		if len(t.Aggregations) == 0 {
			return guardBlock(fmt.Sprintf(
				"遥测 '%s' (%s) 缺少 aggregations 字段 — "+
					"必须指定聚合方式列表（如 aggregations: [avg, max, min]）。"+
					"注意：字段名是 aggregations（复数）不是 aggregation",
				t.Name, t.ID))
		}
	}
	return guardPass()
}

// Guard 1: An "implemented" metric MUST have a formula.
// Without formula, the generated MCP tool has no computation logic.
func guardImplementedMetricHasFormula(o *ontoyaml.Ontology) GuardResult {
	for _, m := range o.Metrics {
		if m.Status == "implemented" && strings.TrimSpace(m.Formula) == "" {
			return guardBlock(fmt.Sprintf(
				"指标 '%s' (%s) 状态为 implemented 但缺少计算公式 — "+
					"请填写 formula 字段描述计算逻辑（如 SUM(inventory_value) / COUNT(*)），"+
					"或将 status 改为 designed",
				m.Name, m.ID))
		}
	}
	return guardPass()
}

// Guard 2: A "classification" metric MUST have non-empty buckets.
// Classification without buckets produces a tool that can't classify anything.
func guardClassificationHasBuckets(o *ontoyaml.Ontology) GuardResult {
	for _, m := range o.Metrics {
		if m.Kind == "classification" && len(m.Buckets) == 0 {
			return guardBlock(fmt.Sprintf(
				"分类指标 '%s' (%s) 缺少分类桶定义 — "+
					"classification 类型必须定义 buckets 数组，每个桶需要 id、name、condition 三个字段。"+
					"示例: {id: high, name: 快速消耗, condition: \"monthly_consumption > 100\"}",
				m.Name, m.ID))
		}
	}
	return guardPass()
}

// Guard 3: Metric source_entities must reference classes that actually exist.
// Phantom source_entities produce tools that query non-existent data.
func guardMetricSourceEntitiesExist(o *ontoyaml.Ontology) GuardResult {
	classIDs := make(map[string]bool, len(o.Classes))
	for _, c := range o.Classes {
		classIDs[c.ID] = true
	}
	for _, m := range o.Metrics {
		for _, se := range m.SourceEntities {
			if !classIDs[se] {
				available := classIDList(o)
				return guardBlock(fmt.Sprintf(
					"指标 '%s' 的 source_entities 引用了不存在的类 '%s' — "+
						"当前可用的类: [%s]。请检查拼写或先在 classes 中定义该类",
					m.ID, se, strings.Join(available, ", ")))
			}
		}
	}
	return guardPass()
}

// Guard 4: depends_on references must point to existing metrics/telemetry/classes.
// Phantom dependencies mean the metric's computation graph is broken.
func guardNoPhantomDependencies(o *ontoyaml.Ontology) GuardResult {
	classIDs := make(map[string]bool, len(o.Classes))
	for _, c := range o.Classes {
		classIDs[c.ID] = true
	}
	metricIDs := make(map[string]bool, len(o.Metrics))
	for _, m := range o.Metrics {
		metricIDs[m.ID] = true
	}
	telemetryIDs := make(map[string]bool, len(o.Telemetry))
	for _, t := range o.Telemetry {
		telemetryIDs[t.ID] = true
	}

	for _, m := range o.Metrics {
		for _, dep := range m.DependsOn {
			switch dep.Type {
			case "metric":
				if dep.Ref == m.ID {
					return guardBlock(fmt.Sprintf(
						"指标 '%s' 的 depends_on 引用了自身 — "+
							"指标不能依赖自己，这会导致循环计算。请移除该自引用",
						m.ID))
				}
				if !metricIDs[dep.Ref] {
					return guardBlock(fmt.Sprintf(
						"指标 '%s' 的 depends_on 引用了不存在的指标 '%s' — "+
							"请确认指标 ID 拼写正确，或先在 metrics 中定义该指标后再引用",
						m.ID, dep.Ref))
				}
			case "telemetry":
				if !telemetryIDs[dep.Ref] {
					return guardBlock(fmt.Sprintf(
						"指标 '%s' 的 depends_on 引用了不存在的遥测 '%s' — "+
							"请确认遥测 ID 拼写正确，或先在 telemetry 中定义后再引用",
						m.ID, dep.Ref))
				}
			case "attribute":
				parts := strings.SplitN(dep.Ref, ".", 2)
				if len(parts) == 2 && !classIDs[parts[0]] {
					return guardBlock(fmt.Sprintf(
						"指标 '%s' 的 depends_on 引用了不存在的类 '%s'（来自 %s）— "+
							"请确认类 ID 拼写正确",
						m.ID, parts[0], dep.Ref))
				}
			}
		}
	}
	return guardPass()
}

// Guard: Telemetry source_class must reference an existing class.
// R4 (AI startup CTO) used "api_endpoints" but the class was never defined.
// Guard 0b only checks source_class is non-empty; this guard checks it exists.
func guardTelemetrySourceClassExists(o *ontoyaml.Ontology) GuardResult {
	classIDs := make(map[string]bool, len(o.Classes))
	for _, c := range o.Classes {
		classIDs[c.ID] = true
	}
	for _, t := range o.Telemetry {
		if t.SourceClass != "" && !classIDs[t.SourceClass] {
			return guardBlock(fmt.Sprintf(
				"遥测 '%s' (%s) 的 source_class '%s' 引用了不存在的类 — "+
					"当前可用的类: [%s]。请检查拼写或先在 classes 中定义该类",
				t.Name, t.ID, t.SourceClass, strings.Join(classIDList(o), ", ")))
		}
	}
	return guardPass()
}

// Guard 5: Every telemetry stream MUST have a valid context_strategy.
// Without it, Agent queries could pull unbounded time-series data and
// explode the context window.
// R5 (government regulator) wrote context_strategy as a plain string
// ("use 1h window with avg") — Go yaml.v3 allocates an empty struct
// (non-nil pointer with empty fields), so we must check field content,
// not just nil.
func guardTelemetryHasContextStrategy(o *ontoyaml.Ontology) GuardResult {
	for _, t := range o.Telemetry {
		cs := t.ContextStrategy
		if cs == nil || cs.DefaultWindow == "" || cs.DefaultAggregation == "" {
			return guardBlock(fmt.Sprintf(
				"遥测 '%s' (%s) 缺少 context_strategy 或字段不完整 — "+
					"必须是一个对象（不是字符串），包含 default_window、max_window、default_aggregation、default_granularity 四个字段。"+
					"注意：不能写成 context_strategy: \"use 1h window\"，必须写成嵌套对象。"+
					"示例:\n  context_strategy:\n    default_window: 1h\n    max_window: 24h\n    default_aggregation: avg\n    default_granularity: 5min",
				t.Name, t.ID))
		}
	}
	return guardPass()
}

// Guard: No fabricated standard references (e.g., GB/T 99999-2030).
// Adversarial Round 1 persona "急性子 CTO" injected GB/T 99999-2030 —
// repeating digits and future years are strong signals of fabrication.
func guardNoFabricatedStandards(o *ontoyaml.Ontology) GuardResult {
	// Scan all metric and telemetry fields serialized as text
	checkText := func(text, location string) GuardResult {
		for _, match := range gbtStandardRe.FindAllStringSubmatch(text, -1) {
			num := match[1]
			year := match[2]
			// Repeating digits: 99999, 88888, etc.
			if len(num) >= 4 {
				allSame := true
				for i := 1; i < len(num); i++ {
					if num[i] != num[0] {
						allSame = false
						break
					}
				}
				if allSame {
					return guardBlock(fmt.Sprintf(
						"%s 包含疑似编造的标准号 'GB/T %s' — "+
							"重复数字编号通常是伪造的。请引用真实标准或删除该字段",
						location, num))
				}
			}
			// Future year: > 2026
			if year != "" && len(year) == 4 && year > "2026" {
				return guardBlock(fmt.Sprintf(
					"%s 引用了未来年份的标准 'GB/T %s-%s' — "+
						"标准号年份不应超过当前年份。请核实标准号或删除该字段",
					location, num, year))
			}
		}
		return guardPass()
	}

	for _, m := range o.Metrics {
		text := m.Formula + " " + m.Description + " " + m.Tool
		if r := checkText(text, fmt.Sprintf("指标 '%s' (%s)", m.Name, m.ID)); r.Blocked {
			return r
		}
	}
	for _, t := range o.Telemetry {
		text := t.ReferenceStandard + " " + t.Description
		if r := checkText(text, fmt.Sprintf("遥测 '%s' (%s)", t.Name, t.ID)); r.Blocked {
			return r
		}
	}
	return guardPass()
}

// Guard: Derived attribute formulas must reference attributes that exist in the same class.
// S2 (DeepSeek) was observed producing formulas like "SUM(energy_readings.today)"
// where "today" doesn't exist as an attribute. This guard catches simple references
// by scanning the formula for attribute IDs from the same class.
func guardDerivedFormulaRefsExist(o *ontoyaml.Ontology) GuardResult {
	for _, c := range o.Classes {
		attrIDs := make(map[string]bool, len(c.Attributes))
		for _, a := range c.Attributes {
			attrIDs[a.ID] = true
		}
		for _, a := range c.Attributes {
			formula := a.Derived
			if formula == "" {
				formula = a.Formula
			}
			if formula == "" {
				continue
			}
			// Extract identifiers from formula: words that look like attribute references
			// Simple heuristic: split on non-alphanumeric/underscore, check against attrIDs
			for _, token := range regexp.MustCompile(`[a-z_][a-z0-9_]*`).FindAllString(formula, -1) {
				// Skip common formula keywords
				if isFormulaKeyword(token) {
					continue
				}
				// If a token looks like an attribute but doesn't exist, warn
				// Only flag tokens that are >= 3 chars and snake_case (to avoid false positives)
				if len(token) >= 3 && !attrIDs[token] {
					// Check if it's a cross-class ref like "other_class.attr" — skip those
					// Only flag plain attribute refs in the same class
					if !strings.Contains(formula, "."+token) && !strings.Contains(formula, token+".") {
						// Check if it matches any attribute in ANY class
						foundElsewhere := false
						for _, c2 := range o.Classes {
							for _, a2 := range c2.Attributes {
								if a2.ID == token {
									foundElsewhere = true
									break
								}
							}
						}
						if !foundElsewhere {
							return guardBlock(fmt.Sprintf(
								"类 '%s' 的派生属性 '%s' 的公式引用了不存在的属性 '%s' — "+
									"公式: %s。请检查属性名拼写，当前类可用属性: [%s]",
								c.ID, a.ID, token, formula,
								strings.Join(attrIDList(c.Attributes), ", ")))
						}
					}
				}
			}
		}
	}
	return guardPass()
}

func isFormulaKeyword(s string) bool {
	keywords := map[string]bool{
		"sum": true, "avg": true, "count": true, "max": true, "min": true,
		"abs": true, "round": true, "ceil": true, "floor": true,
		"now": true, "today": true, "datediff": true, "dateadd": true,
		"days": true, "hours": true, "minutes": true, "seconds": true,
		"true": true, "false": true, "null": true, "and": true, "or": true, "not": true,
		"where": true, "between": true, "like": true, "case": true, "when": true, "then": true, "else": true, "end": true,
		"analyze_trend": true, "calculate_anomaly_score": true, "calculate_saving_potential": true,
	}
	return keywords[strings.ToLower(s)]
}

func attrIDList(attrs []ontoyaml.Attribute) []string {
	ids := make([]string, len(attrs))
	for i, a := range attrs {
		ids[i] = a.ID
	}
	return ids
}

func classIDList(o *ontoyaml.Ontology) []string {
	ids := make([]string, len(o.Classes))
	for i, c := range o.Classes {
		ids[i] = c.ID
	}
	return ids
}

// guardClassesInScene checks that all classes in the ontology have a basis
// in the scene_analysis. Classes whose names don't appear anywhere in the
// scene text are flagged as potentially fabricated (H7 hallucination).
func guardClassesInScene(o *ontoyaml.Ontology, sceneContent string) GuardResult {
	sceneLower := strings.ToLower(sceneContent)
	var invented []string
	for _, c := range o.Classes {
		// Check if class name or ID appears in scene analysis
		nameLower := strings.ToLower(c.Name)
		idLower := strings.ToLower(c.ID)
		// Also check without underscores (e.g., "pesticide_spray" → "pesticide spray")
		idWords := strings.ReplaceAll(idLower, "_", " ")

		if !strings.Contains(sceneLower, nameLower) &&
			!strings.Contains(sceneLower, idLower) &&
			!strings.Contains(sceneLower, idWords) {
			invented = append(invented, fmt.Sprintf("%s (%s)", c.Name, c.ID))
		}
	}
	if len(invented) > 0 {
		return guardBlock(fmt.Sprintf(
			"以下类在场景分析中未找到对应描述，可能是编造的: %s — "+
				"请确认这些类在业务调研中有明确依据，或将其从本体中移除。"+
				"本体的类必须来自场景分析，不能凭空编造",
			strings.Join(invented, ", ")))
	}
	return guardPass()
}
