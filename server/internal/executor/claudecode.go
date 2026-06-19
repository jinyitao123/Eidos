package executor

// ClaudeCodeExecutor 用无头 Claude Code（claude -p）当执行器：
//   - --mcp-config 内联指回本机 Eidos MCP（:9091/mcp），claude 拿到全部 ontology 工具
//   - --allowedTools 只放行 eidos 工具（对齐 Nexus ontology-expert 的 {*:deny, ontology_*:allow}）
//   - --append-system-prompt 注入本地 agent 角色 prompt
// 本体落在 PG（MCP 工具背后），不是文件，所以无需 git 工作区——claude 只调工具改库。
// 换执行器只换这一个文件，工具层与前端协议不动。

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"strings"
)

type ClaudeCodeExecutor struct {
	MCPURL string // 本机 MCP 端点，如 http://127.0.0.1:9091/mcp
	Model  string // 透传 --model（空=claude 默认）
}

func (e *ClaudeCodeExecutor) Name() string { return "claude-code" }

// claude --output-format stream-json 每行一个事件（只取我们要的字段）。
type claudeEvent struct {
	Type    string `json:"type"`
	Message struct {
		Content []struct {
			Type      string          `json:"type"`
			Text      string          `json:"text"`
			ID        string          `json:"id"`
			Name      string          `json:"name"`
			Input     json.RawMessage `json:"input"`
			ToolUseID string          `json:"tool_use_id"`
			Content   json.RawMessage `json:"content"`
			IsError   bool            `json:"is_error"`
		} `json:"content"`
	} `json:"message"`
	Result       string  `json:"result"`
	TotalCostUSD float64 `json:"total_cost_usd"`
	IsError      bool    `json:"is_error"`
}

func (e *ClaudeCodeExecutor) Stream(ctx context.Context, req ChatRequest, emit func(Event)) error {
	mcpConfig := fmt.Sprintf(`{"mcpServers":{"eidos":{"type":"http","url":%q}}}`, ontologyProfileURL(e.MCPURL))

	args := []string{
		"-p", buildTask(req),
		"--append-system-prompt", buildSystem(req),
		"--output-format", "stream-json", "--verbose",
		"--no-session-persistence",
		"--mcp-config", mcpConfig,
		"--strict-mcp-config",
		"--allowedTools", "mcp__eidos__*",
		// 关掉内置文件/命令/搜索/web 工具——否则 claude 会去翻文件系统(ToolSearch/Glob/Grep)
		// 浪费时间甚至不建模。本体活只用 eidos MCP 工具。
		"--disallowedTools", "Bash,Edit,Write,Read,Glob,Grep,Task,WebSearch,WebFetch,TodoWrite,NotebookEdit",
	}
	if e.Model != "" {
		args = append(args, "--model", e.Model)
	}

	cmd := exec.CommandContext(ctx, "claude", args...)
	cmd.Dir = os.TempDir() // 不写文件，cwd 仅占位
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("启动 claude 失败：%w", err)
	}

	toolNames := map[string]string{} // tool_use_id → name，用于把 tool_result 配回工具名
	var result string
	var isErr bool

	sc := bufio.NewScanner(stdout)
	sc.Buffer(make([]byte, 1024*1024), 16*1024*1024)
	for sc.Scan() {
		var ev claudeEvent
		if json.Unmarshal(sc.Bytes(), &ev) != nil {
			continue
		}
		switch ev.Type {
		case "assistant":
			for _, c := range ev.Message.Content {
				switch c.Type {
				case "text":
					if c.Text != "" {
						emit(chunkEvent(c.Text))
					}
				case "tool_use":
					toolNames[c.ID] = c.Name
					emit(toolCallEvent(stripPrefix(c.Name), string(c.Input), c.ID))
				}
			}
		case "user":
			for _, c := range ev.Message.Content {
				if c.Type == "tool_result" {
					status := "success"
					if c.IsError {
						status = "error"
					}
					emit(toolResultEvent(stripPrefix(toolNames[c.ToolUseID]), extractContent(c.Content), c.ToolUseID, status))
				}
			}
		case "result":
			result = ev.Result
			isErr = ev.IsError
		}
	}

	waitErr := cmd.Wait()
	done := map[string]any{"output": result}
	if waitErr != nil {
		done["error"] = fmt.Sprintf("claude 执行失败：%v（%s）", waitErr, snippet(stderr.Bytes()))
	} else if isErr {
		done["error"] = "claude 报错：" + result
	}
	emit(doneEvent(done))
	return nil
}

// stripPrefix 去掉 MCP 命名空间前缀，回到工具裸名：
// claude 用 mcp__eidos__<tool>（双下划线），opencode 用 eidos_<tool>（单下划线）。
func stripPrefix(name string) string {
	if i := strings.LastIndex(name, "__"); i >= 0 {
		return name[i+2:]
	}
	return strings.TrimPrefix(name, "eidos_")
}

// extractContent 把 tool_result 的 content（可能是字符串或 [{type:text,text}] 数组）抽成纯文本。
func extractContent(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var s string
	if json.Unmarshal(raw, &s) == nil {
		return s
	}
	var blocks []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	}
	if json.Unmarshal(raw, &blocks) == nil {
		var parts []string
		for _, b := range blocks {
			if b.Text != "" {
				parts = append(parts, b.Text)
			}
		}
		return strings.Join(parts, "\n")
	}
	return string(raw)
}
