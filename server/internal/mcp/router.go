package mcp

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
)

// ToolFunc handles a tools/call invocation.
type ToolFunc func(ctx context.Context, args json.RawMessage) *ToolCallResult

// Router dispatches JSON-RPC methods.
type Router struct {
	tools    []ToolDef
	handlers map[string]ToolFunc
}

func NewRouter() *Router {
	return &Router{
		handlers: make(map[string]ToolFunc),
	}
}

func (r *Router) Register(def ToolDef, handler ToolFunc) {
	r.tools = append(r.tools, def)
	r.handlers[def.Name] = handler
}

func (r *Router) Handle(ctx context.Context, method string, params json.RawMessage) (any, *rpcError) {
	switch method {
	case "tools/list":
		return r.handleList()
	case "tools/call":
		return r.handleCall(ctx, params)
	default:
		return nil, &rpcError{Code: -32601, Message: fmt.Sprintf("unknown method: %s", method)}
	}
}

func (r *Router) handleList() (any, *rpcError) {
	return map[string]any{"tools": r.tools}, nil
}

func (r *Router) handleCall(ctx context.Context, params json.RawMessage) (any, *rpcError) {
	var call struct {
		Name      string          `json:"name"`
		Arguments json.RawMessage `json:"arguments"`
	}
	if err := json.Unmarshal(params, &call); err != nil {
		return nil, &rpcError{Code: -32602, Message: "invalid params"}
	}

	handler, ok := r.handlers[call.Name]
	if !ok {
		return nil, &rpcError{Code: -32602, Message: fmt.Sprintf("unknown tool: %s", call.Name)}
	}

	// Log tool name and abbreviated args for debugging
	argStr := string(call.Arguments)
	if len(argStr) > 200 {
		argStr = argStr[:200] + "..."
	}
	log.Printf("mcp: tools/call %s args=%s", call.Name, argStr)
	result := handler(ctx, call.Arguments)
	if result.IsError {
		log.Printf("mcp: tools/call %s ERROR: %s", call.Name, result.Content[0].Text)
	}
	return result, nil
}
