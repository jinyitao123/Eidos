package tools

import (
	"context"
	"encoding/json"
	"strings"

	"ontologyserver/internal/mcp"
)

func registerReadDocument(router *mcp.Router, d *Deps) {
	router.Register(mcp.ToolDef{
		Name:        "read_document",
		Description: "读取上传的调研文档全文内容。支持 .md / .docx / .txt 格式。",
		InputSchema: mcp.Schema(map[string]any{
			"document_id": mcp.Prop("string", "文档ID"),
			"format":      mcp.PropEnum("string", "full=返回全文，sections=按章节结构化返回", []string{"full", "sections"}),
		}, []string{"document_id"}),
	}, func(ctx context.Context, args json.RawMessage) *mcp.ToolCallResult {
		var p struct {
			DocumentID string `json:"document_id"`
			Format     string `json:"format"`
		}
		if err := json.Unmarshal(args, &p); err != nil {
			return mcp.ErrorResult("invalid arguments: " + err.Error())
		}
		if p.Format == "" {
			p.Format = "full"
		}

		var content string
		var filename string
		err := d.PG.QueryRow(ctx,
			`SELECT content, filename FROM ontology.documents WHERE id = $1`,
			p.DocumentID,
		).Scan(&content, &filename)
		if err != nil {
			return mcp.ErrorResult("document not found: " + err.Error())
		}

		result := map[string]any{
			"content":    content,
			"word_count": len(strings.Fields(content)),
		}

		if p.Format == "sections" {
			result["sections"] = splitSections(content)
		}

		return mcp.TextResult(result)
	})
}

func splitSections(content string) []map[string]string {
	lines := strings.Split(content, "\n")
	var sections []map[string]string
	var currentTitle string
	var currentContent strings.Builder

	flush := func() {
		if currentTitle != "" || currentContent.Len() > 0 {
			sections = append(sections, map[string]string{
				"title":   currentTitle,
				"content": strings.TrimSpace(currentContent.String()),
			})
		}
	}

	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "# ") || strings.HasPrefix(trimmed, "## ") {
			flush()
			currentTitle = strings.TrimLeft(trimmed, "# ")
			currentContent.Reset()
		} else {
			currentContent.WriteString(line)
			currentContent.WriteString("\n")
		}
	}
	flush()
	return sections
}
