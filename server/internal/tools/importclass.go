package tools

import (
	"context"
	"encoding/json"
	"fmt"

	"ontologyserver/internal/mcp"
	ontoyaml "ontologyserver/internal/yaml"

	"gopkg.in/yaml.v3"
)

func registerImportClass(router *mcp.Router, d *Deps) {
	router.Register(mcp.ToolDef{
		Name:        "import_class",
		Description: "从指定的已发布本体中导入一个类的完整定义（属性+关系）。导入后 imported_from 字段自动标注来源。",
		InputSchema: mcp.Schema(map[string]any{
			"source_ontology_id":    mcp.Prop("string", "源本体ID"),
			"class_id":             mcp.Prop("string", "要导入的类ID"),
			"include_relationships": mcp.PropWithDefault("boolean", "是否同时导入该类参与的关系", true),
		}, []string{"source_ontology_id", "class_id"}),
	}, func(ctx context.Context, args json.RawMessage) *mcp.ToolCallResult {
		var p struct {
			SourceOntologyID     string `json:"source_ontology_id"`
			ClassID              string `json:"class_id"`
			IncludeRelationships bool   `json:"include_relationships"`
		}
		if err := json.Unmarshal(args, &p); err != nil {
			return mcp.ErrorResult("invalid arguments: " + err.Error())
		}

		// Fetch the published ontology by source_ontology_id
		var yamlContent string
		err := d.PG.QueryRow(ctx,
			`SELECT yaml_content FROM ontology.projects
			 WHERE status = 'published' AND yaml_content IS NOT NULL AND id::text = $1
			 LIMIT 1`,
			p.SourceOntologyID,
		).Scan(&yamlContent)
		if err != nil {
			return mcp.ErrorResult(fmt.Sprintf("source ontology '%s' not found: %v", p.SourceOntologyID, err))
		}

		var doc ontoyaml.OntologyDoc
		if err := yaml.Unmarshal([]byte(yamlContent), &doc); err != nil {
			return mcp.ErrorResult("failed to parse source ontology: " + err.Error())
		}

		o := doc.Ontology

		// Find the class
		var targetClass *ontoyaml.Class
		for i := range o.Classes {
			if o.Classes[i].ID == p.ClassID {
				targetClass = &o.Classes[i]
				break
			}
		}
		if targetClass == nil {
			return mcp.ErrorResult(fmt.Sprintf("class '%s' not found in ontology '%s'", p.ClassID, p.SourceOntologyID))
		}

		// Mark as imported
		importedClass := *targetClass
		importedClass.ImportedFrom = p.SourceOntologyID
		importedClass.FirstCitizen = false // imported class is never first citizen in target

		result := map[string]any{
			"class": importedClass,
		}

		// Optionally include relationships
		if p.IncludeRelationships {
			var rels []ontoyaml.Relationship
			for _, r := range o.Relationships {
				if r.From == p.ClassID || r.To == p.ClassID {
					rels = append(rels, r)
				}
			}
			result["relationships"] = rels
		}

		return mcp.TextResult(result)
	})
}
