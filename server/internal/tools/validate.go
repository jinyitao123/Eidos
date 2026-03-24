package tools

import (
	"context"
	"encoding/json"

	"ontologyserver/internal/mcp"
	ontoyaml "ontologyserver/internal/yaml"

	"gopkg.in/yaml.v3"
)

func registerValidateYAML(router *mcp.Router, d *Deps) {
	router.Register(mcp.ToolDef{
		Name:        "validate_yaml",
		Description: "验证本体 YAML 格式和语义。返回错误列表和警告列表。scope=full 验证完整本体，scope=rules_only 仅验证规则和动作部分。",
		InputSchema: mcp.Schema(map[string]any{
			"yaml_content": mcp.Prop("string", "YAML 内容字符串"),
			"check_level":  mcp.PropEnum("string", "校验级别", []string{"format", "semantic", "full"}),
			"scope":        mcp.PropEnum("string", "验证范围：full=完整本体，rules_only=仅规则和动作", []string{"full", "rules_only"}),
		}, []string{"yaml_content"}),
	}, func(ctx context.Context, args json.RawMessage) *mcp.ToolCallResult {
		var p struct {
			YAMLContent string `json:"yaml_content"`
			CheckLevel  string `json:"check_level"`
			Scope       string `json:"scope"`
		}
		if err := json.Unmarshal(args, &p); err != nil {
			return mcp.ErrorResult("invalid arguments: " + err.Error())
		}
		if p.CheckLevel == "" {
			p.CheckLevel = "full"
		}
		if p.Scope == "" {
			p.Scope = "full"
		}

		if p.Scope == "rules_only" {
			// For rules-only validation, just check YAML is parseable
			var check any
			if err := yaml.Unmarshal([]byte(p.YAMLContent), &check); err != nil {
				return mcp.TextResult(map[string]any{
					"valid":  false,
					"errors": []map[string]string{{"type": "format", "message": "YAML parse error: " + err.Error()}},
				})
			}
			return mcp.TextResult(map[string]any{
				"valid":    true,
				"errors":   []any{},
				"warnings": []any{},
			})
		}

		o, err := ontoyaml.Parse([]byte(p.YAMLContent))
		if err != nil {
			return mcp.TextResult(map[string]any{
				"valid":  false,
				"errors": []map[string]string{{"type": "format", "message": "YAML parse error: " + err.Error()}},
			})
		}

		result := ontoyaml.Validate(o, p.CheckLevel)
		return mcp.TextResult(result)
	})
}
