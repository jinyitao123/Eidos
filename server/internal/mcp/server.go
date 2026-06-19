package mcp

import (
	"encoding/json"
	"io"
	"log"
	"net/http"
)

type jsonRPCRequest struct {
	JSONRPC string          `json:"jsonrpc"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
	ID      any             `json:"id"`
}

type jsonRPCResponse struct {
	JSONRPC string    `json:"jsonrpc"`
	Result  any       `json:"result,omitempty"`
	Error   *rpcError `json:"error,omitempty"`
	ID      any       `json:"id"`
}

type rpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

// ToolCallResult is the response format for tools/call.
type ToolCallResult struct {
	Content []ContentBlock `json:"content"`
	IsError bool           `json:"isError"`
}

type ContentBlock struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

// TextResult creates a successful tool result with a JSON text block.
func TextResult(v any) *ToolCallResult {
	data, _ := json.Marshal(v)
	return &ToolCallResult{
		Content: []ContentBlock{{Type: "text", Text: string(data)}},
		IsError: false,
	}
}

// ErrorResult creates an error tool result.
func ErrorResult(msg string) *ToolCallResult {
	return &ToolCallResult{
		Content: []ContentBlock{{Type: "text", Text: msg}},
		IsError: true,
	}
}

// Handler returns an HTTP handler implementing JSON-RPC 2.0 for MCP (full tool set).
func Handler(router *Router) http.HandlerFunc {
	return handlerImpl(router, "")
}

// HandlerWithProfile mounts the MCP handler on a path that always applies the given
// tool profile — used for headless executors, because Claude Code's HTTP MCP client
// drops query strings (so ?profile= won't reach us; a distinct path does).
func HandlerWithProfile(router *Router, profile string) http.HandlerFunc {
	return handlerImpl(router, profile)
}

func handlerImpl(router *Router, forcedProfile string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
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

		body, err := io.ReadAll(r.Body)
		if err != nil {
			writeError(w, nil, -32700, "parse error")
			return
		}

		var req jsonRPCRequest
		if err := json.Unmarshal(body, &req); err != nil {
			writeError(w, nil, -32700, "parse error")
			return
		}

		// 精简工具面:无头 agent 走带 profile 的专用路径(/mcp-ontology),只看到建模工具;
		// 前端走 /mcp 看全部。路径优先于 query(Claude Code 会丢 query string)。
		ctx := r.Context()
		profile := forcedProfile
		if profile == "" {
			profile = r.URL.Query().Get("profile")
		}
		if profile != "" {
			ctx = withProfile(ctx, profile)
		}

		// JSON-RPC 通知（无 id）：处理但不回响应体（MCP streamable-HTTP 要求 202）。
		if req.ID == nil {
			_, _ = router.Handle(ctx, req.Method, req.Params)
			w.WriteHeader(http.StatusAccepted)
			return
		}

		result, rpcErr := router.Handle(ctx, req.Method, req.Params)
		if rpcErr != nil {
			writeJSON(w, jsonRPCResponse{
				JSONRPC: "2.0",
				Error:   rpcErr,
				ID:      req.ID,
			})
			return
		}

		writeJSON(w, jsonRPCResponse{
			JSONRPC: "2.0",
			Result:  result,
			ID:      req.ID,
		})
	}
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Printf("mcp: write response: %v", err)
	}
}

func writeError(w http.ResponseWriter, id any, code int, msg string) {
	writeJSON(w, jsonRPCResponse{
		JSONRPC: "2.0",
		Error:   &rpcError{Code: code, Message: msg},
		ID:      id,
	})
}
