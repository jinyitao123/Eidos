package chat

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"ontologyserver/internal/executor"
)

// fakeExec 发一条 chunk + 一条 done，验证 /chat 端点把事件写成正确的 SSE。
type fakeExec struct{ gotReq executor.ChatRequest }

func (f *fakeExec) Name() string { return "fake" }
func (f *fakeExec) Stream(_ context.Context, req executor.ChatRequest, emit func(executor.Event)) error {
	f.gotReq = req
	emit(executor.Event{Type: "chunk", Data: map[string]string{"content": "嗨"}})
	emit(executor.Event{Type: "done", Data: map[string]any{"output": "嗨", "session_id": "s9"}})
	return nil
}

func TestChatHandlerSSE(t *testing.T) {
	fe := &fakeExec{}
	h := &Handler{Exec: fe}

	body := `{"agent":"ontology-architect","message":"hi","profile":"project_id=p1"}`
	req := httptest.NewRequest(http.MethodPost, "/chat", strings.NewReader(body))
	rec := httptest.NewRecorder()
	h.handleChat(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status: got %d", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "text/event-stream" {
		t.Errorf("content-type: got %q", ct)
	}
	out := rec.Body.String()
	for _, want := range []string{
		"event: chunk", `data: {"content":"嗨"}`, "event: done", `"session_id":"s9"`,
	} {
		if !strings.Contains(out, want) {
			t.Errorf("SSE output missing %q in:\n%s", want, out)
		}
	}
	// 请求字段透传给执行器。
	if fe.gotReq.Agent != "ontology-architect" || fe.gotReq.Profile != "project_id=p1" {
		t.Errorf("request not forwarded: %+v", fe.gotReq)
	}
}

func TestChatHandlerValidation(t *testing.T) {
	h := &Handler{Exec: &fakeExec{}}
	// 缺 agent/message → 400。
	req := httptest.NewRequest(http.MethodPost, "/chat", strings.NewReader(`{"agent":""}`))
	rec := httptest.NewRecorder()
	h.handleChat(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("empty agent: got %d, want 400", rec.Code)
	}
	// OPTIONS 预检 → 204。
	req = httptest.NewRequest(http.MethodOptions, "/chat", nil)
	rec = httptest.NewRecorder()
	h.handleChat(rec, req)
	if rec.Code != http.StatusNoContent {
		t.Errorf("OPTIONS: got %d, want 204", rec.Code)
	}
}
