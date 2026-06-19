// Package executor 是 Eidos 本体对话的可替换执行接缝。
//
// 现状把 AI 对话锁死在 Weave（前端直连 /v1/chat）。这个包把"谁来驱动对话"抽成
// 一个接口：上层（/chat SSE 端点）只认 Executor，换后端只换实现、不动工具层与前端协议。
//
// 三种实现共用同一个 :9091/mcp 工具层——改本体的动作（upsert_* 等）完全一致，
// 区别只在驱动者：
//   - WeaveExecutor      转发现有 Weave /v1/chat（零回归，默认）
//   - ClaudeCodeExecutor 无头 claude -p，--mcp-config 指回本机 :9091
//   - OpenCodeExecutor   无头 opencode run，opencode.json 指回本机 :9091
//
// 这是 crew internal/executor 模式 + Nexus 工具中立性（工具层零 LLM）的合流。
package executor

import (
	"context"
	"embed"
	"fmt"
	"strings"
)

//go:embed prompts/*.md
var promptFS embed.FS

// Message 是一轮对话消息。
type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// ChatRequest 是一次对话请求。Agent 决定用哪个角色 system prompt（claude/opencode 用
// 本地 prompt 注册表；weave 把 Agent 名透传给它自己的 registry）。
type ChatRequest struct {
	Agent     string         // scene-analyst | ontology-architect | rule-designer | ontology-reviewer | ontology-editor-assist
	Message   string         // 本轮用户消息
	History   []Message      // 此前对话（可空）
	Profile   string         // "project_id=xxx"，承载本体作用域
	SessionID string         // 会话 id（weave 用；claude/opencode 暂不续会话）
	Context   map[string]any // 注入 system prompt 的运行时上下文
}

// Event 是一条 SSE 事件。Type 沿用 Weave 既有事件词表（chunk/tool_call/tool_result/
// content_block/step_start/step_end/yield/done），让前端解析逻辑零改动；Data 序列化进
// SSE 的 data: 行。三种执行器都说这套词表：Weave 路径逐条转发保真，claude/opencode
// 合成同名事件。
type Event struct {
	Type string `json:"-"`
	Data any    `json:"-"`
}

// 事件构造助手（与 Weave sse.go 的 data 形状对齐）。
func chunkEvent(text string) Event {
	return Event{Type: "chunk", Data: map[string]string{"content": text}}
}
func toolCallEvent(name, args, id string) Event {
	return Event{Type: "tool_call", Data: map[string]any{"name": name, "args": args, "call_id": id}}
}
func toolResultEvent(name, content, id, status string) Event {
	return Event{Type: "tool_result", Data: map[string]any{"name": name, "content": content, "call_id": id, "status": status}}
}
func doneEvent(data map[string]any) Event { return Event{Type: "done", Data: data} }

// Executor 把一次对话请求变成流式 SSE 事件。这是可替换执行器的接缝。
type Executor interface {
	// Stream 跑一轮对话，每条事件经 emit 回传（调用方保证单 goroutine 调用 emit）。
	// 正常结束须 emit 一条 done 事件；出错把错误塞进 done 的 "error" 字段（与 Weave 一致）。
	Stream(ctx context.Context, req ChatRequest, emit func(Event)) error
	// Name 返回执行器标识（weave|claude-code|opencode），用于日志/诊断。
	Name() string
}

// Config 选择并配置执行器。
type Config struct {
	Kind      string // EIDOS_EXECUTOR: weave（默认）| claude-code | opencode | loom
	WeaveURL  string // weave: Weave API 基址（如 http://localhost:8080）
	MCPURL    string // claude/opencode/loom: 本机 MCP 工具端点（如 http://127.0.0.1:9091/mcp）
	Model     string // 模型覆盖（claude: 别名/全名；opencode: provider/model）
	Workspace string // opencode: 放 opencode.json 与会话工作区的基目录

	// loom 执行器(受控循环 + API key 合规)
	LoomProvider string // EIDOS_LOOM_PROVIDER: deepseek（默认）| openai | kimi | glm | anthropic
	LoomModel    string // EIDOS_LOOM_MODEL: 模型覆盖（空=provider 默认）
	LoomKey      string // EIDOS_LOOM_API_KEY: 显式 key（空=读 provider 专属 env）
}

// New 按 Config.Kind 造执行器。未知/空 Kind 回退到 weave（零回归）。
func New(cfg Config) (Executor, error) {
	switch strings.ToLower(strings.TrimSpace(cfg.Kind)) {
	case "", "weave":
		if cfg.WeaveURL == "" {
			return nil, fmt.Errorf("executor weave: 缺 WeaveURL")
		}
		return &WeaveExecutor{BaseURL: strings.TrimRight(cfg.WeaveURL, "/")}, nil
	case "claude-code", "claudecode", "claude":
		if cfg.MCPURL == "" {
			return nil, fmt.Errorf("executor claude-code: 缺 MCPURL（claude 要连回的工具端点）")
		}
		return &ClaudeCodeExecutor{MCPURL: cfg.MCPURL, Model: cfg.Model}, nil
	case "opencode":
		if cfg.MCPURL == "" {
			return nil, fmt.Errorf("executor opencode: 缺 MCPURL")
		}
		return &OpenCodeExecutor{MCPURL: cfg.MCPURL, Model: cfg.Model, Workspace: cfg.Workspace}, nil
	case "loom":
		if cfg.MCPURL == "" {
			return nil, fmt.Errorf("executor loom: 缺 MCPURL")
		}
		return &LoomExecutor{MCPURL: cfg.MCPURL, Provider: cfg.LoomProvider, Model: cfg.LoomModel, APIKey: cfg.LoomKey}, nil
	default:
		return nil, fmt.Errorf("executor: 未知 EIDOS_EXECUTOR=%q（支持 weave|claude-code|opencode|loom）", cfg.Kind)
	}
}

// ontologyProfileURL 把 MCP 端点换到精简工具面专用路径 /mcp-ontology。
// 用路径而非 query——Claude Code 的 HTTP MCP 客户端会丢掉 query string。
func ontologyProfileURL(base string) string {
	if strings.HasSuffix(base, "/mcp") {
		return strings.TrimSuffix(base, "/mcp") + "/mcp-ontology"
	}
	return base // 兜底:非标准 base 不改写
}

// systemPrompt 取某 agent 的本地 system prompt（claude/opencode 用）。
// 未知 agent 回退 _default。
func systemPrompt(agent string) string {
	if b, err := promptFS.ReadFile("prompts/" + agent + ".md"); err == nil {
		return string(b)
	}
	b, _ := promptFS.ReadFile("prompts/_default.md")
	return string(b)
}

// ontologyIDFromProfile 从 "project_id=xxx" 抽本体 id；抽不到返回空。
func ontologyIDFromProfile(profile string) string {
	for _, part := range strings.Split(profile, ";") {
		part = strings.TrimSpace(part)
		for _, key := range []string{"project_id=", "ontology_id=", "id="} {
			if strings.HasPrefix(part, key) {
				return strings.TrimSpace(strings.TrimPrefix(part, key))
			}
		}
	}
	return ""
}

// buildSystem 是喂给无头 agent 的角色 system prompt（role md + 本体 id 上下文）——
// claude 走 --append-system-prompt，opencode 走 agent.prompt。
func buildSystem(req ChatRequest) string {
	var b strings.Builder
	b.WriteString(systemPrompt(req.Agent))
	if id := ontologyIDFromProfile(req.Profile); id != "" {
		fmt.Fprintf(&b, "\n\n## 任务上下文\n本体 id = `%s`（所有工具调用都用这个 id）。", id)
	}
	b.WriteString("\n\n本体工具（read_ontology_doc/save_ontology_doc/upsert_* 等）已通过 MCP 直接可用——" +
		"不要搜索文件系统或代码库，直接调用工具完成任务。")
	return b.String()
}

// buildTask 是本轮的输入（历史 + 当前消息）——claude 走 -p，opencode 走 run message。
// claude/opencode 是一次性进程、不续会话，所以把历史也拼进去。
func buildTask(req ChatRequest) string {
	var b strings.Builder
	if len(req.History) > 0 {
		b.WriteString("## 此前对话\n")
		for _, m := range req.History {
			role := "用户"
			if m.Role == "assistant" {
				role = "助手"
			}
			fmt.Fprintf(&b, "%s：%s\n", role, strings.TrimSpace(m.Content))
		}
		b.WriteString("\n## 本次指令\n")
	}
	b.WriteString(strings.TrimSpace(req.Message))
	return b.String()
}
