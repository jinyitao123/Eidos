package tools

import (
	"context"
	"encoding/json"

	"ontologyserver/internal/mcp"
	ontoyaml "ontologyserver/internal/yaml"
)

// registerUpdateOntologyYAML registers the update_ontology_yaml tool.
// Unlike save_output (which is for Agent use and creates stage history),
// this tool is for human edits from the UI: it directly overwrites
// projects.yaml_content without changing current_stage or creating
// a new stage_outputs row.
func registerUpdateOntologyYAML(router *mcp.Router, d *Deps) {
	router.Register(mcp.ToolDef{
		Name:        "update_ontology_yaml",
		Description: "人工编辑专用：直接更新项目的 yaml_content，不影响 current_stage 和阶段历史。用于 ClassEditor、RuleEditor 等前端编辑操作。",
		InputSchema: mcp.Schema(map[string]any{
			"project_id":   mcp.Prop("string", "项目ID"),
			"yaml_content": mcp.Prop("string", "完整的本体 YAML 内容"),
		}, []string{"project_id", "yaml_content"}),
	}, func(ctx context.Context, args json.RawMessage) *mcp.ToolCallResult {
		var p struct {
			ProjectID   string `json:"project_id"`
			YAMLContent string `json:"yaml_content"`
		}
		if err := json.Unmarshal(args, &p); err != nil {
			return mcp.ErrorResult("invalid arguments: " + err.Error())
		}
		if p.ProjectID == "" {
			return mcp.ErrorResult("project_id is required")
		}
		if p.YAMLContent == "" {
			return mcp.ErrorResult("yaml_content is required")
		}

		// Validate YAML is parseable (syntax check). Semantic errors are warnings,
		// not blockers — users may be mid-edit and need to save partial work.
		o, err := ontoyaml.Parse([]byte(p.YAMLContent))
		if err != nil {
			return mcp.ErrorResult("invalid YAML syntax: " + err.Error())
		}
		// Run semantic validation to collect warnings returned to the caller.
		// Warnings do not block saving — users may be mid-edit.
		validationResult := ontoyaml.Validate(o, "full")

		// Check project exists
		var exists bool
		_ = d.PG.QueryRow(ctx,
			`SELECT EXISTS(SELECT 1 FROM ontology.projects WHERE id::text = $1)`,
			p.ProjectID).Scan(&exists)
		if !exists {
			return mcp.ErrorResult("project not found: " + p.ProjectID)
		}

		// Update yaml_content only — do NOT touch current_stage
		tag, err := d.PG.Exec(ctx,
			`UPDATE ontology.projects SET yaml_content = $2, updated_at = now() WHERE id::text = $1`,
			p.ProjectID, p.YAMLContent,
		)
		if err != nil {
			return mcp.ErrorResult("update failed: " + err.Error())
		}
		if tag.RowsAffected() == 0 {
			return mcp.ErrorResult("project not found: " + p.ProjectID)
		}

		return mcp.TextResult(map[string]any{
			"updated":    true,
			"project_id": p.ProjectID,
			"warnings":   validationResult.Errors,
		})
	})
}
