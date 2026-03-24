package tools

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"ontologyserver/internal/mcp"
	ontoyaml "ontologyserver/internal/yaml"

	"gopkg.in/yaml.v3"
)

func registerValidateRuleReferences(router *mcp.Router, d *Deps) {
	router.Register(mcp.ToolDef{
		Name:        "validate_rule_references",
		Description: "检查规则条件和动作写回中引用的类、属性、关系是否存在于当前本体定义中。",
		InputSchema: mcp.Schema(map[string]any{
			"project_id": mcp.Prop("string", "本体项目ID"),
			"rules_yaml": mcp.Prop("string", "待验证的 rules+actions YAML 片段"),
		}, []string{"project_id", "rules_yaml"}),
	}, func(ctx context.Context, args json.RawMessage) *mcp.ToolCallResult {
		var p struct {
			ProjectID string `json:"project_id"`
			RulesYAML string `json:"rules_yaml"`
		}
		if err := json.Unmarshal(args, &p); err != nil {
			return mcp.ErrorResult("invalid arguments: " + err.Error())
		}

		// Read the ontology structure from S2's output
		var structureYAML string
		err := d.PG.QueryRow(ctx,
			`SELECT content FROM ontology.stage_outputs
			 WHERE project_id = $1 AND stage = 'ontology_structure'
			 ORDER BY created_at DESC LIMIT 1`,
			p.ProjectID,
		).Scan(&structureYAML)
		if err != nil {
			return mcp.ErrorResult("ontology structure not found: " + err.Error())
		}

		// Parse structure to build reference index
		var structDoc ontoyaml.OntologyDoc
		if err := yaml.Unmarshal([]byte(structureYAML), &structDoc); err != nil {
			return mcp.ErrorResult("failed to parse ontology structure: " + err.Error())
		}

		classMap := make(map[string]map[string]bool) // classID -> set of attrIDs
		for _, c := range structDoc.Ontology.Classes {
			attrs := make(map[string]bool)
			for _, a := range c.Attributes {
				attrs[a.ID] = true
			}
			classMap[c.ID] = attrs
		}

		relMap := make(map[string]bool)
		for _, r := range structDoc.Ontology.Relationships {
			relMap[r.ID] = true
		}

		// Parse the rules YAML
		var rulesDoc struct {
			Rules   []ontoyaml.Rule   `yaml:"rules"`
			Actions []ontoyaml.Action `yaml:"actions"`
		}
		if err := yaml.Unmarshal([]byte(p.RulesYAML), &rulesDoc); err != nil {
			return mcp.ErrorResult("failed to parse rules YAML: " + err.Error())
		}

		var invalidRefs []map[string]string

		// Validate rule conditions
		for _, rule := range rulesDoc.Rules {
			if rule.Condition.Entity != "" {
				if _, ok := classMap[rule.Condition.Entity]; !ok {
					invalidRefs = append(invalidRefs, map[string]string{
						"location":   fmt.Sprintf("%s.condition.entity", rule.ID),
						"reference":  rule.Condition.Entity,
						"suggestion": "class not found in ontology structure",
					})
				}
			}

			// Check action target references
			if rule.Action.Type == "update_attribute" && strings.Contains(rule.Action.Target, ".") {
				parts := strings.SplitN(rule.Action.Target, ".", 2)
				if attrs, ok := classMap[parts[0]]; ok {
					if !attrs[parts[1]] {
						invalidRefs = append(invalidRefs, map[string]string{
							"location":   fmt.Sprintf("%s.action.target", rule.ID),
							"reference":  rule.Action.Target,
							"suggestion": fmt.Sprintf("attribute '%s' not found in class '%s'", parts[1], parts[0]),
						})
					}
				} else {
					invalidRefs = append(invalidRefs, map[string]string{
						"location":   fmt.Sprintf("%s.action.target", rule.ID),
						"reference":  parts[0],
						"suggestion": "class not found",
					})
				}
			}
		}

		// Validate action writes
		for _, action := range rulesDoc.Actions {
			for _, w := range action.Writes {
				if w.Operation == "update" && strings.Contains(w.Target, ".") {
					parts := strings.SplitN(w.Target, ".", 2)
					if attrs, ok := classMap[parts[0]]; ok {
						if !attrs[parts[1]] {
							invalidRefs = append(invalidRefs, map[string]string{
								"location":   fmt.Sprintf("%s.writes.%s", action.ID, w.Target),
								"reference":  w.Target,
								"suggestion": fmt.Sprintf("attribute '%s' not found in class '%s'", parts[1], parts[0]),
							})
						}
					}
				} else if w.Operation == "create" {
					if _, ok := classMap[w.Target]; !ok {
						invalidRefs = append(invalidRefs, map[string]string{
							"location":   fmt.Sprintf("%s.writes.%s", action.ID, w.Target),
							"reference":  w.Target,
							"suggestion": "target class not found",
						})
					}
				}
			}
		}

		return mcp.TextResult(map[string]any{
			"valid":              len(invalidRefs) == 0,
			"invalid_references": invalidRefs,
		})
	})
}
