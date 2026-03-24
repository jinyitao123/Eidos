package mcp

import (
	"encoding/json"
	"fmt"
	"strings"

	"ontologypipeline/internal/types"
)

// ToolDef is the MCP tool registration format.
type ToolDef struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	InputSchema json.RawMessage `json:"inputSchema"`
}

// GenerateResult holds generated tool definitions and Go code skeletons.
type GenerateResult struct {
	Tools    []ToolDef
	GoFiles  map[string]string // filename -> Go source code
}

// Generate produces MCP tool definitions and Go code skeletons from an ontology.
func Generate(o *types.Ontology) *GenerateResult {
	result := &GenerateResult{
		GoFiles: make(map[string]string),
	}

	// Generate query tools for each class
	for _, c := range o.Classes {
		tool := generateQueryTool(o.ID, c)
		result.Tools = append(result.Tools, tool)
		result.GoFiles[fmt.Sprintf("query_%s.go", c.ID)] = generateQueryGoFile(o.ID, c)
	}

	// Generate execute tools for each action
	for _, a := range o.Actions {
		tool := generateExecuteTool(a)
		result.Tools = append(result.Tools, tool)
		result.GoFiles[fmt.Sprintf("execute_%s.go", strings.ToLower(a.ID))] = generateExecuteGoFile(o.ID, a)
	}

	// Generate calc tools for each function
	for _, f := range o.Functions {
		tool := generateCalcTool(f)
		result.Tools = append(result.Tools, tool)
	}

	// Generate query_ontology_metadata tool
	result.Tools = append(result.Tools, generateMetadataTool(o))

	return result
}

func generateQueryTool(schemaID string, c types.Class) ToolDef {
	props := make(map[string]any)

	// Add graph_sync=true attributes as optional query params
	for _, a := range c.Attributes {
		if a.GraphSync {
			props[a.ID] = map[string]any{
				"type":        mapJSONType(a.Type),
				"description": a.Name,
			}
		}
	}

	// Standard pagination params
	props["limit"] = map[string]any{"type": "integer", "description": "最大返回条数", "default": 50}
	props["offset"] = map[string]any{"type": "integer", "description": "偏移量", "default": 0}
	props["sort_by"] = map[string]any{"type": "string", "description": "排序字段"}
	props["order"] = map[string]any{"type": "string", "enum": []string{"asc", "desc"}, "default": "desc"}

	schema := map[string]any{
		"type":       "object",
		"properties": props,
	}
	schemaJSON, _ := json.Marshal(schema)

	return ToolDef{
		Name:        fmt.Sprintf("query_%s", c.ID),
		Description: fmt.Sprintf("查询%s列表。支持按属性过滤、分页和排序。", c.Name),
		InputSchema: schemaJSON,
	}
}

func generateExecuteTool(a types.Action) ToolDef {
	props := make(map[string]any)
	var required []string

	for _, p := range a.Params {
		props[p.ID] = map[string]any{
			"type":        mapJSONType(p.Type),
			"description": p.Name,
		}
		if p.Required {
			required = append(required, p.ID)
		}
	}

	schema := map[string]any{
		"type":       "object",
		"properties": props,
	}
	if len(required) > 0 {
		schema["required"] = required
	}
	schemaJSON, _ := json.Marshal(schema)

	return ToolDef{
		Name:        fmt.Sprintf("execute_%s", strings.ToLower(a.ID)),
		Description: fmt.Sprintf("%s — %s", a.Name, a.Description),
		InputSchema: schemaJSON,
	}
}

func generateCalcTool(f types.Function) ToolDef {
	props := make(map[string]any)
	var required []string

	for _, inp := range f.Inputs {
		props[inp.ID] = map[string]any{
			"type":        mapJSONType(inp.Type),
			"description": inp.ID,
		}
		if inp.Required {
			required = append(required, inp.ID)
		}
	}

	schema := map[string]any{
		"type":       "object",
		"properties": props,
	}
	if len(required) > 0 {
		schema["required"] = required
	}
	schemaJSON, _ := json.Marshal(schema)

	return ToolDef{
		Name:        fmt.Sprintf("calc_%s", f.ID),
		Description: fmt.Sprintf("%s — %s", f.Name, f.Description),
		InputSchema: schemaJSON,
	}
}

func generateMetadataTool(o *types.Ontology) ToolDef {
	schemaJSON, _ := json.Marshal(map[string]any{
		"type":       "object",
		"properties": map[string]any{},
	})

	return ToolDef{
		Name:        "query_ontology_metadata",
		Description: fmt.Sprintf("查询 %s 本体的元数据：类列表、关系列表、可用工具。", o.Name),
		InputSchema: schemaJSON,
	}
}

func generateQueryGoFile(schemaID string, c types.Class) string {
	tableName := pluralize(c.ID)
	var b strings.Builder

	b.WriteString(fmt.Sprintf(`package tools

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

func handleQuery%s(ctx context.Context, pool *pgxpool.Pool, args json.RawMessage) (any, error) {
	var p struct {
`, capitalize(c.ID)))

	// Struct fields for graph_sync attributes
	for _, a := range c.Attributes {
		if a.GraphSync {
			b.WriteString(fmt.Sprintf("\t\t%s *%s `json:\"%s\"`\n",
				capitalize(a.ID), mapGoType(a.Type), a.ID))
		}
	}
	b.WriteString(`		Limit  int    ` + "`json:\"limit\"`\n")
	b.WriteString(`		Offset int    ` + "`json:\"offset\"`\n")
	b.WriteString(`		SortBy string ` + "`json:\"sort_by\"`\n")
	b.WriteString(`		Order  string ` + "`json:\"order\"`\n")
	b.WriteString("\t}\n")
	b.WriteString("\tjson.Unmarshal(args, &p)\n")
	b.WriteString("\tif p.Limit == 0 { p.Limit = 50 }\n\n")

	b.WriteString(fmt.Sprintf("\tquery := \"SELECT * FROM %s.%s WHERE 1=1\"\n", schemaID, tableName))
	b.WriteString("\tvar qArgs []any\n")
	b.WriteString("\targIdx := 1\n\n")

	for _, a := range c.Attributes {
		if a.GraphSync {
			field := capitalize(a.ID)
			b.WriteString(fmt.Sprintf("\tif p.%s != nil {\n", field))
			b.WriteString(fmt.Sprintf("\t\tquery += fmt.Sprintf(\" AND %s = $%%d\", argIdx)\n", a.ID))
			b.WriteString(fmt.Sprintf("\t\tqArgs = append(qArgs, *p.%s)\n", field))
			b.WriteString("\t\targIdx++\n")
			b.WriteString("\t}\n")
		}
	}

	b.WriteString(`
	if p.SortBy != "" {
		order := "DESC"
		if strings.EqualFold(p.Order, "asc") { order = "ASC" }
		query += fmt.Sprintf(" ORDER BY %s %s", p.SortBy, order)
	}
	query += fmt.Sprintf(" LIMIT %d OFFSET %d", p.Limit, p.Offset)

	rows, err := pool.Query(ctx, query, qArgs...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var results []map[string]any
	cols := rows.FieldDescriptions()
	for rows.Next() {
		vals, _ := rows.Values()
		row := make(map[string]any)
		for i, col := range cols {
			row[string(col.Name)] = vals[i]
		}
		results = append(results, row)
	}
	return results, nil
}
`)

	return b.String()
}

func generateExecuteGoFile(schemaID string, a types.Action) string {
	var b strings.Builder

	b.WriteString(fmt.Sprintf(`package tools

import (
	"context"
	"encoding/json"

	"github.com/jackc/pgx/v5/pgxpool"
)

func handleExecute%s(ctx context.Context, pool *pgxpool.Pool, args json.RawMessage) (any, error) {
	var p struct {
`, capitalize(a.ID)))

	for _, param := range a.Params {
		b.WriteString(fmt.Sprintf("\t\t%s %s `json:\"%s\"`\n",
			capitalize(param.ID), mapGoType(param.Type), param.ID))
	}

	b.WriteString("\t}\n")
	b.WriteString("\tif err := json.Unmarshal(args, &p); err != nil {\n")
	b.WriteString("\t\treturn nil, err\n")
	b.WriteString("\t}\n\n")

	// Generate writes
	b.WriteString("\ttx, err := pool.Begin(ctx)\n")
	b.WriteString("\tif err != nil { return nil, err }\n")
	b.WriteString("\tdefer tx.Rollback(ctx)\n\n")

	for _, w := range a.Writes {
		if w.Operation == "update" {
			parts := strings.SplitN(w.Target, ".", 2)
			if len(parts) == 2 {
				tableName := pluralize(parts[0])
				b.WriteString(fmt.Sprintf("\t// Update %s\n", w.Target))
				b.WriteString(fmt.Sprintf("\t_, err = tx.Exec(ctx, `UPDATE %s.%s SET %s = %s, updated_at = now() WHERE id = $1`, p.%s)\n",
					schemaID, tableName, parts[1], translateExpr(w.Expression), findIDParam(a.Params, parts[0])))
				b.WriteString("\tif err != nil { return nil, err }\n\n")
			}
		} else if w.Operation == "create" {
			b.WriteString(fmt.Sprintf("\t// Create %s record\n", w.Target))
			b.WriteString(fmt.Sprintf("\t// TODO: INSERT INTO %s.%s\n\n", schemaID, pluralize(w.Target)))
		}
	}

	b.WriteString("\tif err := tx.Commit(ctx); err != nil { return nil, err }\n\n")
	b.WriteString(fmt.Sprintf("\treturn map[string]any{\"success\": true, \"action\": \"%s\"}, nil\n", a.ID))
	b.WriteString("}\n")

	return b.String()
}

func mapJSONType(t string) string {
	switch t {
	case "integer":
		return "integer"
	case "decimal":
		return "number"
	case "boolean":
		return "boolean"
	default:
		return "string"
	}
}

func mapGoType(t string) string {
	switch t {
	case "integer":
		return "int"
	case "decimal":
		return "float64"
	case "boolean":
		return "bool"
	default:
		return "string"
	}
}

func capitalize(s string) string {
	parts := strings.Split(s, "_")
	for i, p := range parts {
		if len(p) > 0 {
			parts[i] = strings.ToUpper(p[:1]) + p[1:]
		}
	}
	return strings.Join(parts, "")
}

func pluralize(s string) string {
	if strings.HasSuffix(s, "s") {
		return s + "es"
	}
	if strings.HasSuffix(s, "y") {
		return s[:len(s)-1] + "ies"
	}
	return s + "s"
}

func translateExpr(expr string) string {
	// Simple expression translation for generated code skeleton
	return expr
}

func findIDParam(params []types.ActionParam, classID string) string {
	target := classID + "_id"
	if classID == "inventory_position" {
		target = "position_id"
	}
	for _, p := range params {
		if p.ID == target || p.ID == classID+"_id" {
			return capitalize(p.ID)
		}
	}
	// Fallback: first string param
	for _, p := range params {
		if p.Type == "string" && p.Required {
			return capitalize(p.ID)
		}
	}
	return "\"unknown\""
}
