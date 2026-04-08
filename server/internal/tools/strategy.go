package tools

import (
	"context"
	"encoding/json"

	"ontologyserver/internal/mcp"
)

func registerListOntologyTemplates(router *mcp.Router, d *Deps) {
	router.Register(mcp.ToolDef{
		Name:        "list_ontology_templates",
		Description: "列出可用的行业本体模板，支持按行业过滤。用于 TemplateWizard 第一步展示可选模板。",
		InputSchema: mcp.Schema(map[string]any{
			"industry": mcp.Prop("string", "行业过滤（可选），如 manufacturing"),
		}, nil),
	}, func(ctx context.Context, args json.RawMessage) *mcp.ToolCallResult {
		var p struct {
			Industry string `json:"industry"`
		}
		json.Unmarshal(args, &p)

		query := `SELECT id, template_id, name, industry, domain, version, description, param_schema, created_at::text FROM ontology.ontology_templates`
		qargs := []any{}
		if p.Industry != "" {
			query += ` WHERE industry = $1`
			qargs = append(qargs, p.Industry)
		}
		query += ` ORDER BY created_at DESC`

		rows, err := d.PG.Query(ctx, query, qargs...)
		if err != nil {
			return mcp.ErrorResult("query failed: " + err.Error())
		}
		defer rows.Close()

		var templates []map[string]any
		for rows.Next() {
			var id, templateID, name, industry, domain, version, createdAt string
			var description *string
			var paramSchema json.RawMessage
			if err := rows.Scan(&id, &templateID, &name, &industry, &domain, &version, &description, &paramSchema, &createdAt); err != nil {
				return mcp.ErrorResult("scan failed: " + err.Error())
			}
			t := map[string]any{
				"id":           id,
				"template_id":  templateID,
				"name":         name,
				"industry":     industry,
				"domain":       domain,
				"version":      version,
				"param_schema": json.RawMessage(paramSchema),
				"created_at":   createdAt,
			}
			if description != nil {
				t["description"] = *description
			}
			templates = append(templates, t)
		}
		return mcp.TextResult(map[string]any{
			"count":     len(templates),
			"templates": templates,
		})
	})
}

func registerGetStrategyProfile(router *mcp.Router, d *Deps) {
	router.Register(mcp.ToolDef{
		Name:        "get_strategy_profile",
		Description: "获取项目当前激活的策略配置。供 Spare Parts 规则引擎和前端 StrategyProfileEditor 使用。",
		InputSchema: mcp.Schema(map[string]any{
			"project_id": mcp.Prop("string", "项目ID"),
		}, []string{"project_id"}),
	}, func(ctx context.Context, args json.RawMessage) *mcp.ToolCallResult {
		var p struct {
			ProjectID string `json:"project_id"`
		}
		if err := json.Unmarshal(args, &p); err != nil {
			return mcp.ErrorResult("invalid arguments: " + err.Error())
		}
		if p.ProjectID == "" {
			return mcp.ErrorResult("project_id is required")
		}

		var id, templateID, profileName, createdAt, updatedAt string
		var parameters json.RawMessage
		err := d.PG.QueryRow(ctx,
			`SELECT id::text, template_id, profile_name, parameters, created_at::text, updated_at::text
			 FROM ontology.strategy_profiles
			 WHERE project_id::text = $1 AND is_active = true
			 ORDER BY updated_at DESC LIMIT 1`,
			p.ProjectID,
		).Scan(&id, &templateID, &profileName, &parameters, &createdAt, &updatedAt)
		if err != nil {
			return mcp.ErrorResult("no active strategy profile for project: " + p.ProjectID)
		}

		return mcp.TextResult(map[string]any{
			"id":           id,
			"project_id":   p.ProjectID,
			"template_id":  templateID,
			"profile_name": profileName,
			"parameters":   json.RawMessage(parameters),
			"created_at":   createdAt,
			"updated_at":   updatedAt,
		})
	})
}

func registerUpdateStrategyProfile(router *mcp.Router, d *Deps) {
	router.Register(mcp.ToolDef{
		Name:        "update_strategy_profile",
		Description: "创建或更新项目的策略配置。如果项目已有激活的 profile 则更新 parameters；如果没有则创建新的。",
		InputSchema: mcp.Schema(map[string]any{
			"project_id":   mcp.Prop("string", "项目ID"),
			"template_id":  mcp.Prop("string", "模板ID，如 spare_parts_manufacturing_v1"),
			"profile_name": mcp.PropWithDefault("string", "策略名称", "default"),
			"parameters":   mcp.Prop("object", "策略参数键值对（部分更新：只传需要修改的字段，其余保留）"),
		}, []string{"project_id", "template_id", "parameters"}),
	}, func(ctx context.Context, args json.RawMessage) *mcp.ToolCallResult {
		var p struct {
			ProjectID   string          `json:"project_id"`
			TemplateID  string          `json:"template_id"`
			ProfileName string          `json:"profile_name"`
			Parameters  json.RawMessage `json:"parameters"`
		}
		if err := json.Unmarshal(args, &p); err != nil {
			return mcp.ErrorResult("invalid arguments: " + err.Error())
		}
		if p.ProjectID == "" || p.TemplateID == "" {
			return mcp.ErrorResult("project_id and template_id are required")
		}
		if p.ProfileName == "" {
			p.ProfileName = "default"
		}

		// Validate parameters is valid JSON object
		var paramsMap map[string]any
		if err := json.Unmarshal(p.Parameters, &paramsMap); err != nil {
			return mcp.ErrorResult("parameters must be a JSON object: " + err.Error())
		}

		// Check project exists
		var exists bool
		_ = d.PG.QueryRow(ctx,
			`SELECT EXISTS(SELECT 1 FROM ontology.projects WHERE id::text = $1)`,
			p.ProjectID).Scan(&exists)
		if !exists {
			return mcp.ErrorResult("project not found: " + p.ProjectID)
		}

		// Check if an active profile exists for this project
		var existingID string
		var existingParams json.RawMessage
		err := d.PG.QueryRow(ctx,
			`SELECT id::text, parameters FROM ontology.strategy_profiles
			 WHERE project_id::text = $1 AND is_active = true LIMIT 1`,
			p.ProjectID,
		).Scan(&existingID, &existingParams)

		if err == nil {
			// Merge: existing params + new params (new overwrites)
			var merged map[string]any
			json.Unmarshal(existingParams, &merged)
			if merged == nil {
				merged = make(map[string]any)
			}
			for k, v := range paramsMap {
				merged[k] = v
			}
			mergedJSON, _ := json.Marshal(merged)

			_, err := d.PG.Exec(ctx,
				`UPDATE ontology.strategy_profiles
				 SET parameters = $2, template_id = $3, profile_name = $4, updated_at = now()
				 WHERE id::text = $1`,
				existingID, mergedJSON, p.TemplateID, p.ProfileName,
			)
			if err != nil {
				return mcp.ErrorResult("update failed: " + err.Error())
			}
			return mcp.TextResult(map[string]any{
				"action":      "updated",
				"profile_id":  existingID,
				"project_id":  p.ProjectID,
				"template_id": p.TemplateID,
				"parameters":  json.RawMessage(mergedJSON),
			})
		}

		// Create new profile
		var newID string
		err = d.PG.QueryRow(ctx,
			`INSERT INTO ontology.strategy_profiles (project_id, template_id, profile_name, parameters)
			 VALUES ($1::uuid, $2, $3, $4)
			 RETURNING id::text`,
			p.ProjectID, p.TemplateID, p.ProfileName, p.Parameters,
		).Scan(&newID)
		if err != nil {
			return mcp.ErrorResult("create failed: " + err.Error())
		}

		return mcp.TextResult(map[string]any{
			"action":      "created",
			"profile_id":  newID,
			"project_id":  p.ProjectID,
			"template_id": p.TemplateID,
			"parameters":  json.RawMessage(p.Parameters),
		})
	})
}
