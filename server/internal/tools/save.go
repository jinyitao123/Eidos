package tools

import (
	"context"
	"encoding/json"
	"strings"

	"ontologyserver/internal/mcp"

	"gopkg.in/yaml.v3"
)

// mergeYAMLContent combines stage outputs into projects.yaml_content.
// It produces a flat YAML with id/name/version at the top level alongside
// classes, relationships, rules, actions, etc. — no ontology: wrapper.
func mergeYAMLContent(ctx context.Context, d *Deps, projectID string) {
	rows, err := d.PG.Query(ctx,
		`SELECT stage, content FROM ontology.stage_outputs
		 WHERE project_id = $1 ORDER BY created_at DESC`, projectID)
	if err != nil {
		return
	}
	defer rows.Close()

	stages := make(map[string]string)
	for rows.Next() {
		var stage, content string
		if rows.Scan(&stage, &content) == nil {
			if _, exists := stages[stage]; !exists {
				stages[stage] = content
			}
		}
	}

	// Use ontology_structure as base (has classes + relationships)
	structYAML := stages["ontology_structure"]
	if structYAML == "" {
		return
	}

	// Parse base into a flat structure, unwrapping ontology: wrapper if present
	flat := extractFlat(structYAML)
	if flat == nil {
		return
	}

	// Merge rules_actions if available
	if ra, ok := stages["rules_actions"]; ok && ra != "" {
		raFlat := extractFlat(ra)
		if raFlat != nil {
			for _, k := range []string{"rules", "actions", "functions"} {
				if v, ok := raFlat[k]; ok {
					flat[k] = v
				}
			}
		}
	}

	// Ensure id/name/version exist — fill from project metadata if missing
	if flat["id"] == nil || flat["id"] == "" {
		var projName string
		_ = d.PG.QueryRow(ctx,
			`SELECT name FROM ontology.projects WHERE id::text = $1`, projectID).Scan(&projName)
		if projName != "" {
			flat["name"] = projName
			flat["id"] = strings.ToLower(strings.ReplaceAll(projName, " ", "_"))
		} else {
			flat["id"] = "project"
			flat["name"] = "Project"
		}
	}
	if flat["version"] == nil || flat["version"] == "" {
		flat["version"] = "1.0"
	}

	if out, err := yaml.Marshal(flat); err == nil {
		d.PG.Exec(ctx,
			`UPDATE ontology.projects SET yaml_content = $2, updated_at = now() WHERE id = $1`,
			projectID, string(out))
	}
}

// extractFlat parses YAML and returns a flat map. If the YAML has an
// "ontology:" wrapper, the wrapper's fields are promoted to top level
// and then any top-level data keys (classes, relationships, etc.) are merged in.
func extractFlat(raw string) map[string]any {
	var doc map[string]any
	if err := yaml.Unmarshal([]byte(raw), &doc); err != nil || doc == nil {
		return nil
	}

	// If there's an ontology: wrapper, start from its contents
	flat := make(map[string]any)
	if inner, ok := doc["ontology"].(map[string]any); ok {
		for k, v := range inner {
			flat[k] = v
		}
	}

	// Merge top-level keys (classes, relationships, rules, etc.)
	// Top-level keys override wrapper keys for data arrays only
	dataKeys := map[string]bool{
		"classes": true, "relationships": true, "rules": true,
		"actions": true, "functions": true, "graph_config": true,
		"connector_hints": true,
	}
	metaKeys := map[string]bool{
		"id": true, "name": true, "version": true, "description": true,
	}
	for k, v := range doc {
		if k == "ontology" {
			continue
		}
		if dataKeys[k] {
			// Only override if flat doesn't already have it, or if top-level has content
			if flat[k] == nil {
				flat[k] = v
			}
		} else if metaKeys[k] {
			// Top-level metadata fills in missing wrapper metadata
			if flat[k] == nil || flat[k] == "" {
				flat[k] = v
			}
		} else {
			// Pass through unknown keys
			if flat[k] == nil {
				flat[k] = v
			}
		}
	}

	return flat
}

// extractYAML tries to extract a YAML code block from Markdown-wrapped content.
// If the content contains ```yaml ... ```, returns the inner YAML.
// Otherwise returns the original content unchanged.
func extractYAML(content string) string {
	// Look for ```yaml or ``` fenced block
	markers := []string{"```yaml\n", "```yml\n", "```\n"}
	for _, marker := range markers {
		start := strings.Index(content, marker)
		if start == -1 {
			continue
		}
		body := content[start+len(marker):]
		end := strings.Index(body, "```")
		if end == -1 {
			continue
		}
		extracted := strings.TrimSpace(body[:end])
		if extracted != "" {
			return extracted
		}
	}
	return content
}

func registerSaveOutput(router *mcp.Router, d *Deps) {
	router.Register(mcp.ToolDef{
		Name:        "save_output",
		Description: "将 Agent 的输出保存到项目上下文中。后续 Agent 通过 read 工具读取。",
		InputSchema: mcp.Schema(map[string]any{
			"project_id": mcp.Prop("string", "本体项目ID"),
			"stage":      mcp.PropEnum("string", "当前阶段", []string{"scene_analysis", "ontology_structure", "rules_actions", "review_report"}),
			"content":    mcp.Prop("string", "YAML 格式的输出内容"),
		}, []string{"project_id", "stage", "content"}),
	}, func(ctx context.Context, args json.RawMessage) *mcp.ToolCallResult {
		var p struct {
			ProjectID string `json:"project_id"`
			Stage     string `json:"stage"`
			Content   string `json:"content"`
		}
		if err := json.Unmarshal(args, &p); err != nil {
			return mcp.ErrorResult("invalid arguments: " + err.Error())
		}

		// Try to extract YAML from fenced code block if present
		p.Content = extractYAML(p.Content)

		// Validate that content is valid YAML
		var check any
		if err := yaml.Unmarshal([]byte(p.Content), &check); err != nil {
			return mcp.ErrorResult("content is not valid YAML: " + err.Error())
		}

		// Reject empty project_id early (auto_save may pass "" if profile missing)
		if p.ProjectID == "" {
			return mcp.ErrorResult("project_id is empty — 请确认会话的 profile 中包含 project_id")
		}

		// Check project exists before INSERT (clearer error than FK violation)
		var exists bool
		_ = d.PG.QueryRow(ctx,
			`SELECT EXISTS(SELECT 1 FROM ontology.projects WHERE id::text = $1)`,
			p.ProjectID).Scan(&exists)
		if !exists {
			return mcp.ErrorResult("project not found: " + p.ProjectID + " — 请确认项目已创建且 project_id 正确")
		}

		// Insert stage output
		_, err := d.PG.Exec(ctx,
			`INSERT INTO ontology.stage_outputs (project_id, stage, content)
			 VALUES ($1, $2, $3)`,
			p.ProjectID, p.Stage, p.Content,
		)
		if err != nil {
			return mcp.ErrorResult("save failed: " + err.Error())
		}

		// Update project's current_stage
		_, err = d.PG.Exec(ctx,
			`UPDATE ontology.projects SET current_stage = $2, updated_at = now() WHERE id = $1`,
			p.ProjectID, p.Stage,
		)
		if err != nil {
			return mcp.ErrorResult("update project stage failed: " + err.Error())
		}

		// Merge stages into yaml_content whenever structure or later stages are saved
		if p.Stage == "ontology_structure" || p.Stage == "rules_actions" || p.Stage == "review_report" {
			mergeYAMLContent(ctx, d, p.ProjectID)
		}

		return mcp.TextResult(map[string]any{
			"saved":      true,
			"project_id": p.ProjectID,
			"stage":      p.Stage,
		})
	})
}
