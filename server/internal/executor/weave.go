package executor

// WeaveExecutor 转发到现有 Weave /v1/chat（流式），把 Weave 的 SSE 逐条原样转出。
// 这是默认执行器——保证切接缝后 Weave 路径零回归（事件词表/data 形状完全不变）。
// 换 claude-code/opencode 时本文件不参与。

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

type WeaveExecutor struct {
	BaseURL string       // 如 http://localhost:8080
	client  *http.Client // 可空，nil 用 http.DefaultClient
}

func (e *WeaveExecutor) Name() string { return "weave" }

func (e *WeaveExecutor) httpClient() *http.Client {
	if e.client != nil {
		return e.client
	}
	return http.DefaultClient
}

// mintToken 复刻前端 client.ts：POST /v1/auth/token 取一个无鉴权令牌（dev 模式）。
func (e *WeaveExecutor) mintToken(ctx context.Context) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, e.BaseURL+"/v1/auth/token", nil)
	if err != nil {
		return "", err
	}
	resp, err := e.httpClient().Do(req)
	if err != nil {
		return "", fmt.Errorf("取 Weave 令牌失败：%w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("取 Weave 令牌 HTTP %d：%s", resp.StatusCode, snippet(b))
	}
	var out struct {
		Token string `json:"token"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return "", fmt.Errorf("解析 Weave 令牌失败：%w", err)
	}
	return out.Token, nil
}

func (e *WeaveExecutor) Stream(ctx context.Context, req ChatRequest, emit func(Event)) error {
	token, err := e.mintToken(ctx)
	if err != nil {
		return err
	}

	body, _ := json.Marshal(map[string]any{
		"agent":      req.Agent,
		"message":    req.Message,
		"profile":    req.Profile,
		"session_id": req.SessionID,
		"context":    req.Context,
		"stream":     true,
	})
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, e.BaseURL+"/v1/chat", bytes.NewReader(body))
	if err != nil {
		return err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+token)
	httpReq.Header.Set("Accept", "text/event-stream")

	resp, err := e.httpClient().Do(httpReq)
	if err != nil {
		return fmt.Errorf("调 Weave /v1/chat 失败：%w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("Weave /v1/chat HTTP %d：%s", resp.StatusCode, snippet(b))
	}

	// 解析 SSE：event: <type> / data: <json>，逐条原样转出（data 当 RawMessage 保真）。
	sc := bufio.NewScanner(resp.Body)
	sc.Buffer(make([]byte, 64*1024), 4*1024*1024)
	var evType string
	var dataLines []string
	flush := func() {
		if evType == "" && len(dataLines) == 0 {
			return
		}
		raw := strings.Join(dataLines, "\n")
		emit(Event{Type: evType, Data: json.RawMessage(raw)})
		evType = ""
		dataLines = dataLines[:0]
	}
	for sc.Scan() {
		line := sc.Text()
		switch {
		case line == "":
			flush()
		case strings.HasPrefix(line, "event:"):
			evType = strings.TrimSpace(strings.TrimPrefix(line, "event:"))
		case strings.HasPrefix(line, "data:"):
			dataLines = append(dataLines, strings.TrimPrefix(strings.TrimPrefix(line, "data:"), " "))
		}
	}
	flush()
	if err := sc.Err(); err != nil {
		return fmt.Errorf("读 Weave SSE 失败：%w", err)
	}
	return nil
}

func snippet(b []byte) string {
	s := strings.TrimSpace(string(b))
	if len(s) > 200 {
		return s[:200] + "…"
	}
	return s
}
