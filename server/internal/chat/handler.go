// Package chat 暴露一个 SSE /chat 端点，把对话请求交给可替换的 executor，
// 并把执行器吐出的事件按 Weave 既有 SSE 词表（event: chunk/tool_call/.../done）写给前端。
// 前端从直连 Weave 改为调本端点后，切换后端只需翻 EIDOS_EXECUTOR 环境变量。
package chat

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"

	"ontologyserver/internal/executor"
)

type Handler struct {
	Exec executor.Executor
}

type chatRequest struct {
	Agent     string             `json:"agent"`
	Message   string             `json:"message"`
	Profile   string             `json:"profile"`
	SessionID string             `json:"session_id"`
	Context   map[string]any     `json:"context"`
	History   []executor.Message `json:"history"`
}

func (h *Handler) Mount(mux *http.ServeMux) {
	mux.HandleFunc("/chat", h.handleChat)
}

func (h *Handler) handleChat(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}

	var req chatRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if req.Agent == "" || req.Message == "" {
		http.Error(w, "agent and message are required", http.StatusBadRequest)
		return
	}

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	emit := func(ev executor.Event) {
		data, err := json.Marshal(ev.Data)
		if err != nil {
			return
		}
		fmt.Fprintf(w, "event: %s\ndata: %s\n\n", ev.Type, data)
		flusher.Flush()
	}

	log.Printf("chat: executor=%s agent=%s profile=%s", h.Exec.Name(), req.Agent, req.Profile)
	err := h.Exec.Stream(r.Context(), executor.ChatRequest{
		Agent:     req.Agent,
		Message:   req.Message,
		Profile:   req.Profile,
		SessionID: req.SessionID,
		Context:   req.Context,
		History:   req.History,
	}, emit)
	if err != nil {
		// 传输层错误（执行器没机会自己发 done）——补一条带 error 的 done。
		log.Printf("chat: executor %s error: %v", h.Exec.Name(), err)
		emit(executor.Event{Type: "done", Data: map[string]any{"error": err.Error()}})
	}
}
