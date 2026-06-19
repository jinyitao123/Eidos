package executor

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// fakeWeave 模拟 Weave：/v1/auth/token 发令牌，/v1/chat 发一段 SSE。
func fakeWeave(t *testing.T) *httptest.Server {
	mux := http.NewServeMux()
	mux.HandleFunc("/v1/auth/token", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("token: expected POST, got %s", r.Method)
		}
		json.NewEncoder(w).Encode(map[string]string{"token": "test-token"})
	})
	mux.HandleFunc("/v1/chat", func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "Bearer test-token" {
			t.Errorf("chat: missing/wrong auth header: %q", got)
		}
		var body map[string]any
		json.NewDecoder(r.Body).Decode(&body)
		if body["agent"] != "ontology-architect" {
			t.Errorf("chat: agent not forwarded, got %v", body["agent"])
		}
		if body["stream"] != true {
			t.Errorf("chat: stream should be true, got %v", body["stream"])
		}
		w.Header().Set("Content-Type", "text/event-stream")
		// 注意 tool_call 的 args 含逗号/引号，验证 data 原样保真。
		fmt.Fprint(w, "event: chunk\ndata: {\"content\":\"你好\"}\n\n")
		fmt.Fprint(w, "event: tool_call\ndata: {\"name\":\"upsert_entity\",\"args\":\"{\\\"id\\\":\\\"customer\\\"}\",\"call_id\":\"c1\"}\n\n")
		fmt.Fprint(w, "event: done\ndata: {\"output\":\"完成\",\"session_id\":\"s1\"}\n\n")
	})
	return httptest.NewServer(mux)
}

func TestWeaveExecutorStreamRoundTrip(t *testing.T) {
	srv := fakeWeave(t)
	defer srv.Close()

	exe := &WeaveExecutor{BaseURL: srv.URL}
	var events []Event
	err := exe.Stream(context.Background(), ChatRequest{
		Agent:   "ontology-architect",
		Message: "建一个客户对象",
		Profile: "project_id=proj_live",
	}, func(ev Event) { events = append(events, ev) })
	if err != nil {
		t.Fatalf("Stream error: %v", err)
	}

	if len(events) != 3 {
		t.Fatalf("expected 3 events, got %d: %+v", len(events), events)
	}
	if events[0].Type != "chunk" || events[1].Type != "tool_call" || events[2].Type != "done" {
		t.Errorf("event types wrong: %s/%s/%s", events[0].Type, events[1].Type, events[2].Type)
	}

	// data 原样保真：chunk 的 content。
	var chunk map[string]string
	if err := json.Unmarshal(events[0].Data.(json.RawMessage), &chunk); err != nil {
		t.Fatalf("chunk data not raw json: %v", err)
	}
	if chunk["content"] != "你好" {
		t.Errorf("chunk content: got %q, want 你好", chunk["content"])
	}

	// tool_call 的嵌套 args（含转义引号）必须完整保真。
	var tc map[string]any
	if err := json.Unmarshal(events[1].Data.(json.RawMessage), &tc); err != nil {
		t.Fatalf("tool_call data not raw json: %v", err)
	}
	if !strings.Contains(tc["args"].(string), "customer") {
		t.Errorf("tool_call args not preserved: %v", tc["args"])
	}
}
