package executor

// OpenCodeExecutor 用无头 opencode（opencode run --format json）当执行器：
//   - 临时工作目录写一份 opencode.json：provider(deepseek) + mcp eidos(remote, 指回 :9091)
//     + 自定义 agent（角色 prompt + 关掉内置文件/命令工具，只留 eidos MCP 工具）
//   - opencode run --format json --agent eidos 跑，解析 NDJSON 事件
// 与 ClaudeCodeExecutor 同形，只是载体换成 opencode。换执行器只换这一个文件。

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

type OpenCodeExecutor struct {
	MCPURL    string // 本机 MCP 端点，如 http://127.0.0.1:9091/mcp
	Model     string // provider/model，空=deepseek/deepseek-chat
	Workspace string // 放临时 opencode.json 的基目录，空=os.TempDir()
}

func (e *OpenCodeExecutor) Name() string { return "opencode" }

func (e *OpenCodeExecutor) model() string {
	if e.Model != "" {
		return e.Model
	}
	return "deepseek/deepseek-chat"
}

// opencode --format json 每行一个事件：{type, timestamp, sessionID, ...data}。
type ocEvent struct {
	Type string `json:"type"`
	Part struct {
		Type   string `json:"type"`
		Text   string `json:"text"`
		Tool   string `json:"tool"`
		CallID string `json:"callID"`
		State  struct {
			Status string          `json:"status"`
			Input  json.RawMessage `json:"input"`
			Output string          `json:"output"`
			Error  string          `json:"error"`
		} `json:"state"`
	} `json:"part"`
}

func (e *OpenCodeExecutor) writeConfig(dir string, req ChatRequest) error {
	// 不写 provider/apiKey：让 opencode 用它自己的凭证（`opencode auth`，存于 auth.json）。
	// 硬塞 {env:DEEPSEEK_API_KEY} 在 env 未设时会解析成空串、反而顶掉已存凭证。
	cfg := map[string]any{
		"$schema": "https://opencode.ai/config.json",
		"mcp": map[string]any{
			"eidos": map[string]any{"type": "remote", "url": ontologyProfileURL(e.MCPURL), "enabled": true},
		},
		"agent": map[string]any{
			"eidos": map[string]any{
				"mode":   "primary",
				"model":  e.model(),
				"prompt": buildSystem(req),
				// 关掉内置文件/命令工具，只留 eidos MCP 工具（对齐 ontology-expert 权限）。
				"tools": map[string]any{
					"bash": false, "edit": false, "write": false, "read": false,
					"glob": false, "grep": false, "webfetch": false, "websearch": false,
					"task": false, "todowrite": false, "patch": false,
				},
			},
		},
	}
	b, _ := json.MarshalIndent(cfg, "", "  ")
	return os.WriteFile(filepath.Join(dir, "opencode.json"), b, 0o644)
}

func (e *OpenCodeExecutor) Stream(ctx context.Context, req ChatRequest, emit func(Event)) error {
	base := e.Workspace
	if base == "" {
		base = os.TempDir()
	}
	dir, err := os.MkdirTemp(base, "eidos-oc-")
	if err != nil {
		return fmt.Errorf("建 opencode 工作区失败：%w", err)
	}
	defer os.RemoveAll(dir)
	if err := e.writeConfig(dir, req); err != nil {
		return fmt.Errorf("写 opencode.json 失败：%w", err)
	}

	args := []string{"run", "--format", "json", "--agent", "eidos", "-m", e.model(), buildTask(req)}
	cmd := exec.CommandContext(ctx, "opencode", args...)
	cmd.Dir = dir
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("启动 opencode 失败：%w", err)
	}

	var fullText strings.Builder
	sc := bufio.NewScanner(stdout)
	sc.Buffer(make([]byte, 1024*1024), 16*1024*1024)
	for sc.Scan() {
		var ev ocEvent
		if json.Unmarshal(sc.Bytes(), &ev) != nil {
			continue
		}
		switch ev.Type {
		case "text":
			if ev.Part.Text != "" {
				fullText.WriteString(ev.Part.Text)
				emit(chunkEvent(ev.Part.Text))
			}
		case "tool_use":
			if ev.Part.Type != "tool" {
				continue
			}
			name := stripPrefix(ev.Part.Tool)
			emit(toolCallEvent(name, string(ev.Part.State.Input), ev.Part.CallID))
			status := "success"
			content := ev.Part.State.Output
			if ev.Part.State.Status == "error" {
				status = "error"
				content = ev.Part.State.Error
			}
			emit(toolResultEvent(name, content, ev.Part.CallID, status))
		}
	}

	waitErr := cmd.Wait()
	done := map[string]any{"output": fullText.String()}
	if waitErr != nil {
		done["error"] = fmt.Sprintf("opencode 执行失败：%v（%s）", waitErr, snippet(stderr.Bytes()))
	}
	emit(doneEvent(done))
	return nil
}
