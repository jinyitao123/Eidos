package tools

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"ontologyserver/internal/mcp"

	"gopkg.in/yaml.v3"
)

func registerRunPipeline(router *mcp.Router, d *Deps) {
	router.Register(mcp.ToolDef{
		Name:        "run_pipeline",
		Description: "执行代码生成管道。从数据库读取本体 YAML，运行 7 步代码生成，返回各步骤的输出文件内容。",
		InputSchema: mcp.Schema(map[string]any{
			"project_id": mcp.Prop("string", "项目ID"),
		}, []string{"project_id"}),
	}, func(ctx context.Context, args json.RawMessage) *mcp.ToolCallResult {
		var p struct {
			ProjectID string `json:"project_id"`
		}
		json.Unmarshal(args, &p)

		// 1. Read the full ontology YAML from the database
		// First try the merged yaml_content on the projects table
		var yamlContent string
		err := d.PG.QueryRow(ctx,
			`SELECT yaml_content FROM ontology.projects
			WHERE id::text = $1 AND yaml_content IS NOT NULL AND yaml_content != ''`,
			p.ProjectID).Scan(&yamlContent)
		if err != nil {
			// Fall back to the latest stage output
			err = d.PG.QueryRow(ctx,
				`SELECT content FROM ontology.stage_outputs
				WHERE project_id::text = $1 AND stage IN ('ontology_structure', 'rules_actions', 'review_report')
				ORDER BY created_at DESC LIMIT 1`, p.ProjectID).Scan(&yamlContent)
			if err != nil {
				return mcp.ErrorResult("no ontology YAML found for project: " + err.Error())
			}
		}

		if strings.TrimSpace(yamlContent) == "" {
			return mcp.ErrorResult("ontology YAML is empty")
		}

		// Normalize YAML to flat format with id/name/version to avoid
		// duplicate keys from wrapper + header injection.
		flat := extractFlat(yamlContent)
		if flat == nil {
			return mcp.ErrorResult("failed to parse ontology YAML")
		}

		// Ensure id/name/version
		if flat["id"] == nil || flat["id"] == "" {
			var projName string
			_ = d.PG.QueryRow(ctx,
				`SELECT name FROM ontology.projects WHERE id::text = $1`, p.ProjectID).Scan(&projName)
			ontologyID := strings.ToLower(strings.ReplaceAll(projName, " ", "_"))
			if ontologyID == "" {
				ontologyID = "project"
			}
			flat["id"] = ontologyID
			if flat["name"] == nil || flat["name"] == "" {
				flat["name"] = projName
			}
		}
		if flat["version"] == nil || flat["version"] == "" {
			flat["version"] = "1.0"
		}

		// Re-serialize to clean YAML (no duplicate keys possible)
		cleanYAML, err := yaml.Marshal(flat)
		if err != nil {
			return mcp.ErrorResult("failed to serialize YAML: " + err.Error())
		}
		yamlContent = string(cleanYAML)

		// 2. Write YAML to temp file
		tmpDir, err := os.MkdirTemp("", "pipeline-*")
		if err != nil {
			return mcp.ErrorResult("create temp dir: " + err.Error())
		}
		defer os.RemoveAll(tmpDir)

		yamlFile := filepath.Join(tmpDir, "ontology.yaml")
		if err := os.WriteFile(yamlFile, []byte(yamlContent), 0644); err != nil {
			return mcp.ErrorResult("write yaml: " + err.Error())
		}

		outDir := filepath.Join(tmpDir, "out")

		// 3. Run pipeline binary
		binPath := "/generate" // In Docker, copied to root
		if _, err := os.Stat(binPath); err != nil {
			// Try local dev path
			binPath = "generate"
			if _, err := exec.LookPath(binPath); err != nil {
				return mcp.ErrorResult("pipeline binary not found")
			}
		}

		cmd := exec.CommandContext(ctx, binPath, "--from", yamlFile, "--output", outDir)
		cmdOutput, err := cmd.CombinedOutput()
		if err != nil {
			return mcp.ErrorResult(fmt.Sprintf("pipeline failed: %v\n%s", err, string(cmdOutput)))
		}

		// 4. Read generated files
		type StepOutput struct {
			Step  int               `json:"step"`
			Name  string            `json:"name"`
			Files map[string]string `json:"files"`
		}

		steps := []StepOutput{
			{Step: 1, Name: "PG Schema 生成", Files: map[string]string{}},
			{Step: 2, Name: "MCP 工具生成", Files: map[string]string{}},
			{Step: 3, Name: "Neo4j Schema 同步", Files: map[string]string{}},
			{Step: 4, Name: "Agent 配置更新", Files: map[string]string{}},
			{Step: 5, Name: "规则引擎更新", Files: map[string]string{}},
			{Step: 6, Name: "前端类型生成", Files: map[string]string{}},
			{Step: 7, Name: "连接器映射模板", Files: map[string]string{}},
		}

		// Step 1: PG Schema
		readFileInto(filepath.Join(outDir, "01_pg_schema.sql"), "01_pg_schema.sql", steps[0].Files)

		// Step 2: MCP Tools
		readFileInto(filepath.Join(outDir, "02_tools.json"), "02_tools.json", steps[1].Files)
		readDirInto(filepath.Join(outDir, "tools"), "tools/", steps[1].Files)

		// Step 3: Neo4j
		readFileInto(filepath.Join(outDir, "neo4j", "03_schema.cypher"), "03_schema.cypher", steps[2].Files)
		readFileInto(filepath.Join(outDir, "neo4j", "03_sync_config.yaml"), "03_sync_config.yaml", steps[2].Files)

		// Step 4: Agent Config
		readFileInto(filepath.Join(outDir, "agents", "04_agent_tools.yaml"), "04_agent_tools.yaml", steps[3].Files)

		// Step 5: Rules
		readFileInto(filepath.Join(outDir, "rules", "05_rules_config.yaml"), "05_rules_config.yaml", steps[4].Files)
		readFileInto(filepath.Join(outDir, "rules", "05_engine.go"), "05_engine.go", steps[4].Files)

		// Step 6: TS Types
		readFileInto(filepath.Join(outDir, "06_types.ts"), "06_types.ts", steps[5].Files)

		// Step 7: Connector Mapping
		readFileInto(filepath.Join(outDir, "connector", "07_mapping_template.yaml"), "07_mapping_template.yaml", steps[6].Files)

		return mcp.TextResult(map[string]any{
			"success": true,
			"steps":   steps,
			"log":     string(cmdOutput),
		})
	})
}

func readFileInto(path, name string, m map[string]string) {
	data, err := os.ReadFile(path)
	if err == nil {
		m[name] = string(data)
	}
}

func readDirInto(dir, prefix string, m map[string]string) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		data, err := os.ReadFile(filepath.Join(dir, e.Name()))
		if err == nil {
			m[prefix+e.Name()] = string(data)
		}
	}
}
