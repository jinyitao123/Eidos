package tools

import (
	"context"
	"encoding/json"

	"ontologyserver/internal/mcp"
)

func registerListProjects(router *mcp.Router, d *Deps) {
	router.Register(mcp.ToolDef{
		Name:        "list_projects",
		Description: "列出所有本体项目（包含构建中和已发布）。",
		InputSchema: mcp.Schema(map[string]any{
			"status": mcp.Prop("string", "按状态过滤: building, published（可选）"),
		}, nil),
	}, func(ctx context.Context, args json.RawMessage) *mcp.ToolCallResult {
		var p struct {
			Status string `json:"status"`
		}
		json.Unmarshal(args, &p)

		query := `SELECT id::text, name, description, status, current_stage,
			COALESCE(published_version, ''), COALESCE(published_at::text, ''),
			created_at::text, updated_at::text
			FROM ontology.projects ORDER BY updated_at DESC`
		qArgs := []any{}
		if p.Status != "" {
			query = `SELECT id::text, name, description, status, current_stage,
				COALESCE(published_version, ''), COALESCE(published_at::text, ''),
				created_at::text, updated_at::text
				FROM ontology.projects WHERE status = $1 ORDER BY updated_at DESC`
			qArgs = append(qArgs, p.Status)
		}

		rows, err := d.PG.Query(ctx, query, qArgs...)
		if err != nil {
			return mcp.ErrorResult("query failed: " + err.Error())
		}
		defer rows.Close()

		var projects []map[string]any
		for rows.Next() {
			var id, name, desc, status, stage, version, publishedAt, createdAt, updatedAt string
			if err := rows.Scan(&id, &name, &desc, &status, &stage, &version, &publishedAt, &createdAt, &updatedAt); err != nil {
				continue
			}
			proj := map[string]any{
				"id":           id,
				"name":         name,
				"description":  desc,
				"status":       status,
				"current_stage": stage,
				"created_at":   createdAt,
				"updated_at":   updatedAt,
			}
			if version != "" {
				proj["published_version"] = version
			}
			if publishedAt != "" {
				proj["published_at"] = publishedAt
			}
			projects = append(projects, proj)
		}

		return mcp.TextResult(map[string]any{"projects": projects})
	})
}

func registerGetProject(router *mcp.Router, d *Deps) {
	router.Register(mcp.ToolDef{
		Name:        "get_project",
		Description: "获取单个本体项目的详细信息，包括阶段输出摘要。",
		InputSchema: mcp.Schema(map[string]any{
			"project_id": mcp.Prop("string", "项目ID"),
		}, []string{"project_id"}),
	}, func(ctx context.Context, args json.RawMessage) *mcp.ToolCallResult {
		var p struct {
			ProjectID string `json:"project_id"`
		}
		json.Unmarshal(args, &p)

		var id, name, desc, status, stage, version, publishedAt, createdAt, updatedAt string
		err := d.PG.QueryRow(ctx,
			`SELECT id::text, name, description, status, current_stage,
				COALESCE(published_version, ''), COALESCE(published_at::text, ''),
				created_at::text, updated_at::text
			FROM ontology.projects WHERE id::text = $1`, p.ProjectID).
			Scan(&id, &name, &desc, &status, &stage, &version, &publishedAt, &createdAt, &updatedAt)
		if err != nil {
			return mcp.ErrorResult("project not found: " + err.Error())
		}

		proj := map[string]any{
			"id":           id,
			"name":         name,
			"description":  desc,
			"status":       status,
			"current_stage": stage,
			"created_at":   createdAt,
			"updated_at":   updatedAt,
		}
		if version != "" {
			proj["published_version"] = version
		}
		if publishedAt != "" {
			proj["published_at"] = publishedAt
		}

		// Get stage outputs summary
		stageRows, err := d.PG.Query(ctx,
			`SELECT stage, created_at::text FROM ontology.stage_outputs
			WHERE project_id::text = $1 ORDER BY created_at`, p.ProjectID)
		if err == nil {
			defer stageRows.Close()
			var stages []map[string]any
			for stageRows.Next() {
				var s, at string
				if stageRows.Scan(&s, &at) == nil {
					stages = append(stages, map[string]any{"stage": s, "created_at": at})
				}
			}
			proj["stages"] = stages
		}

		return mcp.TextResult(proj)
	})
}

func registerCreateProject(router *mcp.Router, d *Deps) {
	router.Register(mcp.ToolDef{
		Name:        "create_project",
		Description: "创建新的本体项目。",
		InputSchema: mcp.Schema(map[string]any{
			"name":        mcp.Prop("string", "项目名称"),
			"description": mcp.Prop("string", "项目描述"),
		}, []string{"name"}),
	}, func(ctx context.Context, args json.RawMessage) *mcp.ToolCallResult {
		var p struct {
			Name        string `json:"name"`
			Description string `json:"description"`
		}
		json.Unmarshal(args, &p)

		var id string
		err := d.PG.QueryRow(ctx,
			`INSERT INTO ontology.projects (name, description, status, current_stage)
			VALUES ($1, $2, 'building', 'scene_analysis')
			RETURNING id::text`, p.Name, p.Description).Scan(&id)
		if err != nil {
			return mcp.ErrorResult("create failed: " + err.Error())
		}

		return mcp.TextResult(map[string]any{"id": id, "name": p.Name, "status": "building"})
	})
}

func registerDeleteProject(router *mcp.Router, d *Deps) {
	router.Register(mcp.ToolDef{
		Name:        "delete_project",
		Description: "删除本体项目及其所有阶段输出。",
		InputSchema: mcp.Schema(map[string]any{
			"project_id": mcp.Prop("string", "项目ID"),
		}, []string{"project_id"}),
	}, func(ctx context.Context, args json.RawMessage) *mcp.ToolCallResult {
		var p struct {
			ProjectID string `json:"project_id"`
		}
		json.Unmarshal(args, &p)

		// Delete stage outputs first
		_, _ = d.PG.Exec(ctx, `DELETE FROM ontology.stage_outputs WHERE project_id::text = $1`, p.ProjectID)

		// Delete versions
		_, _ = d.PG.Exec(ctx, `DELETE FROM ontology.versions WHERE project_id::text = $1`, p.ProjectID)

		// Delete documents
		_, _ = d.PG.Exec(ctx, `DELETE FROM ontology.documents WHERE project_id::text = $1`, p.ProjectID)

		// Delete the project
		tag, err := d.PG.Exec(ctx, `DELETE FROM ontology.projects WHERE id::text = $1`, p.ProjectID)
		if err != nil {
			return mcp.ErrorResult("delete failed: " + err.Error())
		}
		if tag.RowsAffected() == 0 {
			return mcp.ErrorResult("project not found")
		}

		return mcp.TextResult(map[string]any{"deleted": true, "project_id": p.ProjectID})
	})
}
