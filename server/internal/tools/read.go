package tools

import (
	"context"
	"encoding/json"
	"fmt"

	"ontologyserver/internal/mcp"
)

// T05: read_scene_analysis — reads S1 output
func registerReadSceneAnalysis(router *mcp.Router, d *Deps) {
	router.Register(mcp.ToolDef{
		Name:        "read_scene_analysis",
		Description: "读取场景分析师的结构化输出。供本体架构师和规则设计师使用。",
		InputSchema: mcp.Schema(map[string]any{
			"project_id": mcp.Prop("string", "本体项目ID"),
		}, []string{"project_id"}),
	}, readStageHandler(d, "scene_analysis"))
}

// T06: read_ontology_structure — reads S2 output
func registerReadOntologyStructure(router *mcp.Router, d *Deps) {
	router.Register(mcp.ToolDef{
		Name:        "read_ontology_structure",
		Description: "读取本体架构师生成的类和关系定义。供规则设计师使用。",
		InputSchema: mcp.Schema(map[string]any{
			"project_id": mcp.Prop("string", "本体项目ID"),
		}, []string{"project_id"}),
	}, readStageHandler(d, "ontology_structure"))
}

// read_review_report — reads S4 output (review report stage)
func registerReadReviewReport(router *mcp.Router, d *Deps) {
	router.Register(mcp.ToolDef{
		Name:        "read_review_report",
		Description: "读取审核员（S4）的审核报告输出。供前端审核报告页面使用。",
		InputSchema: mcp.Schema(map[string]any{
			"project_id": mcp.Prop("string", "本体项目ID"),
		}, []string{"project_id"}),
	}, readStageHandler(d, "review_report"))
}

// T07: read_full_ontology_yaml — reads merged S2+S3 output
func registerReadFullOntologyYAML(router *mcp.Router, d *Deps) {
	router.Register(mcp.ToolDef{
		Name:        "read_full_ontology_yaml",
		Description: "读取当前项目的完整本体 YAML 定义。供审核员全面检查。",
		InputSchema: mcp.Schema(map[string]any{
			"project_id": mcp.Prop("string", "本体项目ID"),
		}, []string{"project_id"}),
	}, func(ctx context.Context, args json.RawMessage) *mcp.ToolCallResult {
		var p struct {
			ProjectID string `json:"project_id"`
		}
		if err := json.Unmarshal(args, &p); err != nil {
			return mcp.ErrorResult("invalid arguments: " + err.Error())
		}

		// First try to get yaml_content from projects table (merged)
		var yamlContent string
		err := d.PG.QueryRow(ctx,
			`SELECT yaml_content FROM ontology.projects WHERE id = $1`,
			p.ProjectID,
		).Scan(&yamlContent)
		if err == nil && yamlContent != "" {
			return mcp.TextResult(map[string]any{"yaml_content": yamlContent})
		}

		// Fallback: read the latest stage outputs and combine
		rows, err := d.PG.Query(ctx,
			`SELECT stage, content FROM ontology.stage_outputs
			 WHERE project_id = $1
			 ORDER BY created_at DESC`,
			p.ProjectID,
		)
		if err != nil {
			return mcp.ErrorResult("query failed: " + err.Error())
		}
		defer rows.Close()

		stages := make(map[string]string)
		for rows.Next() {
			var stage, content string
			if err := rows.Scan(&stage, &content); err != nil {
				continue
			}
			if _, exists := stages[stage]; !exists {
				stages[stage] = content
			}
		}

		if len(stages) == 0 {
			return mcp.ErrorResult(fmt.Sprintf("no stage outputs found for project '%s'", p.ProjectID))
		}

		return mcp.TextResult(map[string]any{"stages": stages})
	})
}

// readStageHandler returns a handler that reads the latest output for a given stage.
func readStageHandler(d *Deps, stage string) mcp.ToolFunc {
	return func(ctx context.Context, args json.RawMessage) *mcp.ToolCallResult {
		var p struct {
			ProjectID string `json:"project_id"`
		}
		if err := json.Unmarshal(args, &p); err != nil {
			return mcp.ErrorResult("invalid arguments: " + err.Error())
		}

		var content string
		err := d.PG.QueryRow(ctx,
			`SELECT content FROM ontology.stage_outputs
			 WHERE project_id = $1 AND stage = $2
			 ORDER BY created_at DESC LIMIT 1`,
			p.ProjectID, stage,
		).Scan(&content)
		if err != nil {
			return mcp.ErrorResult(fmt.Sprintf("no %s output found: %v", stage, err))
		}

		return mcp.TextResult(map[string]any{
			"stage":   stage,
			"content": content,
		})
	}
}
