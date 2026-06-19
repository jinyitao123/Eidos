package executor

// LoomExecutor 用 loom 的受控工具循环当执行器——这是唯一"可硬约束"的执行器:
// 循环在我们手里(不像 claude-code 黑盒),能强制模型出工具调用、不保存就重试。
// 且全程走 API key(合规:产品后端必须 API key,不能用 Claude 订阅;见 docs)。
//
// provider 可配:EIDOS_LOOM_PROVIDER(deepseek/openai/kimi/glm/anthropic)+ EIDOS_LOOM_MODEL
// + EIDOS_LOOM_API_KEY(或 provider 专属 env)。deepseek 原生,其余走 OpenAI 兼容 baseURL。

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"

	"github.com/jinyitao123/loom/contract"
	"github.com/jinyitao123/loom/provider/deepseek"
	"github.com/jinyitao123/loom/provider/openai"
)

type LoomExecutor struct {
	MCPURL   string // 本机 MCP 端点(会换到 /mcp-ontology 精简面)
	Provider string // EIDOS_LOOM_PROVIDER
	Model    string // EIDOS_LOOM_MODEL(空=provider 默认)
	APIKey   string // EIDOS_LOOM_API_KEY(空=读 provider 专属 env)
}

func (e *LoomExecutor) Name() string { return "loom" }

// providerPreset 描述一个 provider 的接入方式。
type providerPreset struct {
	baseURL      string   // 空=provider 默认(deepseek/openai 原生)
	defaultModel string   // 未指定 model 时用
	keyEnvs      []string // 按序找 key 的 env
	openaiCompat bool     // true=用 openai 客户端 + baseURL;false=deepseek 原生
}

var loomPresets = map[string]providerPreset{
	"deepseek":  {defaultModel: "deepseek-chat", keyEnvs: []string{"DEEPSEEK_API_KEY"}},
	"openai":    {openaiCompat: true, defaultModel: "gpt-4o", keyEnvs: []string{"OPENAI_API_KEY"}},
	"kimi":      {openaiCompat: true, baseURL: "https://api.moonshot.cn/v1", defaultModel: "moonshot-v1-8k", keyEnvs: []string{"MOONSHOT_API_KEY", "KIMI_API_KEY"}},
	"glm":       {openaiCompat: true, baseURL: "https://open.bigmodel.cn/api/paas/v4", defaultModel: "glm-4", keyEnvs: []string{"GLM_API_KEY", "ZHIPUAI_API_KEY"}},
	"anthropic": {openaiCompat: true, baseURL: "https://api.anthropic.com/v1", defaultModel: "claude-sonnet-4-6", keyEnvs: []string{"ANTHROPIC_API_KEY"}},
}

// buildLLM 按配置造一个 contract.LLM,返回 (llm, 实际 model, err)。
func (e *LoomExecutor) buildLLM() (contract.LLM, string, error) {
	name := strings.ToLower(strings.TrimSpace(e.Provider))
	if name == "" {
		name = "deepseek"
	}
	preset, ok := loomPresets[name]
	if !ok {
		return nil, "", fmt.Errorf("loom: 未知 provider %q(支持 deepseek/openai/kimi/glm/anthropic)", name)
	}
	key := e.APIKey
	if key == "" {
		for _, env := range preset.keyEnvs {
			if v := os.Getenv(env); v != "" {
				key = v
				break
			}
		}
	}
	if key == "" {
		return nil, "", fmt.Errorf("loom: provider %q 缺 API key(设 EIDOS_LOOM_API_KEY 或 %s)", name, strings.Join(preset.keyEnvs, "/"))
	}
	model := e.Model
	if model == "" {
		model = preset.defaultModel
	}
	if preset.openaiCompat {
		var opts []openai.Option
		if preset.baseURL != "" {
			opts = append(opts, openai.WithBaseURL(preset.baseURL))
		}
		return openai.New(key, opts...), model, nil
	}
	return deepseek.New(key), model, nil
}

func (e *LoomExecutor) Stream(ctx context.Context, req ChatRequest, emit func(Event)) error {
	llm, model, err := e.buildLLM()
	if err != nil {
		emit(doneEvent(map[string]any{"error": err.Error()}))
		return nil
	}
	disp := &mcpDispatcher{url: ontologyProfileURL(e.MCPURL), client: http.DefaultClient}
	tools, err := disp.ListTools(ctx)
	if err != nil {
		emit(doneEvent(map[string]any{"error": "loom: 列工具失败:" + err.Error()}))
		return nil
	}

	msgs := []contract.Message{{Role: "system", Content: buildSystem(req)}}
	for _, m := range req.History {
		msgs = append(msgs, contract.Message{Role: m.Role, Content: m.Content})
	}
	msgs = append(msgs, contract.Message{Role: "user", Content: buildTask(req)})

	saved, retried := false, false
	var lastText string
	const maxIter = 12

	for i := 0; i < maxIter; i++ {
		resp, err := llm.Chat(ctx, contract.ChatRequest{Model: model, Messages: msgs, Tools: tools, MaxTokens: 4000})
		if err != nil {
			emit(doneEvent(map[string]any{"error": "loom: 模型调用失败:" + err.Error(), "output": lastText}))
			return nil
		}
		if resp.Content != "" {
			lastText = resp.Content
			emit(chunkEvent(resp.Content))
		}
		msgs = append(msgs, resp.AsMessage())

		if len(resp.ToolCalls) == 0 {
			// 模型只说话没动手:若还没保存,强制顶一次("必须调用 save")——这是 claude-code 黑盒做不到的硬约束。
			if !saved && !retried {
				retried = true
				msgs = append(msgs, contract.Message{Role: "user",
					Content: "你还没有把本体写入存储。现在必须调用 save_ontology_doc(或 upsert_*)把模型保存进去,不要只用文字描述。"})
				continue
			}
			break
		}

		for _, tc := range resp.ToolCalls {
			emit(toolCallEvent(stripPrefix(tc.Name), tc.Args, tc.ID))
			res, derr := disp.Dispatch(ctx, tc)
			if derr != nil {
				res = &contract.ToolResult{CallID: tc.ID, Content: derr.Error(), IsError: true}
			}
			status := "success"
			if res.IsError {
				status = "error"
			}
			emit(toolResultEvent(stripPrefix(tc.Name), res.Content, tc.ID, status))
			if !res.IsError && isWriteToolName(tc.Name) {
				saved = true
			}
			msgs = append(msgs, contract.Message{Role: "tool", Content: res.Content, ToolCallID: tc.ID})
		}
	}

	emit(doneEvent(map[string]any{"output": lastText, "saved": saved}))
	return nil
}

// isWriteToolName 判断是否写类工具(用于"是否已保存"的硬约束判定)。
func isWriteToolName(name string) bool {
	n := stripPrefix(name)
	for _, p := range []string{"save_ontology", "upsert_", "realign_", "restore_", "approve_", "publish_"} {
		if strings.HasPrefix(n, p) {
			return true
		}
	}
	return false
}

// mcpDispatcher 是接本机 MCP(精简面)的 contract.ToolDispatcher——loom 循环经它调 eidos 工具。
type mcpDispatcher struct {
	url    string
	client *http.Client
}

func (d *mcpDispatcher) rpc(ctx context.Context, method string, params any) (json.RawMessage, error) {
	body, _ := json.Marshal(map[string]any{"jsonrpc": "2.0", "method": method, "params": params, "id": 1})
	rq, err := http.NewRequestWithContext(ctx, http.MethodPost, d.url, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	rq.Header.Set("Content-Type", "application/json")
	resp, err := d.client.Do(rq)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	var out struct {
		Result json.RawMessage `json:"result"`
		Error  *struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, fmt.Errorf("解析 MCP 响应失败:%s", snippet(raw))
	}
	if out.Error != nil {
		return nil, fmt.Errorf("%s", out.Error.Message)
	}
	return out.Result, nil
}

func (d *mcpDispatcher) ListTools(ctx context.Context) ([]contract.ToolDef, error) {
	res, err := d.rpc(ctx, "tools/list", map[string]any{})
	if err != nil {
		return nil, err
	}
	var lst struct {
		Tools []struct {
			Name        string          `json:"name"`
			Description string          `json:"description"`
			InputSchema json.RawMessage `json:"inputSchema"`
		} `json:"tools"`
	}
	json.Unmarshal(res, &lst)
	defs := make([]contract.ToolDef, 0, len(lst.Tools))
	for _, t := range lst.Tools {
		defs = append(defs, contract.ToolDef{Name: t.Name, Description: t.Description, InputSchema: t.InputSchema})
	}
	return defs, nil
}

func (d *mcpDispatcher) Dispatch(ctx context.Context, call contract.ToolCall) (*contract.ToolResult, error) {
	var args json.RawMessage
	if strings.TrimSpace(call.Args) == "" {
		args = json.RawMessage(`{}`)
	} else {
		args = json.RawMessage(call.Args)
	}
	res, err := d.rpc(ctx, "tools/call", map[string]any{"name": call.Name, "arguments": args})
	if err != nil {
		return &contract.ToolResult{CallID: call.ID, Content: err.Error(), IsError: true}, nil
	}
	var tcr struct {
		Content []struct {
			Text string `json:"text"`
		} `json:"content"`
		IsError bool `json:"isError"`
	}
	json.Unmarshal(res, &tcr)
	text := ""
	if len(tcr.Content) > 0 {
		text = tcr.Content[0].Text
	}
	return &contract.ToolResult{CallID: call.ID, Content: text, IsError: tcr.IsError, ToolName: call.Name}, nil
}
