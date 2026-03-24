package tools

import (
	"context"
	"encoding/json"

	"ontologyserver/internal/mcp"
	ontoyaml "ontologyserver/internal/yaml"

	"gopkg.in/yaml.v3"
)

func registerQueryPublishedOntologies(router *mcp.Router, d *Deps) {
	router.Register(mcp.ToolDef{
		Name:        "query_published_ontologies",
		Description: "查询所有已发布本体的元数据。用于共享类检测和跨本体一致性检查。",
		InputSchema: mcp.Schema(map[string]any{
			"ontology_id":        mcp.Prop("string", "指定本体ID（可选，不填返回全部）"),
			"include_attributes": mcp.PropWithDefault("boolean", "是否包含属性详情", false),
		}, nil),
	}, func(ctx context.Context, args json.RawMessage) *mcp.ToolCallResult {
		var p struct {
			OntologyID        string `json:"ontology_id"`
			IncludeAttributes bool   `json:"include_attributes"`
		}
		json.Unmarshal(args, &p)

		query := `SELECT id, name, yaml_content, published_version FROM ontology.projects WHERE status = 'published'`
		qArgs := []any{}
		if p.OntologyID != "" {
			query += ` AND id::text = $1`
			qArgs = append(qArgs, p.OntologyID)
		}

		rows, err := d.PG.Query(ctx, query, qArgs...)
		if err != nil {
			return mcp.ErrorResult("query failed: " + err.Error())
		}
		defer rows.Close()

		var ontologies []map[string]any
		for rows.Next() {
			var id, name, yamlContent, version string
			if err := rows.Scan(&id, &name, &yamlContent, &version); err != nil {
				continue
			}

			entry := map[string]any{
				"id":      id,
				"name":    name,
				"version": version,
				"status":  "published",
			}

			// Parse the YAML to extract class/relationship summaries
			var doc ontoyaml.OntologyDoc
			if err := yaml.Unmarshal([]byte(yamlContent), &doc); err == nil {
				o := doc.Ontology
				var classes []map[string]any
				for _, c := range o.Classes {
					ce := map[string]any{
						"id":              c.ID,
						"name":            c.Name,
						"first_citizen":   c.FirstCitizen,
						"attribute_count": len(c.Attributes),
					}
					if p.IncludeAttributes {
						ce["attributes"] = c.Attributes
					}
					classes = append(classes, ce)
				}
				entry["classes"] = classes

				var rels []map[string]any
				for _, r := range o.Relationships {
					rels = append(rels, map[string]any{
						"id":   r.ID,
						"from": r.From,
						"to":   r.To,
					})
				}
				entry["relationships"] = rels
			}

			ontologies = append(ontologies, entry)
		}

		return mcp.TextResult(map[string]any{"ontologies": ontologies})
	})
}
